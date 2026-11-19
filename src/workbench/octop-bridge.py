"""Optional Octop transport and search adapters, plus Contractor’s text provider."""
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone


def gateway(data):
    from octop_gateway.channels.feishu import FeishuChannel, FeishuConfig

    channel = FeishuChannel(config=FeishuConfig(app_id=data["namespace"]), processor=lambda _: None,
                            channel_id=data["namespace"])
    incoming = channel.parse_inbound({
        "sender": {"sender_id": data["sender"], "sender_type": "user"}, "chat_id": data["chat"],
        "chat_type": "group", "thread_id": data["thread"], "message_id": data["id"],
        "message_type": "text", "content": json.dumps({"text": data["text"]}),
    })
    return {"text": incoming.text, "chat": incoming.metadata["chat_id"],
            "thread": incoming.channel_subject.subject_id, "namespace": incoming.channel_id,
            "id": incoming.metadata["message_id"], "sender": incoming.metadata["sender_id"]}


def search_terms(text):
    # Octop's unicode61 tokenizer treats a run of Han characters as one token.
    chunks = re.findall(r"[\u3400-\u9fff]+|[a-z0-9]+", text.lower())
    return list(dict.fromkeys(token for chunk in chunks for token in (
        [chunk[i:i + 2] for i in range(len(chunk) - 1)] if chunk[0] >= "\u3400" else [chunk]
    ) if len(token) >= 2))


def memory(data):
    from octop_memory.storage.backends.sqlite import SqliteMemoryBackend
    from octop_memory.types import AtomCard

    now = datetime.now(timezone.utc)
    store = SqliteMemoryBackend(namespace="contractor", db_path=":memory:")
    try:
        for row in data["entries"]:
            store.save_atom(AtomCard(
                id=row["id"], entity_id="project", candidate_id=row["rev"], raw_event_ids=[],
                assertion=row["text"], verbatim_quote="", quote_event_id="", search_terms=search_terms(row["text"]),
                occurred_at=now, confidence="high", importance="normal", created_at=now,
            ))
        exact = [item.id for item in store.search_atoms(data["query"], limit=6)]
        counts = Counter()
        strong = set(exact)
        for token in search_terms(data["query"])[:64]:
            for item in store.search_atoms(token, limit=12):
                counts[item.id] += 1
                if token.isascii():
                    strong.add(item.id)
        matches = [key for key, count in counts.most_common() if count >= 2 or key in strong]
        return list(dict.fromkeys(exact + matches))[:6]
    finally:
        store.close()


if __name__ == "__main__":
    try:
        op = sys.argv[1]
        if op == "serve-index":
            from octop_index import serve_index

            from octop_memory.storage.backends.sqlite import SqliteMemoryBackend  # Check the pinned dependency before announcing readiness.
            serve_index(sys.argv[2], memory)
            sys.exit(0)
        payload = json.load(sys.stdin)
        if op == "query-index":
            from octop_index import query_index

            result = query_index(payload)
        elif op == "execute":
            from deepseek_readonly import execute

            result = execute(payload)
        else:
            result = {"gateway": gateway, "memory": memory,
                "health": lambda _: {"ready": memory({"query": "contractorhealthcheck", "entries": []}) == []}}[op](payload)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception as error:
        print(type(error).__name__, file=sys.stderr)
        sys.exit(1)
