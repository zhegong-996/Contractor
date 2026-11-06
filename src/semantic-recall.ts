// Local vector recall for team memory — hybrid with the pinned Cognee BM25.
//
// The embedding is Apple's on-device NaturalLanguage word embedding (300-dim
// zh-Hans + 300-dim en), so it needs no API key, no downloadable weights and
// no network egress. On non-Apple hosts it degrades to a deterministic
// character-bigram hashing vector, which still keeps the vector-search path
// (and its permissions/version checks) testable. Cognee's own LLM/cognify
// pipeline is NOT started: this adapter reads the same authorised L1 graphs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './config.ts';

export const SEMANTIC_DIMENSION = 600;
export const APPLE_EMBEDDING_ENGINE = 'apple-nl-on-device-word-embedding';
export const FALLBACK_EMBEDDING_ENGINE = 'local-hashed-bigram-vector';

export interface EmbeddingBatch { engine: string; dimension: number; vectors: number[][]; }
export interface SemanticChunk {
  chunkId: string;
  text: string;
  title?: string;
  concept?: string | null;
  sourceId: string;
  revision: string;
  vector: number[];
}
export interface SemanticIndexFile {
  schemaVersion: 1;
  engine: string;
  dimension: number;
  createdAt: string;
  chunks: SemanticChunk[];
}

/** Deterministic fallback: signed hashing of character bigrams, L2-normalised. */
export function hashedEmbedding(text: string, dimension = SEMANTIC_DIMENSION): number[] {
  const value = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  const vector = new Array<number>(dimension).fill(0);
  const grams: string[] = [];
  for (let i = 0; i + 1 < value.length; i++) grams.push(value.slice(i, i + 2));
  if (!grams.length && value.length) grams.push(value);
  for (const gram of grams) {
    let hash = 2166136261;
    for (const char of gram) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
    const index = Math.abs(hash) % dimension;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  return norm > 0 ? vector.map(v => Math.round((v / norm) * 10000) / 10000) : vector;
}

/** Batch embedding: one Swift process for all chunks, then L2 cosine at query time. */
export function embedTexts(texts: string[], opts: { swiftBin?: string; scriptPath?: string; allowFallback?: boolean } = {}): EmbeddingBatch {
  const swiftBin = opts.swiftBin ?? '/usr/bin/swift';
  const scriptPath = opts.scriptPath ?? path.join(root, 'scripts/apple-embedding.swift');
  if (existsSync(swiftBin) && existsSync(scriptPath)) {
    const result = spawnSync(swiftBin, [scriptPath], {
      input: JSON.stringify({ texts }), encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    const line = String(result.stdout ?? '').split('\n').find(l => l.startsWith('SUITME_EMBEDDING_RESULT='));
    if (result.status === 0 && line) {
      const parsed = JSON.parse(line.slice('SUITME_EMBEDDING_RESULT='.length)) as {
        engine: string; dimension: number; vectors: number[][];
      };
      if (parsed.vectors.length === texts.length && parsed.vectors.every(v => v.length === parsed.dimension))
        return { engine: parsed.engine, dimension: parsed.dimension, vectors: parsed.vectors };
    }
  }
  if (opts.allowFallback === false) throw new Error('设备端词向量不可用，且未允许降级');
  return { engine: FALLBACK_EMBEDDING_ENGINE, dimension: SEMANTIC_DIMENSION,
    vectors: texts.map(text => hashedEmbedding(text)) };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export interface FusedHit {
  chunkId: string;
  score: number;
  lexicalScore: number | null;
  semanticScore: number;
  via: 'hybrid' | 'lexical' | 'semantic';
  [key: string]: unknown;
}

/** Reciprocal-rank fusion of Cognee BM25 and local vector similarity.
 *  Semantic-only hits must clear a small positive threshold so noise from an
 *  unrelated query cannot outrank a real lexical hit. */
export function fuseRecall(input: {
  lexicalHits: Record<string, unknown>[];
  chunks: SemanticChunk[];
  queryVector: number[];
  weight?: number;
  limit?: number;
  semanticThreshold?: number;
}): FusedHit[] {
  const weight = Math.min(1, Math.max(0, input.weight ?? 0.45));
  const limit = input.limit ?? 8;
  const threshold = input.semanticThreshold ?? 0.08;
  const lexicalRank = new Map<string, number>();
  const lexical = new Map<string, Record<string, unknown>>();
  input.lexicalHits.forEach((hit, index) => {
    const key = String(hit.chunkId ?? '');
    if (!lexicalRank.has(key)) lexicalRank.set(key, index);
    lexical.set(key, hit);
  });
  const semantic = new Map<string, number>();
  for (const chunk of input.chunks) semantic.set(chunk.chunkId, cosine(input.queryVector, chunk.vector));
  const keys = new Set([...lexical.keys(), ...semantic.keys()]);
  const fused: FusedHit[] = [];
  for (const key of keys) {
    const rank = lexicalRank.get(key);
    const sim = semantic.get(key) ?? 0;
    if (rank === undefined && sim < threshold) continue;
    const lexicalPart = rank === undefined ? 0 : (1 - weight) / (1 + rank);
    const semanticPart = weight * Math.max(0, sim);
    const payload = lexical.get(key) ?? input.chunks.find(c => c.chunkId === key);
    if (!payload) continue;
    const via: FusedHit['via'] = rank === undefined ? 'semantic' : sim >= threshold ? 'hybrid' : 'lexical';
    fused.push({ ...(payload as Record<string, unknown>), chunkId: key,
      score: Math.round((lexicalPart + semanticPart) * 10000) / 10000,
      lexicalScore: rank === undefined ? null : Number((payload as any).score ?? 0),
      semanticScore: Math.round(sim * 10000) / 10000, via });
  }
  return fused.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Read the per-revision semantic index written by TeamMemory.index. */
export function readSemanticIndex(file: string): SemanticIndexFile | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as SemanticIndexFile;
    return parsed.schemaVersion === 1 && Array.isArray(parsed.chunks) ? parsed : null;
  } catch { return null; }
}
