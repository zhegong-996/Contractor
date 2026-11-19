"""A single delegated text request. The caller owns the execution lifecycle."""

import json
import re
import urllib.request


API = "https://api.deepseek.com/anthropic/v1/messages"
MAX_RESPONSE_BYTES = 512 * 1024


class RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_message(payload, key):
    request = urllib.request.Request(
        API, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
        method="POST",
    )
    with urllib.request.build_opener(RejectRedirect()).open(request, timeout=85) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("model response too large")
        return json.loads(raw)


def token_receipt(value):
    if not isinstance(value, dict):
        return None
    keys = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    if any(type(value.get(key, 0)) is not int or value.get(key, 0) < 0 for key in keys):
        raise ValueError("invalid usage")
    if "input_tokens" not in value or "output_tokens" not in value:
        return None
    cached = value.get("cache_read_input_tokens", 0) + value.get("cache_creation_input_tokens", 0)
    return {"input": value["input_tokens"] + cached, "output": value["output_tokens"], "cached": cached}


def execute(data, transport=request_message):
    model = data["model"]
    if not re.fullmatch(r"deepseek-[a-z0-9.-]{1,70}", model):
        raise ValueError("invalid provisioned model")
    payload = {
        "model": model, "max_tokens": 4096, "stream": False,
        "system": data["prompt"],
        "messages": [{"role": "user", "content": data["context"]}],
    }
    if data.get("consultation"):
        payload["thinking"] = {"type": "disabled"}
    message = transport(payload, data["key"])
    if message.get("type") != "message" or message.get("role") != "assistant":
        raise ValueError("invalid model response")
    blocks = message.get("content")
    if not isinstance(blocks, list) or any(not isinstance(block, dict) or block.get("type") not in (
        "text", "thinking", "redacted_thinking",
    ) for block in blocks):
        raise ValueError("unexpected model output")
    text_blocks = [block.get("text") for block in blocks if block["type"] == "text"]
    if any(not isinstance(text, str) for text in text_blocks):
        raise ValueError("invalid text block")
    text = "\n".join(text_blocks).strip()
    if "DSML" in text or len(text) > 24000:
        raise ValueError("invalid model text")
    return {"text": text, "model": message.get("model"), "usage": token_receipt(message.get("usage")),
            "session": data["session"], "stopReason": message.get("stop_reason")}
