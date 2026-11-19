import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "workbench"))
from deepseek_readonly import RejectRedirect, execute


class ReadonlyExpert(unittest.TestCase):
    def setUp(self):
        self.request = {
            "model": "deepseek-v4-pro", "key": "fixture-only", "session": "session",
            "prompt": "整理口径", "context": "280px", "consultation": True,
        }
        self.response = {
            "type": "message", "role": "assistant", "stop_reason": "end_turn",
            "model": "deepseek-v4-pro",
            "content": [{"type": "thinking", "thinking": "internal"}, {"type": "text", "text": "核对 280px"}],
            "usage": {"input_tokens": 10, "output_tokens": 6, "cache_read_input_tokens": 4},
        }

    def test_delegates_read_only_model_and_accounts_for_cached_input(self):
        def transport(payload, key):
            self.assertEqual(key, "fixture-only")
            self.assertEqual(payload["messages"], [{"role": "user", "content": "280px"}])
            self.assertEqual(payload["thinking"], {"type": "disabled"})
            self.assertNotIn("tools", payload)
            return self.response
        reply = execute(self.request, transport)
        self.assertEqual(reply["text"], "核对 280px")
        self.assertEqual(reply["usage"], {"input": 14, "output": 6, "cached": 4})
        self.assertEqual(reply["stopReason"], "end_turn")

    def test_unknown_amount_and_truncation_remain_explicit(self):
        self.response["usage"] = {"input_tokens": 18}
        self.response["stop_reason"] = "max_tokens"
        reply = execute(self.request, lambda *_: self.response)
        self.assertIsNone(reply["usage"])
        self.assertEqual(reply["stopReason"], "max_tokens")

    def test_rejects_tool_calls_and_redirects(self):
        self.response["content"].append({"type": "tool_use", "name": "filesystem"})
        with self.assertRaises(ValueError):
            execute(self.request, lambda *_: self.response)
        self.assertIsNone(RejectRedirect().redirect_request(None, None, 307, "", {}, "https://example.invalid"))


if __name__ == "__main__":
    unittest.main()
