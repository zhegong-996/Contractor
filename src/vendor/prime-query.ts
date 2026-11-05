// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 Prime Intellect Ltd.
// TypeScript port of prime-agent-runtime/src/rlm/harness.py:_harness_query_runs/_harness_query_terms
// and crates/pa-core/src/session_engine/harness_digest.rs:digest_query_terms.
// Source commit 74591cddef28d11249c3171112114fc4755375d7. Full notices: THIRD_PARTY_NOTICES.md.
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}\u{2ebf0}-\u{2ee5f}\u{2f800}-\u{2fa1f}\u{30000}-\u{3134f}\u{31350}-\u{323af}\u{323b0}-\u{3347f}]/u;
export function primeQueryTerms(query: string): string[] {
  const runs: string[] = []; let run = '', isCjk = false;
  for (const ch of query.toLowerCase()) {
    if (/[\p{M}\p{L}\p{N}]/u.test(ch)) {
      const nextCjk = cjk.test(ch); if (run && nextCjk !== isCjk) { runs.push(run); run = ''; }
      isCjk = nextCjk; run += ch;
    } else if (run) { runs.push(run); run = ''; }
  }
  if (run) runs.push(run);
  const terms = new Set<string>();
  for (const value of runs) {
    const chars = Array.from(value);
    const candidates = cjk.test(value) ? (chars.length > 1 ? chars.slice(0, -1).map((_, i) => chars.slice(i, i + 2).join('')) : [value])
      : /^[\x00-\x7f]*$/.test(value) ? chars.length >= 3 ? [value] : [] : chars.length >= 2 ? [value] : [];
    for (const term of candidates) terms.add(term);
  }
  return [...terms];
}
export function primeDigestQueryTerms(goal: string, recentTextsNewestFirst: string[]): Map<string, number> {
  const terms = new Map<string, number>();
  const add = (text: string, weight: number) => { for (const term of primeQueryTerms(text)) { if (terms.size >= 48 && !terms.has(term)) return; if (!terms.has(term)) terms.set(term, weight); } };
  add(goal, 3); let weight = 2;
  for (const text of recentTextsNewestFirst.slice(0, 4)) { add(text, weight); weight = Math.max(1, weight - 0.5); }
  return terms;
}
