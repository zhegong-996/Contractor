// C-1 真跑证据：在**专属测试库**上验证 PostgreSQL 宿主、事务、并发领取与步进队列。
// 用法：npm run host:pg
// 安全：只允许回环 DSN，且库名必须是 suitme_collab_c1；否则拒绝 reset，绝不碰别的库。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PgHostPlatform, pgDsn } from '../src/pg-host.ts';
import { runtime } from '../src/config.ts';

const host = new PgHostPlatform(pgDsn());
const checks: Record<string, unknown> = {};
const notes: string[] = [];
let ok = true;
function check(name: string, value: unknown, pass: boolean) {
  checks[name] = value;
  if (!pass) ok = false;
}

async function main() {
  const { rows } = await host.pool.query('select current_database() as db, version() as version');
  const db = rows[0].db as string;
  check('database', { name: db, version: String(rows[0].version).split(' on ')[0] }, db === 'suitme_collab_c1');
  if (db !== 'suitme_collab_c1') throw new Error('拒绝在非专属测试库上执行：' + db);
  await host.resetForTest();
  notes.push('专属库已清空，以下数据全部由本次真跑产生');

  // 1. 主链路：与文件后端同一端口契约
  check('health', await host.health(), (await host.health()).status === 'ok');
  const created = await host.post<any>('/companies/c1-company/issues', {
    idempotencyKey: 'c1-issue-1', projectId: 'c1-project', title: 'PG 宿主真跑任务',
    status: 'backlog', assigneeAgentId: 'agent-local',
  });
  const again = await host.post<any>('/companies/c1-company/issues', { idempotencyKey: 'c1-issue-1', title: '重复提交' });
  check('idempotentIssue', { first: created.id, second: again.id }, created.id === again.id);
  const d1 = await host.document(created.id, 'handoff', '交接包', '版本：1');
  const dSame = await host.document(created.id, 'handoff', '交接包', '版本：1');
  const d2 = await host.document(created.id, 'handoff', '交接包', '版本：2');
  check('documentRevisions', { first: d1.latestRevisionId, unchanged: dSame.latestRevisionId === d1.latestRevisionId,
    second: d2.latestRevisionId },
    dSame.latestRevisionId === d1.latestRevisionId && Number(d2.latestRevisionId) === Number(d1.latestRevisionId) + 1);
  const fetched = await host.get<any>(`/issues/${created.id}/documents/handoff`);
  check('documentReadBack', fetched.body, fetched.body === '版本：2');
  const patched = await host.patch<any>(`/issues/${created.id}`, { status: 'todo' });
  check('patchStatus', patched.status, patched.status === 'todo' && (await host.get<any>(`/issues/${created.id}`)).status === 'todo');
  await host.post(`/issues/${created.id}/comments`, { body: '真跑评论', clientRequestId: 'c1-comment' });
  await host.post('/agents/agent-local/wakeup', { reason: 'c1_smoke', payload: { issueId: created.id } });

  // 2. ACL / 成员身份：未知主体必须被拒，不静默放行
  await host.upsertMember('worker-a', '本机执行者 A', ['worker']);
  let aclRejected = false;
  try { await host.assertMember('unknown-actor'); } catch { aclRejected = true; }
  check('acl', { members: (await host.members()).length, unknownRejected: aclRejected },
    aclRejected && (await host.members()).length === 1);

  // 3. cost-ledger：写一笔、读回来
  await host.post('/companies/c1-company/cost-events', { runId: 'c1-run', kind: 'model-call', amount: 1.68, detail: { model: 'smoke' } });
  const costs = await host.get<any[]>('/companies/c1-company/cost-events');
  check('costLedger', { count: costs.length, amount: costs[0]?.amount }, costs.length === 1 && Number(costs[0].amount) === 1.68);

  // 4. heartbeat checkout / retry / runToken：原子领取，重复领取必须失败
  await host.post('/heartbeat-runs', { id: 'c1-heartbeat', context: { issueId: created.id } });
  const first = await host.checkout('c1-heartbeat', 'worker-a');
  let doubleCheckoutRejected = false;
  try { await host.checkout('c1-heartbeat', 'worker-b'); } catch { doubleCheckoutRejected = true; }
  await host.retry('c1-heartbeat', '真跑：主动重试');
  const second = await host.checkout('c1-heartbeat', 'worker-b');
  check('heartbeatRunToken', { firstAttempt: first.attempt, doubleCheckoutRejected, secondAttempt: second.attempt,
    tokenRotated: first.runToken !== second.runToken },
    doubleCheckoutRejected && second.attempt === first.attempt + 1 && first.runToken !== second.runToken);

  // 5. 步进链：只有第一步 ready，完成后原子激活下一棒
  const runId = 'c1-step-chain';
  await host.enqueueSteps(runId, [
    { kind: 'model', payload: { prompt: '第 1 步' } },
    { kind: 'tool', payload: { tool: '第 2 步' } },
    { kind: 'model', payload: { prompt: '第 3 步' } },
  ]);
  const initial = await host.runState(runId);
  check('queueOrdering', initial.map(s => `${s.stepNo}:${s.status}`),
    initial.length === 3 && initial[0].status === 'ready' && initial.slice(1).every(s => s.status === 'queued'));

  const s1 = await host.claimStep('worker-a', runId);
  check('claimFirstStep', s1 ? { stepNo: s1.stepNo, kind: s1.kind } : null, s1?.stepNo === 1);
  // 同一 run 不可能同时被两个 worker 领到同一步
  const racing = await Promise.all([
    host.claimStep('worker-b', runId),
    host.claimStep('worker-c', runId),
  ]);
  check('noDoubleClaim', racing.map(item => item?.stepNo ?? null), racing.every(item => item === null));

  // 另开两个 run，真并发领取不同 step，检验 SKIP LOCKED
  await host.enqueueSteps('c1-race-b', [{ kind: 'tool' }]);
  await host.enqueueSteps('c1-race-c', [{ kind: 'tool' }]);
  const parallel = await Promise.all([host.claimStep('worker-b'), host.claimStep('worker-c')]);
  check('concurrentClaim', parallel.map(item => item && { runId: item.runId, stepNo: item.stepNo }),
    !!parallel[0] && !!parallel[1] && parallel[0]!.id !== parallel[1]!.id);

  const done1 = await host.completeStep(s1!.runToken, { ok: true }, { checkpoint: { cursor: 1 }, modelCalls: 1 });
  let duplicateRejected = false;
  try { await host.completeStep(s1!.runToken, { ok: true }); } catch { duplicateRejected = true; }
  check('completeActivatesNext', { nextStepNo: done1.nextStepNo, duplicateRejected },
    done1.nextStepNo === 2 && duplicateRejected);
  const afterDone1 = await host.runState(runId);
  check('stateAfterFirstStep', afterDone1.map(s => `${s.stepNo}:${s.status}`),
    afterDone1[0].status === 'done' && afterDone1[1].status === 'ready' && afterDone1[2].status === 'queued');

  const s2 = await host.claimStep('worker-a', runId);
  await host.completeStep(s2!.runToken, { ok: true }, { checkpoint: { cursor: 2 }, modelCalls: 0 });
  const s3 = await host.claimStep('worker-a', runId);
  const done3 = await host.completeStep(s3!.runToken, { ok: true }, { checkpoint: { cursor: 3 }, modelCalls: 2 });
  const finalState = await host.runState(runId);
  check('stepChain', { statuses: finalState.map(s => s.status), lastNext: done3.nextStepNo,
    modelCalls: finalState.reduce((sum, s) => sum + s.modelCalls, 0) },
    finalState.every(s => s.status === 'done') && done3.nextStepNo === null
      && finalState.reduce((sum, s) => sum + s.modelCalls, 0) === 3);
  check('checkpointExternalized', finalState.map(s => s.checkpoint),
    finalState.every((s, index) => (s.checkpoint as any)?.cursor === index + 1));

  // 6. 崩溃恢复：running 超时回收为 ready，旧 runToken 作废
  await host.enqueueSteps('c1-crash', [{ kind: 'tool' }]);
  const crashed = await host.claimStep('worker-crash', 'c1-crash');
  const recovered = await host.recoverStaleSteps(0);
  let staleTokenRejected = false;
  try { await host.completeStep(crashed!.runToken, { ok: true }); } catch { staleTokenRejected = true; }
  const reclaimed = await host.claimStep('worker-new', 'c1-crash');
  check('crashRecovery', { recovered: recovered.length, staleTokenRejected, reclaimed: reclaimed?.stepNo ?? null },
    recovered.some(item => item.runId === 'c1-crash') && staleTokenRejected && reclaimed?.stepNo === 1);
  await host.completeStep(reclaimed!.runToken, { ok: true });

  // 7. 事务回滚：错误 token 不得留下半写状态
  const before = await host.runState(runId);
  try { await host.completeStep('not-a-real-token', { ok: false }); } catch { /* expected */ }
  const after = await host.runState(runId);
  check('transactionRollback', { unchanged: JSON.stringify(before) === JSON.stringify(after) },
    JSON.stringify(before) === JSON.stringify(after));

  // 8. 能力清单如实反映：本机真做到的与仍未做到的都写清
  const caps = host.capabilities();
  check('capabilities', { id: caps.id, implemented: caps.implemented.length,
    missing: caps.missing, pluginSdk: caps.pluginSdk },
    caps.id === 'local-pg' && caps.pluginSdk === false && caps.implemented.length >= 8
      && caps.missing.some(item => item.includes('远端工具沙箱'))
      && caps.missing.some(item => item.includes('Redis')));
  check('journal', (await host.journalLines()).length, (await host.journalLines()).length >= 10);

  const report = { ok, at: new Date().toISOString(), dsnHost: new URL(host.dsn).host,
    database: db, checks, notes, boundary: '本机 PG 真跑；未部署远端工具沙箱、未引入 Redis、未切换默认底座、未改上游源码' };
  const file = runtime('host-pg-smoke.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

try { await main(); }
catch (error) { console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2)); process.exitCode = 1; }
finally { await host.close(); }
