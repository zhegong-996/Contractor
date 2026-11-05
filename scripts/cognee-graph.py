"""Thin RPC over pinned Cognee storage; no LLM, embedding or extraction calls.

Permission, source selection and revision validation happen in the SuitMe
control plane before this process starts. Each source revision has its own
physical graph, so graph reads cannot traverse an unauthorized source.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

os.environ["TELEMETRY_DISABLED"] = "1"

from cognee.infrastructure.engine import DataPoint
from cognee.infrastructure.databases.graph.ladybug.adapter import LadybugAdapter
from cognee.infrastructure.databases.provenance.source_refs import make_source_ref_key


class SourceDocument(DataPoint):
    name: str
    body: str
    source_id: str
    source_revision: str
    state: str


class MemoryChunk(DataPoint):
    name: str
    text: str
    source_id: str
    source_revision: str
    chunk_index: int


class KnowledgeConcept(DataPoint):
    name: str
    concept_type: str
    evidence: str
    source_id: str
    source_revision: str


class KnowledgeField(DataPoint):
    name: str
    value_json: str
    data_type: str
    source_id: str
    source_revision: str


async def main():
    request = json.loads(sys.stdin.read())
    db_path = os.environ["SUITME_GRAPH_PATH"]
    Path(db_path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = LadybugAdapter(db_path=db_path, kuzu_num_threads=2,
        kuzu_buffer_pool_size=128 * 1024 * 1024, kuzu_max_db_size=1024 * 1024 * 1024)
    try:
        if request["op"] == "project":
            source = request["source"]
            source_id, revision = source["id"], source["revision"]
            root_id = uuid5(NAMESPACE_URL, "suitme:" + source_id + "@" + revision)
            nodes = [SourceDocument(id=root_id, name=source["title"], body=source["body"],
                source_id=source_id, source_revision=revision, state=source["state"])]
            edges = []
            for name, value in source["facts"].items():
                node_id = uuid5(root_id, name)
                data_type = "boolean" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "string"
                nodes.append(KnowledgeField(id=node_id, name=name, value_json=json.dumps(value, ensure_ascii=False),
                    data_type=data_type, source_id=source_id, source_revision=revision))
                edges.append((str(root_id), str(node_id), "has_field", {"source_revision": revision}))
            # Bounded content formatting only; Cognee stores the chunks and owns
            # BM25 ranking. Identity is the original content-derived chunk helper.
            from cognee.modules.chunking.chunk_id import chunk_content_hash, content_chunk_id
            text = source["title"] + "\n" + source["body"] + "\n" + json.dumps(source["facts"], ensure_ascii=False)
            for offset in range(0, len(text), 1400):
                part = text[offset:offset + 1400]
                chunk_id = content_chunk_id(str(root_id), chunk_content_hash(part), offset // 1400)
                nodes.append(MemoryChunk(id=chunk_id, name=source["title"], text=part,
                    source_id=source_id, source_revision=revision, chunk_index=offset // 1400))
                edges.append((str(root_id), str(chunk_id), "has_chunk", {"source_revision": revision}))
            concepts = {}
            for item in source.get("annotations", {}).get("concepts", []):
                node_id = uuid5(root_id, "concept:" + item["key"])
                concepts[item["key"]] = str(node_id)
                nodes.append(KnowledgeConcept(id=node_id, name=item["name"], concept_type=item["type"],
                    evidence=item["quote"], source_id=source_id, source_revision=revision))
                edges.append((str(root_id), str(node_id), "mentions", {"evidence": item["quote"]}))
            for item in source.get("annotations", {}).get("relations", []):
                edges.append((concepts[item["from"]], concepts[item["to"]], item["predicate"],
                    {"evidence": item["quote"], "source_revision": revision}))
            provenance = make_source_ref_key(root_id, UUID(source_id))
            await db.add_nodes(nodes, source_ref_key=provenance)
            await db.add_edges(edges, source_ref_key=provenance)
        elif request["op"] != "read":
            raise ValueError("Unsupported graph operation")
        nodes, edges = await db.get_graph_data()
        result = {"engine": "cognee", "storage": "Ladybug", "modelCalls": 0,
            "nodes": [{"id": node_id, **properties} for node_id, properties in nodes],
            "edges": [{"source": source, "target": target, "relation": relation, **properties}
                for source, target, relation, properties in edges]}
        print("SUITME_COGNEE_RESULT=" + json.dumps(result, ensure_ascii=False, default=str))
    finally:
        await db.close()


try:
    asyncio.run(main())
except Exception as error:
    print("SUITME_COGNEE_RESULT=" + json.dumps({"error": type(error).__name__}))
    raise
