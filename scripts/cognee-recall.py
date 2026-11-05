"""Read only authorized version graphs and run pinned Cognee BM25; no model calls."""
import asyncio, json, sys
from cognee.infrastructure.databases.graph.ladybug.adapter import LadybugAdapter
from cognee.modules.retrieval.bm25_retriever import BM25ChunksRetriever

async def main():
    p = json.loads(sys.stdin.read())
    retriever = BM25ChunksRetriever(top_k=p.get("limit", 8), with_scores=True, stop_words=[])
    # Corpus injection binds the original scorer to ONLY the permission-filtered
    # graphs passed by the control plane, avoiding the global all-dataset engine.
    payloads = {}
    for source in p["sources"]:
        db = LadybugAdapter(db_path=source["path"], kuzu_num_threads=2,
            kuzu_buffer_pool_size=128*1024*1024, kuzu_max_db_size=1024*1024*1024)
        try:
            nodes, _ = await db.get_graph_data()
            for node_id, value in nodes:
                if value.get("type") in ("MemoryChunk", "KnowledgeConcept") and value.get("source_revision") == source["revision"]:
                    key = str(node_id)
                    payloads[key] = {"sourceId": source["id"], "revision": source["revision"],
                        "chunkId": key, "text": value.get("text") or value.get("evidence"), "title": source.get("title") or value.get("name"),
                        "concept": value.get("name") if value.get("type") == "KnowledgeConcept" else None,
                        "relations": [{"relation": r, "evidence": props.get("evidence")} for a,b,r,props in _ if str(a)==key or str(b)==key]}
                    retriever.chunks[key] = source["tokens"].get(key, [])
        finally:
            await db.close()
    retriever._initialized = True
    await retriever.initialize()  # actual upstream corpus statistics, no external engine
    hits = sorted(((key, retriever._scorer(p["queryTokens"], tokens))
        for key, tokens in retriever.chunks.items()), key=lambda hit: hit[1], reverse=True)
    print("SUITME_RECALL_RESULT=" + json.dumps({"engine":"Cognee BM25", "modelCalls":0,
        "hits":[{**payloads[key], "score":score} for key, score in hits[:p.get("limit",8)] if score > 0]}, ensure_ascii=False))
asyncio.run(main())
