// B2-4 只读验收：从真实记忆日志构建 / 增量应用投影 checkpoint。
// 用法：npm run memory:checkpoint [-- --reset]
// --reset 丢弃旧 checkpoint 并全量重建；平时按 append-only 前缀增量应用。
import { readMemoryEvents } from '../src/memory-log.ts';
import { readCheckpoint, writeCheckpoint, createCheckpoint, applyMemoryEvents,
  memoryCheckpointPath } from '../src/memory-checkpoint.ts';
import { replayMemory, projectionChecksum } from '../src/memory-projections.ts';

const reset = process.argv.includes('--reset');
const file = memoryCheckpointPath();
const { events, errors } = readMemoryEvents();
const stored = reset ? null : readCheckpoint(file);

const rebuild = () => {
  const checkpoint = createCheckpoint(events, errors);
  writeCheckpoint(checkpoint, file);
  return { checkpoint, mode: reset ? 'full-rebuild(reset)' : 'full-rebuild(no-valid-checkpoint)',
    incremental: false, fallback: null as string | null, applied: events.length, checksumEqual: true,
    fullChecksum: checkpoint.checksum };
};

let outcome: ReturnType<typeof rebuild>;
if (!stored) outcome = rebuild();
else {
  // append-only 日志被重写时不能信任前缀，直接全量重建。
  const prefixIntact = stored.raw.length <= events.length
    && stored.raw.every((event, index) => event.id === events[index]?.id);
  if (!prefixIntact) outcome = rebuild();
  else {
    const added = events.slice(stored.raw.length);
    const applied = applyMemoryEvents(stored, added, errors.slice(stored.logErrors.length));
    writeCheckpoint(applied.checkpoint, file);
    outcome = { checkpoint: applied.checkpoint,
      mode: applied.incremental ? 'incremental' : 'full-fallback',
      incremental: applied.incremental, fallback: applied.fallback,
      applied: applied.applied, checksumEqual: applied.checksumEqual,
      fullChecksum: applied.fullChecksum };
  }
}

const full = replayMemory(events, errors);
const twice = replayMemory(events, errors);
console.log(JSON.stringify({
  ok: outcome.checksumEqual && projectionChecksum(full) === projectionChecksum(twice)
    && projectionChecksum(full) === outcome.fullChecksum,
  mode: outcome.mode,
  incremental: outcome.incremental,
  fallback: outcome.fallback,
  applied: outcome.applied,
  eventCount: events.length,
  checkpoint: file,
  checksum: outcome.checkpoint.checksum,
  fullChecksum: outcome.fullChecksum,
  checksumEqual: outcome.checksumEqual,
  replayTwiceEqual: projectionChecksum(full) === projectionChecksum(twice),
  deterministic: outcome.checkpoint.bundle.deterministic,
  modelCalls: outcome.checkpoint.bundle.modelCalls,
  projections: {
    l1Evidence: outcome.checkpoint.bundle.l1Evidence.length,
    l2Organization: outcome.checkpoint.bundle.l2Organization.length,
    bm25Vector: outcome.checkpoint.bundle.bm25Vector.length,
    contextPacks: outcome.checkpoint.bundle.contextPacks.length,
    acceptance: outcome.checkpoint.bundle.acceptance.length,
  },
  logErrors: errors.length,
}, null, 2));
if (!outcome.checksumEqual) process.exitCode = 1;
