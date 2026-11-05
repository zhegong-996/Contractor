/** Adapted, with the user's authorization, from their ontology product-prototype
 * ai_bridge.py:validate_output and knowledge.py:public_snapshot. No Alice package code.
 * Exact quotation validates provenance, never the business meaning of an answer. */
export type EvidenceSource = { id: string; revision: string; body: string };
export function verifyEvidenceQuotes(quotes: { sourceId: string; quote: string }[], sources: EvidenceSource[]) {
  if (quotes.length > 8) throw new Error('引用数量超出本轮资料范围');
  const byId = new Map(sources.map(s => [s.id, s]));
  return quotes.map(q => {
    const source = byId.get(q.sourceId);
    if (!source || typeof q.quote !== 'string' || q.quote.trim().length < 4 || !source.body.includes(q.quote)) throw new Error('Agent 引用了不存在的证据或改写了原文');
    return { ...q, revision: source.revision };
  });
}
export function projectHistoricalEvidence(saved: { id: string; revision: string }[], current: EvidenceSource[]) {
  const byId = new Map(current.map(s => [s.id, s]));
  return saved.map(item => ({ ...item, state: !byId.has(item.id) ? 'revoked' : byId.get(item.id)!.revision !== item.revision ? 'historical' : 'current' }));
}
