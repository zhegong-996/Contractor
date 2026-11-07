// B 阶段只读验收：从真实记忆事件日志重放四类投影，并现场核对三条红线。
// 用法：npm run memory:replay
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { readBridgedEvents } from '../src/memory-log.ts';
import { memoryReplayReport, recallMemory } from '../src/memory-projections.ts';

const WIRING = [
  ['src/workspaces.ts', '来源确认 / 撤回、授权撤销'],
  ['src/v06.ts', 'L2 边草稿 / 接受 / 作废、Context Pack'],
  ['src/team-memory.ts', 'L1 索引与 BM25 词向量'],
  ['src/controller.ts', '业务验收记录'],
  ['src/server.ts', '主干审计投影与只读 memory-replay'],
] as const;

const wiring = WIRING.map(([file, purpose]) => {
  const source = readFileSync(path.join(root, file), 'utf8');
  const calls = (source.match(/recordMemory\(/g) ?? []).length;
  return { file, purpose, recordCalls: calls,
    wired: file === 'src/server.ts'
      ? source.includes('getMemoryLog().attachAudit') && source.includes('memory-replay')
      : source.includes("from './memory-log.ts'") && calls > 0 };
});

const { events, errors, routingEvents } = readBridgedEvents();
const report = memoryReplayReport(events, errors);
const recall = recallMemory(report.bundle, '验收 知识 来源', { limit: 3 });

console.log(JSON.stringify({
  ok: report.replayTwiceEqual && report.deterministic && report.integrity.logErrors.length === 0,
  log: '.runtime/memory/events.jsonl',
  wiring,
  allWired: wiring.every(w => w.wired),
  eventCount: report.eventCount,
  bridgedRoutingEvents: routingEvents,
  checksum: report.checksum,
  replayTwiceEqual: report.replayTwiceEqual,
  deterministic: report.deterministic,
  modelCalls: report.modelCalls,
  projections: report.projections,
  revocation: report.revocation,
  integrity: report.integrity,
  at: report.at,
  sampleRecall: { hits: recall.hits.length, excludedByRevocation: recall.excludedByRevocation, modelCalls: recall.modelCalls },
}, null, 2));
