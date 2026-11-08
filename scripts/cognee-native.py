"""Cognee 原生 LLM / embedding / cognify / 语义检索 RPC。

与 scripts/cognee-graph.py 的分工：那个脚本是「只读 L1 投影，零模型调用」，
本脚本走 Cognee 原生管线（LLM 实体抽取 + embedding + cognify），由
src/cognee-native.ts 通过进程环境注入 provider / endpoint / 凭据。

凭据只存在于进程环境，绝不写文件；数据目录固定到 .runtime/cognee-native/。
用户 2026-11-07 明确允许外部 OpenAI-compatible 模型 API，业务材料会外发。
"""
import asyncio
import json
import os
import sys

os.environ["TELEMETRY_DISABLED"] = "1"


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"请求体不是合法 JSON：{error}")


def status():
    return {
        "ok": True,
        "action": "status",
        "configured": bool(os.environ.get("LLM_API_KEY") and os.environ.get("LLM_ENDPOINT")),
        "provider": os.environ.get("LLM_PROVIDER", ""),
        "llmModel": os.environ.get("LLM_MODEL", ""),
        "embeddingModel": os.environ.get("EMBEDDING_MODEL", ""),
        "extractor": "llm",
    }


async def cognify(payload):
    import cognee

    texts = payload.get("texts")
    if not isinstance(texts, list) or not texts or not all(isinstance(t, str) and t.strip() for t in texts):
        raise ValueError("cognify 需要非空的 texts 字符串数组")
    dataset = payload.get("dataset") or "suitme-native"
    await cognee.add(texts, dataset_name=dataset)
    options = {"datasets": [dataset], "extractor": "llm", "raise_on_error": True}
    ontology = payload.get("ontologyFilePath")
    if ontology:
        options["ontology_file_path"] = ontology
    await cognee.cognify(**options)
    return {"ok": True, "action": "cognify", "dataset": dataset,
            "documents": len(texts), "extractor": "llm", "embedding": "native"}


def to_jsonable(value):
    """把 cognee.search 的返回项转成可 JSON 序列化的结构（dict 保留字段，其余转字符串）。"""
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


async def search(payload):
    import cognee

    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("search 需要非空 query")
    dataset = payload.get("dataset") or "suitme-native"
    results = await cognee.search(query_text=query, datasets=[dataset],
                                  top_k=int(payload.get("topK") or 10))
    items = results if isinstance(results, list) else [results]
    return {"ok": True, "action": "search", "dataset": dataset,
            "results": [to_jsonable(item) for item in items[:10] if item is not None]}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    try:
        payload = read_payload()
        if action == "status":
            result = status()
        elif action == "cognify":
            result = asyncio.run(cognify(payload))
        elif action == "search":
            result = asyncio.run(search(payload))
        else:
            raise ValueError(f"未知 action：{action}")
    except Exception as error:  # 明确报错，绝不静默降级成设备端能力
        result = {"ok": False, "action": action, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
