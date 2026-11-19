"""Native Octop adapter fixtures. Run with the project's Octop virtualenv."""
import asyncio
import json
import logging
import runpy
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from octop_gateway import ChannelManager, TextContent
from octop_gateway.channels import register_channel_kind, unregister_channel_kind
from octop_gateway.channels.dingtalk import DingTalkChannel, DingTalkConfig, _DingTalkMessageHandler
from octop_gateway.channels.discord import DiscordChannel, DiscordConfig
from octop_gateway.channels.qq import QQChannel, QQConfig
from octop_gateway.channels.telegram import TelegramChannel
from octop_gateway.channels.wecom import WeComChannel, WeComConfig
from octop_gateway.channels.weixin import WeixinChannel, WeixinConfig
from websockets.asyncio.server import serve

src = Path(__file__).resolve().parents[1] / 'src/workbench'
sys.path.insert(0, str(src))
bridge = runpy.run_path(str(src / 'octop-im.py'))
normalize, reply_subject = bridge['normalize'], bridge['reply_subject']
QUESTION = '/consult 门店推荐理由小屏验收'


async def never_execute(_):
    raise AssertionError('The Gateway processor must never start an Agent')


class NativeOctopTransport(unittest.IsolatedAsyncioTestCase):
    def test_provider_ack_is_durable_before_the_gateway_pipe_reply(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'inbox.sqlite'
            delivery = 'a' * 32
            with sqlite3.connect(file) as db:
                db.execute('CREATE TABLE channel_delivery (id TEXT PRIMARY KEY, connector TEXT, acknowledged_at TEXT, form TEXT, uncertain_at TEXT)')
                db.execute('INSERT INTO channel_delivery(id,connector) VALUES (?,?)', (delivery, 'ding-test'))
            with self.assertRaises(RuntimeError):
                bridge['save_delivery'](file, delivery, 'another-connector', 'card')
            bridge['save_delivery'](file, delivery, 'ding-test', 'card')
            with sqlite3.connect(file) as db:
                at, form = db.execute('SELECT acknowledged_at,form FROM channel_delivery WHERE id=?', (delivery,)).fetchone()
                self.assertTrue(at.endswith('Z'))
                self.assertEqual(form, 'card')

    async def test_dingtalk_callback_is_persisted_before_sdk_ack_and_route_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'inbox.sqlite'
            with sqlite3.connect(file) as db:
                db.executescript('''
                    CREATE TABLE ingress_event (app TEXT,id TEXT,kind TEXT,lane TEXT,line TEXT,received INTEGER,due INTEGER, UNIQUE(app,id));
                    CREATE TABLE ingress_ack (app TEXT,id TEXT, acknowledged INTEGER, PRIMARY KEY(app,id));
                    CREATE TABLE ingress_reply_route (app TEXT,id TEXT,endpoint TEXT,expires INTEGER, PRIMARY KEY(app,id));
                ''')
            spool = bridge['GatewaySpool'](file)
            build = lambda journal: bridge['transport_only'](DingTalkChannel, journal.accept, spool=journal)(
                never_execute, config=DingTalkConfig(), channel_id='ding-test')
            channel = build(spool)
            channel._running = True
            channel.set_enqueue_callback(lambda _: self.fail('不得经过未持久化队列'))
            handler = _DingTalkMessageHandler(channel)
            webhook = 'https://oapi.dingtalk.com/robot/sendBySession?session=fixture'
            callback = SimpleNamespace(data={'msgId': 'menu-feedback', 'senderStaffId': 'member-2',
                'conversationId': 'store-chat', 'conversationType': '2', 'msgtype': 'text', 'text': {'content': QUESTION}, 'sessionWebhook': webhook})
            self.assertEqual((await handler.process(callback))[0], 200)
            self.assertEqual((await handler.process(callback))[0], 200)
            with sqlite3.connect(file) as db:
                [(event_id, line)] = db.execute('SELECT id,line FROM ingress_event').fetchall()
                db.execute("INSERT INTO ingress_ack VALUES ('octop:ding-test',?,0)", (event_id,))
                db.execute('DELETE FROM ingress_event')
            event = json.loads(line)
            self.assertNotIn(webhook, line)
            restarted = build(bridge['GatewaySpool'](file))
            restarted._running = True
            restarted.set_enqueue_callback(lambda _: self.fail('重启后仍应同步落盘'))
            self.assertEqual((await _DingTalkMessageHandler(restarted).process(callback))[0], 200)
            with sqlite3.connect(file) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM ingress_event').fetchone()[0], 0)
            response = SimpleNamespace(status=200, json=AsyncMock(return_value={'errcode': 0}))
            post = MagicMock()
            post.return_value.__aenter__.return_value = response
            restarted._ensure_http = AsyncMock(return_value=SimpleNamespace(post=post))
            await restarted.reply_original(event['address'], '咨询已处理')
            post.assert_called_once_with(webhook, json={'msgtype': 'text', 'text': {'content': '咨询已处理'}}, allow_redirects=False)

    async def test_dingtalk_manager_constructs_typed_config_from_local_credentials(self):
        bridge_type = bridge['transport_only'](DingTalkChannel, lambda _: None)
        kind = 'contractor-dingtalk-config-test'
        register_channel_kind(kind, bridge_type, plugin_id='test')
        manager = ChannelManager(processor=never_execute, media_backend=bridge['NoMedia']())
        try:
            with patch.object(DingTalkChannel, 'start', new_callable=AsyncMock) as start:
                await manager.start()
                channel = await manager.add_channel(channel_type=kind, channel_id='ding-test',
                    config={'app_key': 'test-id', 'app_secret': 'test-secret', 'group_context': {'enabled': False}})
                self.assertIsInstance(manager.get_channel(channel)._config, DingTalkConfig)
                start.assert_awaited_once()
        finally:
            await manager.stop()
            unregister_channel_kind(kind, plugin_id='test')

    async def test_dingtalk_reply_requires_the_original_callback_and_vendor_ack(self):
        inbox, statuses = [], []
        channel = bridge['transport_only'](DingTalkChannel, inbox.append, lambda name, ready: statuses.append((name, ready)))(
            never_execute, config=DingTalkConfig(), channel_id='ding-test')
        callback = {'msg_id': '27', 'sender_id': '87', 'conversation_id': 'ding-group', 'conversation_type': '2',
            'msgtype': 'text', 'text': {'content': QUESTION}}
        response = SimpleNamespace(status=200, json=AsyncMock(return_value={'errcode': 0}))
        post = MagicMock()
        post.return_value.__aenter__.return_value = response
        channel._ensure_http = AsyncMock(return_value=SimpleNamespace(post=post))
        await channel.handle_inbound({**callback, 'webhook_url': 'https://oapi.dingtalk.com.evil.invalid/robot/sendBySession?session=x'})
        with self.assertRaises(RuntimeError):
            await channel.reply_original(inbox[-1]['address'], '联调收到')
        post.assert_not_called()
        url = 'https://oapi.dingtalk.com/robot/sendBySession?session=fixture'
        await channel.handle_inbound({**callback, 'webhook_url': url})
        address = inbox[-1]['address']
        self.assertNotIn('session=fixture', repr(inbox))
        self.assertEqual(statuses[-1], ('ding-test', True))
        with self.assertRaises(RuntimeError):
            await channel.reply_original({**address, 'chat': 'another-group'}, '联调收到')
        await channel.reply_original(address, '联调收到')
        post.assert_called_once_with(url, json={'msgtype': 'text', 'text': {'content': '联调收到'}}, allow_redirects=False)
        response.json.return_value = {'errcode': 999}
        with self.assertRaises(RuntimeError):
            await channel.reply_original(address, '联调收到')

    async def test_dingtalk_consultation_card_uses_original_member_and_single_safe_fallback(self):
        inbox = []
        channel = bridge['transport_only'](DingTalkChannel, inbox.append)(never_execute, config=DingTalkConfig(), channel_id='ding-test')
        webhook = 'https://oapi.dingtalk.com/robot/sendBySession?session=fixture'
        await channel.handle_inbound({'msg_id': '27', 'sender_id': '87', 'conversation_id': 'direct-chat', 'conversation_type': '1',
            'msgtype': 'text', 'text': {'content': QUESTION}, 'webhook_url': webhook})
        address = inbox[0]['address']
        card = {'url': 'https://contractor.example/#/store/project/reasons?tab=chat&reply=125', 'delivery': 'a' * 32}
        api = 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver'
        response = SimpleNamespace(status=200, json=AsyncMock(return_value={'success': True, 'result': {
            'outTrackId': 'contractor-' + card['delivery'], 'deliverResults': [{'spaceType': 'IM_ROBOT', 'spaceId': '87', 'success': True}]}}))
        reply = SimpleNamespace(status=200, json=AsyncMock(return_value={'errcode': 0}))
        post = MagicMock(side_effect=lambda url, **_: self._response_context(response if url == api else reply))
        channel._ensure_http = AsyncMock(return_value=SimpleNamespace(post=post))
        channel._get_auth_headers = AsyncMock(return_value={'x-acs-dingtalk-access-token': 'fixture'})
        self.assertEqual(await channel.reply_original(address, '只显示入口', card), 'card')
        self.assertEqual(post.call_count, 1)
        body = post.call_args.kwargs['json']
        self.assertEqual(body['openSpaceId'], 'dtv1.card//IM_ROBOT.87')
        self.assertFalse(body['imRobotOpenSpaceModel']['supportForward'])
        button = json.loads(body['cardData']['cardParamMap']['sys_full_json_obj'])['msgButtons'][0]
        self.assertEqual(button['url'], card['url'])
        self.assertNotIn('只显示入口', repr(body))
        response.status = 403
        post.reset_mock()
        self.assertEqual(await channel.reply_original(address, '只显示入口', card), 'markdown')
        self.assertEqual([call.args[0] for call in post.call_args_list], [api, webhook])
        self.assertIn(card['url'], post.call_args.kwargs['json']['markdown']['text'])
        response.status = 503
        post.reset_mock()
        with self.assertRaises(RuntimeError):
            await channel.reply_original(address, '只显示入口', card)
        self.assertEqual(post.call_count, 1)

    @staticmethod
    def _response_context(response):
        context = MagicMock()
        context.__aenter__.return_value = response
        return context

    async def test_wecom_authentication_and_reconnect_are_distinct_from_start(self):
        status = []
        inbound = []
        channel = bridge['transport_only'](WeComChannel, inbound.append, lambda name, ready: status.append((name, ready)))(
            never_execute, config=WeComConfig(), channel_id='wecom')
        self.assertFalse(channel.is_connected)
        self.assertEqual(status, [])
        channel._on_authenticated()
        self.assertTrue(channel.is_connected)
        await channel.handle_inbound({'msgid': '78', 'chattype': 'single', 'chatid': 'unused-private-chat-id',
            'from': {'userid': '87'}, 'msgtype': 'text', 'text': {'content': QUESTION}})
        channel._on_disconnected()
        self.assertFalse(channel.is_connected)
        channel._on_authenticated()
        self.assertTrue(channel.is_connected)
        self.assertEqual(status, [('wecom', True), ('wecom', False), ('wecom', True)])
        self.assertEqual(reply_subject(inbound[0]['address']).metadata['chat_id'], '87')

    async def test_wecom_sdk_receives_and_acknowledges_original_conversation(self):
        auth_frame = asyncio.Event()
        allow_auth = asyncio.Event()
        outbound = asyncio.Queue()
        inbound = asyncio.Queue()
        statuses = asyncio.Queue()

        async def wire(socket):
            frame = json.loads(await socket.recv())
            if frame['cmd'] != 'aibot_subscribe':
                return
            auth_frame.set()
            await allow_auth.wait()
            await socket.send(json.dumps({'headers': frame['headers'], 'errcode': 0}))
            await socket.send(json.dumps({'cmd': 'aibot_msg_callback', 'headers': {'req_id': 'callback-91'}, 'body': {
                'msgid': 'msg-91', 'chattype': 'group', 'chatid': 'wecom-actual-address', 'from': {'userid': 'test-user'},
                'msgtype': 'text', 'text': {'content': QUESTION}}}))
            frame = json.loads(await socket.recv())
            await socket.send(json.dumps({'headers': frame['headers'], 'errcode': 0}))
            await outbound.put(frame)
            await socket.wait_closed()

        async with serve(wire, '127.0.0.1', 0) as network:
            port = network.sockets[0].getsockname()[1]
            channel = bridge['transport_only'](WeComChannel, inbound.put_nowait, lambda _, ready: statuses.put_nowait(ready))(
                never_execute, config=WeComConfig(bot_id='local-fixture', secret='fixture-only', ws_url=f'ws://127.0.0.1:{port}'),
                channel_id='wecom')
            manager = ChannelManager({'wecom': channel}, processor=never_execute, workers_per_channel=1)
            # Suppress the platform SDK's diagnostic prints only in the test.
            with patch('wecom_aibot_sdk.client.DefaultLogger', return_value=logging.getLogger('wecom-sdk-fixture')):
                await manager.start()
                try:
                    await asyncio.wait_for(auth_frame.wait(), 3)
                    self.assertTrue(statuses.empty())
                    self.assertFalse(channel.is_connected)
                    allow_auth.set()
                    self.assertTrue(await asyncio.wait_for(statuses.get(), 3))
                    event = await asyncio.wait_for(inbound.get(), 3)
                    self.assertEqual(event['address']['message'], 'msg-91')
                    await asyncio.wait_for(channel.reply_text(reply_subject(event['address']), '咨询已处理。'), 3)
                    reply = await asyncio.wait_for(outbound.get(), 3)
                    self.assertEqual(reply['cmd'], 'aibot_send_msg')
                    self.assertEqual(reply['body']['chatid'], 'wecom-actual-address')
                    self.assertEqual(reply['body']['markdown']['content'], '咨询已处理。')
                finally:
                    allow_auth.set()
                    await manager.stop()

    async def test_manager_keeps_telegram_topics_distinct_and_does_not_execute(self):
        received = asyncio.Queue()
        kind = 'contractor-telegram-test'
        register_channel_kind(kind, bridge['transport_only'](TelegramChannel, received.put_nowait), plugin_id='contractor-test')
        manager = ChannelManager(processor=never_execute, control_message_predicate=lambda _: True, workers_per_channel=1)
        await manager.start()
        with patch.object(TelegramChannel, 'start', AsyncMock()), patch.object(TelegramChannel, 'stop', AsyncMock()):
            try:
                await manager.add_channel(channel_type=kind, channel_id='team', config={'bot_token': 'test'})
                message = {'chat_id': '-100', 'user_id': '87', 'message_id': '27', 'is_group': True, 'content': [TextContent(text=QUESTION)]}
                for number in (7, 8):
                    manager.enqueue('team', {**message, 'message_thread_id': number})
                rows = [await asyncio.wait_for(received.get(), 2) for _ in range(2)]
                self.assertEqual([row['address']['thread'] for row in rows], ['7', '8'])
                reply = reply_subject(rows[0]['address'])
                self.assertEqual(reply.metadata['chat_id'], '-100')
                self.assertEqual(reply.metadata['message_thread_id'], 7)
                self.assertEqual(reply.metadata['source_message_id'], '27')
                self.assertFalse(rows[0]['address']['direct'])
            finally:
                await manager.stop()
                unregister_channel_kind(kind, plugin_id='contractor-test')

    def test_native_chat_and_sender_fields(self):
        discord = DiscordChannel(never_execute, config=DiscordConfig(), channel_id='discord-test')
        qq = QQChannel(never_execute, config=QQConfig(), channel_id='qq-test')
        wecom = WeComChannel(never_execute, config=WeComConfig(), channel_id='wecom-test')
        ding = DingTalkChannel(never_execute, config=DingTalkConfig(), channel_id='ding-test')
        wx = WeixinChannel(never_execute, config=WeixinConfig(), channel_id='wx-test')
        events = [
            discord.parse_inbound(SimpleNamespace(id=27, author=SimpleNamespace(id=87, display_name='测试'),
                guild=SimpleNamespace(id=500), channel=SimpleNamespace(id=123, parent_id=456, name='小屏'),
                content=QUESTION, attachments=[], created_at=datetime.now(timezone.utc))),
            qq.parse_inbound({'t': 'GROUP_MESSAGE_CREATE', 'd': {'id': '27', 'group_openid': 'qq-group',
                'author': {'member_openid': '87'}, 'content': QUESTION}}),
            wecom.parse_inbound({'msgid': '27', 'chattype': 'group', 'chatid': 'wecom-group', 'from': {'userid': '87'},
                'msgtype': 'text', 'text': {'content': '@门店助手\u2005' + QUESTION}, 'response_url': 'https://example.invalid/private'}),
            ding.parse_inbound({'msg_id': '27', 'sender_id': '87', 'conversation_id': 'ding-group', 'conversation_type': '2',
                'msgtype': 'text', 'text': {'content': QUESTION}, 'webhook_url': 'https://example.invalid/private'}),
            wx.parse_inbound({'message_id': '27', '_account_id': 'account', 'from_user_id': '87', 'content': QUESTION,
                'context_token': 'private-token'}),
        ]
        rows = [normalize(event) for event in events]
        self.assertEqual([row['address']['chat'] for row in rows], ['123', 'qq-group', 'wecom-group', 'ding-group', 'account:87'])
        self.assertEqual([row['address']['sender'] for row in rows], ['87', '87', '87', '87', 'account:87'])
        self.assertEqual([row['address']['direct'] for row in rows], [False, False, False, False, True])
        self.assertNotIn('private', repr(rows))
        self.assertEqual(reply_subject(rows[0]['address']).metadata['chat_id'], '123')
        self.assertEqual(reply_subject(rows[1]['address']).metadata['group_openid'], 'qq-group')
        self.assertEqual(reply_subject(rows[2]['address']).metadata['chat_id'], 'wecom-group')
        for row in rows[3:]:
            with self.assertRaises(ValueError):
                reply_subject(row['address'])


if __name__ == '__main__':
    unittest.main()
