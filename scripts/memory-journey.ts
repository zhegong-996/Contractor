// B2-3 验收：在真实实例上，用真实 workspace action 跑完整知识事件链与端到端撤权。
//
// 与 memory:smoke 的区别：memory:smoke 在临时目录里手工 append 事件，验证的是
// 重放算法；本脚本每一步都通过 4180 的真实业务 action 产生事件，验证的是接线。
// 全程只新建一条专用资料并在末尾撤回，不改动既有业务资料；任何一步失败立即停止，
// 不补写、不伪造事件。真实日志是 append-only，不会删除任何已有行。
//
// 用法：npm run memory:journey
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { secrets, runtime } from '../src/config.ts';
import { readBridgedEvents } from '../src/memory-log.ts';
import { replayMemory, recallMemory, memoryReplayReport } from '../src/memory-projections.ts';

const PORT = 4180;
const QUERY = '验收 知识 来源';
const steps: { step: string; ok: boolean; detail: string }[] = [];

function action(name: string, payload: Record<string, unknown>): Promise<any> {
  const body = JSON.stringify({ payload });
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/workspace/' + name, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        Authorization: 'Bearer ' + secrets().adminToken } }, res => {
      let out = '';
      res.on('data', chunk => { out += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(out);
          if (res.statusCode !== 200 || parsed?.error) return reject(new Error(`${name}: HTTP ${res.statusCode} ${String(parsed?.error ?? out).slice(0, 300)}`));
          resolve(parsed);
        } catch (error) { reject(new Error(`${name}: 无法解析响应 ${String(error).slice(0, 120)} ${out.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error(name + ': 业务动作超时')));
    req.end(body);
  });
}

const done = (step: string, detail: string) => { steps.push({ step, ok: true, detail }); console.error(`[ok] ${step} — ${detail}`); };

/** 只看真实主干里与本次资料相关的事件，历史走查事件不混入判定。 */
function snapshot(sourceId: string) {
  const { events, errors } = readBridgedEvents();
  const report = memoryReplayReport(events, errors);
  const recall = recallMemory(report.bundle, QUERY, { limit: 8 });
  const bundle = replayMemory(events, errors);
  const own = (ids: string[]) => ids.filter(id => {
    const event = events.find(e => e.id === id);
    return event?.sourceRef?.sourceId === sourceId;
  }).length;
  return {
    eventCount: report.eventCount,
    replayTwiceEqual: report.replayTwiceEqual,
    deterministic: report.deterministic,
    logErrors: report.integrity.logErrors.length,
    projections: report.projections,
    ownL1: bundle.l1Evidence.filter(e => e.sourceId === sourceId).length,
    ownL2: bundle.l2Organization.filter(e => e.sourceId === sourceId).length,
    ownChunks: bundle.bm25Vector.filter(e => e.sourceId === sourceId).length,
    ownPacks: bundle.contextPacks.filter(e => e.refs.some(ref => ref.startsWith(sourceId + '@'))).length,
    ownInvalidated: own(bundle.invalidatedEventIds),
    // 真实链路完整性：本次资料派生事件的 causedBy 必须能在主干里找到来源事件。
    ownDanglingCausedBy: own(bundle.integrity.danglingCausedBy),
    recallHits: recall.hits.filter(hit => hit.sourceId === sourceId).length,
    excludedByRevocation: recall.excludedByRevocation,
    sourceRevocations: bundle.sourceRevocations.includes(sourceId),
  };
}

async function main() {
  const view = await action('view', {});
  const spaces: any[] = Array.isArray(view.spaces) ? view.spaces : Object.values(view.spaces ?? {});
  const chosen = spaces.find(item => item?.domain === 'product' && item?.projectId)
    ?? spaces.find(item => item?.domain && item?.projectId);
  if (!chosen) throw new Error('真实实例没有可用的知识空间，无法创建资料');
  const domain: string = chosen.domain;
  done('view', `知识空间 ${domain} 可用`);

  const created = await action('create-source', { domain, record: {
    key: 'knowledge-b2-memory-journey',
    title: 'B2 共享记忆主干端到端验证资料',
    domains: [domain], kind: 'procedure', appliesTo: '方案 B 记忆主干接线核对',
    facts: { phase: 'B2', query: QUERY },
    body: '本资料由真实工作台动作创建，用于核对「资料入库 → 索引 → 组织图 → 上下文包 → 撤回」是否都写入同一份共享记忆主干。验收依据为逐字原文，知识来源必须可追溯。',
    sources: ['https://github.com/zhegong-996/suitme-collab'],
  } });
  const sourceId: string = created?.source?.id;
  const key: string = created?.source?.ref?.key;
  let revision: string = created?.record?.revision;
  if (!sourceId || !revision) throw new Error('create-source 未返回资料 id / revision');
  done('create-source', `资料 ${sourceId.slice(0, 8)}… 已创建，revision ${revision.slice(0, 12)}…`);

  const confirmed = await action('review-source', { id: sourceId, state: 'confirmed', revision });
  revision = confirmed?.revision ?? revision;
  done('review-source/confirmed', `资料已确认，revision ${revision.slice(0, 12)}…`);

  const indexed = await action('memory-index', { sourceId });
  done('memory-index', `chunks=${indexed?.chunks ?? '?'} concepts=${indexed?.concepts ?? '?'}`);

  const at = new Date().toISOString();
  const edge = {
    schemaVersion: 1, id: 'b2-journey-edge-' + sourceId.slice(0, 8), kind: 'verified_by',
    from: 'artifact-b2-journey', to: 'evidence-b2-journey', state: 'accepted',
    evidenceRefs: [{ sourceId, revision, excerpt: '验收依据为逐字原文' }],
    visibility: { space: domain, classification: 'internal' },
    validFrom: new Date(Date.parse(at) - 60000).toISOString(),
    acceptedBy: 'local-operator', acceptedAt: at,
  };
  await action('v06-edges-save', { taskId: sourceId, edges: [edge] });
  done('v06-edges-save', '已写入带原文证据的已验收边');

  const extracted = await action('v06-l2-extract', { sourceId, revision, taskId: sourceId, actor: 'local-operator' });
  done('v06-l2-extract', `drafted=${extracted?.drafted ?? '?'} modelCalls=${extracted?.modelCalls ?? '?'}`);

  const pack = await action('v06-context-pack', { taskId: sourceId, registryVersion: 0, ttlHours: 24 });
  done('v06-context-pack', `refs=${pack?.refs?.length ?? '?'}`);

  const before = snapshot(sourceId);
  console.error('[before] ' + JSON.stringify(before));

  const withdrawn = await action('review-source', { id: sourceId, state: 'withdrawn', revision });
  revision = withdrawn?.revision ?? revision;
  done('review-source/withdrawn', '资料已撤回（状态写入，未物理删除）');

  const after = snapshot(sourceId);
  console.error('[after] ' + JSON.stringify(after));

  const checks = {
    fourProjectionsBefore: before.ownL1 > 0 && before.ownL2 > 0 && before.ownChunks > 0 && before.ownPacks > 0,
    deterministic: before.deterministic && after.deterministic && before.replayTwiceEqual && after.replayTwiceEqual,
    logClean: before.logErrors === 0 && after.logErrors === 0,
    recallableBefore: before.recallHits > 0,
    revocationRecorded: after.sourceRevocations,
    derivedProjectionsSuppressed: after.ownL1 === 0 && after.ownChunks === 0 && after.ownL2 === 0,
    unrecallableAfter: after.recallHits === 0,
    lineageInvalidated: after.ownInvalidated > before.ownInvalidated,
    lineageComplete: before.ownDanglingCausedBy === 0 && after.ownDanglingCausedBy === 0,
  };
  const ok = Object.values(checks).every(value => value === true);
  const result = { ok, sourceId, key, domain, steps, before, after, checks,
    note: '真实日志 append-only；历史走查产生的 context-packed 不计入本次资料的投影判定。' };
  const file = path.join(runtime(), 'memory-journey.json');
  writeFileSync(file, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ok, evidence: file, checks, before, after, steps: steps.map(s => s.step) }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch(error => {
  console.error('[failed] ' + String(error?.stack ?? error));
  console.log(JSON.stringify({ ok: false, error: String(error?.message ?? error), completed: steps.map(s => s.step) }, null, 2));
  process.exitCode = 1;
});
