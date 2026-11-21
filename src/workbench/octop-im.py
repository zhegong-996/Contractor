"""Bridge Octop's native IM transports over a private child-process pipe."""
import asyncio
import json
import logging
import re
import sys
from collections import OrderedDict
from datetime import datetime, timezone
from time import monotonic
from urllib.parse import urlsplit

from octop_gateway import ChannelCredentialsError, ChannelManager, ChannelSubject, MessageEvent, TextContent
from octop_gateway.channels import BUILTIN_CHANNELS, register_channel_kind
from octop_gateway.media import MediaBackend

from octop_channel_spool import GatewaySpool, save_delivery

pipe = sys.stdout
CONSULTATION_CARD_TEMPLATE = "1366a1eb-bc54-4859-ac88-517c56a9acb1.schema"
CONSULTATION_TITLE = "Contractor · 咨询已处理"


def normalize(message):
    kind, channel, meta = message.channel_type, message.channel_id, message.metadata
    thread = qq_route = None
    if kind in ("telegram", "discord"):
        chat, sender, native_id = (meta.get(key) for key in ("chat_id", "sender_id", "message_id"))
        direct = (not meta.get("is_group")) if kind == "telegram" else meta.get("chat_type") == "dm"
        if kind == "telegram":
            thread = meta.get("message_thread_id")
    elif kind == "wecom":
        chat, sender, native_id = (meta.get(key) for key in ("chat_id", "to_handle", "msgid"))
        direct = meta.get("chat_type") == "single"
        if direct:
            chat = sender
    elif kind == "qq":
        qq_routes = {"AT_MESSAGE_CREATE": "channel", "DIRECT_MESSAGE_CREATE": "direct",
                     "C2C_MESSAGE_CREATE": "c2c", "GROUP_AT_MESSAGE_CREATE": "group", "GROUP_MESSAGE_CREATE": "group"}
        qq_route = qq_routes.get(meta.get("event_type"))
        if not qq_route:
            return None
        sender, native_id = meta.get("sender_id"), meta.get("msg_id")
        chat = meta.get({"channel": "channel_id_native", "group": "group_openid", "direct": "guild_id", "c2c": "user_openid"}[qq_route])
        if qq_route == "c2c":
            chat = chat or sender
        direct = qq_route in ("direct", "c2c")
        if qq_route == "direct":
            thread = meta.get("channel_id_native")
            if not thread:
                return None
    elif kind == "dingtalk":
        chat, sender, native_id = (meta.get(key) for key in ("conversation_id", "to_handle", "msg_id"))
        direct = meta.get("conversation_type") == "1"
    elif kind == "weixin":
        account = meta.get("account_id")
        sender, native_id = meta.get("from_user_id"), meta.get("_weixin_msg_id")
        if not account or not sender:
            return None
        chat, direct = f"{account}:{sender}", True
        # Platform sender IDs are scoped to the logged-in WeChat account.
        sender = chat
    else:
        return None

    if not all(value and str(value) != "unknown" for value in (chat, sender, native_id)):
        return None
    if not message.content or any(not isinstance(part, TextContent) for part in message.content):
        return None
    text = message.text.strip()
    if kind in ("wecom", "dingtalk") and not direct:
        text = re.sub(r"^(?:@[\S]+[\s\u2005]+)+(?=/(?:咨询|consult|协作)\s|\[主题:)", "", text)
    if not text or len(text) > 4000:
        return None
    address = {"connector": channel, "kind": kind, "chat": str(chat), "sender": str(sender),
               "message": str(native_id), "direct": direct}
    if thread is not None:
        address["thread"] = str(thread)
    if qq_route:
        address["qqRoute"] = qq_route
    at = datetime.fromtimestamp(message.timestamp, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"address": address, "text": text, "at": at}


def reply_subject(address, proactive=False):
    kind, chat, message = address["kind"], address["chat"], address["message"]
    thread = address.get("thread")
    if kind == "telegram":
        metadata = {"chat_id": chat}
        if not proactive:
            metadata["source_message_id"] = message
        if thread is not None:
            metadata["message_thread_id"] = int(thread)
    elif kind in ("discord", "wecom"):
        metadata = {"chat_id": chat}
    elif kind == "qq":
        route = address["qqRoute"]
        metadata = {"msg_type": route, "msg_id": message,
                    {"channel": "channel_id_native", "group": "group_openid", "c2c": "user_openid", "direct": "guild_id"}[route]: chat}
        if route == "direct":
            metadata["channel_id_native"] = thread
    else:
        raise ValueError("No stable reply route")
    return ChannelSubject(subject_id=chat, chat_type="direct" if address["direct"] else "group", metadata=metadata)


class NoMedia(MediaBackend):
    async def save(self, data, key):
        pass

    async def read(self, key):
        raise FileNotFoundError(key)

    async def exists(self, key):
        return False


def emit(kind, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False), file=pipe, flush=True)


def transport_only(base, accept, status=lambda *_: None, spool=None):
    class Transport(base):
        def set_enqueue_callback(self, callback):
            # Persist in the native callback before the SDK acknowledges. Do not queue Agent work here.
            super().set_enqueue_callback(self.capture if spool else callback)

        def capture(self, payload):
            # Bypass the conversational processor: even an empty WeCom reply sends an acknowledgement.
            event = normalize(self.parse_inbound(payload))
            if event:
                accept(event)

        async def handle_inbound(self, payload):
            self.capture(payload)

    if base.channel_type == "dingtalk":
        from octop_gateway.channels.dingtalk import DingTalkConfig

        class DingTalkTransport(Transport):
            def __init__(self, processor, config: DingTalkConfig, **kwargs):
                super().__init__(processor, config, **kwargs)
                self._reply_routes = OrderedDict()
                self._stream_reported = False

            @staticmethod
            def _reply_key(address):
                return tuple(address[key] for key in ("chat", "sender", "message", "direct"))

            @property
            def stream_ready(self):
                ws = getattr(self._stream_client, "websocket", None)
                return bool(getattr(ws, "open", False) or getattr(getattr(ws, "state", None), "name", None) == "OPEN")

            def report_stream_status(self, ready):
                if ready != self._stream_reported:
                    self._stream_reported = ready
                    status(self.channel_id, ready)

            def capture(self, payload):
                message = self.parse_inbound(payload)
                event = normalize(message)
                if not event:
                    return
                endpoint = None
                url = message.metadata.get("webhook_url")
                if isinstance(url, str) and len(url) <= 2048:
                    try:
                        parsed = urlsplit(url)
                        if parsed.scheme == "https" and parsed.netloc == "oapi.dingtalk.com" and parsed.path == "/robot/sendBySession" \
                                and parsed.query and not parsed.fragment and not re.search(r"[\x00-\x20\x7f]", url):
                            endpoint = url
                            if not spool:
                                key = self._reply_key(event["address"])
                                self._reply_routes[key] = (url, monotonic() + 20 * 60)
                                self._reply_routes.move_to_end(key)
                                if len(self._reply_routes) > 256:
                                    self._reply_routes.popitem(last=False)
                    except ValueError:
                        pass
                # An actual callback is stronger evidence than starting the SDK's reconnect task.
                self.report_stream_status(True)
                if spool:
                    spool.accept(event, endpoint)
                else:
                    accept(event)

            async def reply_original(self, address, text, card=None):
                local = self._reply_routes.get(self._reply_key(address))
                route = spool.route(address) if spool else local and local[1] > monotonic() and local[0]
                if not route:
                    raise RuntimeError("DingTalk reply window is unavailable")
                http = await self._ensure_http()
                payload = {"msgtype": "text", "text": {"content": text}}
                if card and address["direct"]:
                    link = card.get("url", "")
                    delivery = card.get("delivery", "")
                    url = urlsplit(link)
                    if url.scheme == "https" and url.hostname and not url.username and not url.password \
                            and not re.search(r"[\s<>()\[\]\\]", link) and re.fullmatch(r"[0-9a-f]{32}", delivery):
                        # An explicit rejection may fall back to the original callback. An ambiguous
                        # response must not trigger a second notification.
                        if re.fullmatch(r"[A-Za-z0-9_-]{1,180}", address["sender"]) and await self._result_card(http, address["sender"], delivery, link):
                            return "card"
                        payload = {"msgtype": "markdown", "markdown": {"title": CONSULTATION_TITLE,
                            "text": "### " + CONSULTATION_TITLE + "\n\n[查看工作台完整回复](" + link + ")"}}
                async with http.post(route, json=payload, allow_redirects=False) as response:
                    if response.status != 200 or (await response.json()).get("errcode") != 0:
                        raise RuntimeError("DingTalk did not acknowledge the reply")
                return "markdown" if payload["msgtype"] == "markdown" else None

            async def publish_group(self, chat, text):
                http = await self._ensure_http()
                headers = await self._get_auth_headers()
                body = {"robotCode": self._config.effective_robot_code, "openConversationId": chat,
                        "msgKey": "sampleMarkdown", "msgParam": json.dumps({"title": "Contractor", "text": text}, ensure_ascii=False)}
                async with http.post("https://api.dingtalk.com/v1.0/robot/groupMessages/send", json=body, headers=headers,
                                     allow_redirects=False) as response:
                    result = await response.json()
                    if response.status != 200 or not isinstance(result.get("processQueryKey"), str) or not result["processQueryKey"]:
                        raise RuntimeError("DingTalk group delivery was not confirmed")
                return "markdown"

            async def _result_card(self, http, sender, delivery, link):
                try:
                    headers = await self._get_auth_headers()
                except Exception:
                    # No card request was made, so the original webhook remains safe to use.
                    return False
                track = "contractor-" + delivery
                body = {"cardTemplateId": CONSULTATION_CARD_TEMPLATE, "outTrackId": track, "callbackType": "STREAM",
                        "cardData": {"cardParamMap": {"title": CONSULTATION_TITLE, "markdown": "咨询结果已可查看。", "tips": "",
                            "sys_full_json_obj": json.dumps({"msgButtons": [
                                {"text": "查看工作台完整回复", "url": link, "iosUrl": link, "color": "blue"}]}, ensure_ascii=False)}},
                        "openSpaceId": "dtv1.card//IM_ROBOT." + sender, "userIdType": 1,
                        "imRobotOpenSpaceModel": {"supportForward": False}, "imRobotOpenDeliverModel": {"spaceType": "IM_ROBOT"}}
                async with http.post("https://api.dingtalk.com/v1.0/card/instances/createAndDeliver", json=body, headers=headers,
                                     allow_redirects=False) as response:
                    if response.status in (401, 403, 404):
                        return False
                    data = await response.json()
                    if response.status == 400 and data.get("code") in ("param.templateNotExist", "param.templateUnpublished", "param.userIdNotExist"):
                        return False
                    result = data.get("result") or {}
                    deliveries = result.get("deliverResults") or []
                    if response.status == 200 and result.get("outTrackId") == track and len(deliveries) == 1:
                        actual = deliveries[0]
                        if actual.get("spaceType") == "IM_ROBOT" and actual.get("spaceId") == sender:
                            if data.get("success") is True and actual.get("success") is True:
                                return True
                            if actual.get("success") is False:
                                return False
                    raise RuntimeError("DingTalk card delivery was not confirmed")

        return DingTalkTransport

    if base.channel_type != "wecom":
        return Transport

    class WeComTransport(Transport):
        def capture(self, payload):
            if self.is_connected:
                super().capture(payload)

        def _on_authenticated(self):
            super()._on_authenticated()
            status(self.channel_id, True)

        def _on_disconnected(self, reason=""):
            super()._on_disconnected(reason)
            status(self.channel_id, False)

        @property
        def is_connected(self):
            return self._connected

    return WeComTransport


async def main(configs, ledger):
    spool = GatewaySpool(ledger, configs)
    async def quiet_processor(_):
        yield MessageEvent.completed()

    # The manager owns network and transport workers only. Contractor submits work to AutoLoop.
    manager = ChannelManager(processor=quiet_processor, media_backend=NoMedia(),
                             control_message_predicate=lambda _: True, workers_per_channel=1, queue_maxsize=128,
                             constraints={"reply_timeout": 0, "typing_keepalive_interval": 0, "show_thinking": False})
    kinds = set()
    for kind in {row["kind"] for row in configs}:
        try:
            bridge = transport_only(BUILTIN_CHANNELS[kind], spool.accept,
                                    lambda channel, connected: emit("ready" if connected else "offline", connector=channel), spool)
            register_channel_kind("contractor-" + kind, bridge, plugin_id="contractor")
            kinds.add(kind)
        except ImportError:
            pass
    await manager.start()

    async def connect(row):
        channel, kind = row["id"], row["kind"]
        if kind not in kinds:
            emit("offline", connector=channel)
            return
        config = {**row["config"], "group_context": {"enabled": False}, "show_thinking": False, "show_tool_hints": False}
        if kind == "telegram":
            config.update(reply_to_message=True, show_typing=False)
        retry = 5
        while True:
            try:
                await manager.add_channel(channel_type="contractor-" + kind, channel_id=channel, config=config)
                if kind == "dingtalk":
                    connection = manager.get_channel(channel)
                    while True:
                        connection.report_stream_status(connection.stream_ready)
                        await asyncio.sleep(1)
                elif kind != "wecom":
                    emit("ready", connector=channel)
                return
            except (ChannelCredentialsError, ValueError):
                emit("offline", connector=channel)
                return
            except Exception:
                if retry == 5:
                    emit("offline", connector=channel)
                await asyncio.sleep(retry)
                retry = min(60, retry * 2)

    async def deliver(data):
        request, address = data["request"], data["address"]
        channel = manager.get_channel(address["connector"])
        proactive = data.get("proactive") is True
        sent, form = False, None
        if proactive and (address.get("direct") or address["kind"] not in ("dingtalk", "wecom", "telegram", "discord") or not any(
                row["id"] == address["connector"] and any(route.get("proactive") and route["chat"] == address["chat"]
                and route.get("thread") == address.get("thread") for route in row["routes"]) for row in configs)):
            emit("delivery", request=request, sent=False)
            return
        if channel and channel.channel_type == address["kind"] and (address["kind"] != "wecom" or channel.is_connected):
            try:
                if address["kind"] == "dingtalk":
                    reply = channel.publish_group(address["chat"], data["text"]) if proactive \
                        else channel.reply_original(address, data["text"], data.get("card"))
                else:
                    reply = channel.reply_text(reply_subject(address, proactive), data["text"])
                result = await asyncio.wait_for(reply, timeout=20)
                form = result if address["kind"] == "dingtalk" else None
                if data.get("delivery") is not None:
                    save_delivery(ledger, data["delivery"], address["connector"], form)
                sent = True
            except Exception:
                pass
        emit("delivery", request=request, sent=sent, **({"form": form} if form else {}))

    tasks = {asyncio.create_task(connect(row)) for row in configs}
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            data = json.loads(line)
            task = asyncio.create_task(deliver(data))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await manager.stop()


if __name__ == "__main__":
    # Platform SDK diagnostics can contain connection URLs. Keep only the structured pipe messages.
    logging.disable(logging.CRITICAL)
    sys.stdout = sys.stderr
    asyncio.run(main(json.loads(sys.stdin.readline()), sys.argv[1]))
