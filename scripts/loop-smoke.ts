/**
 * P-9 真跑：验证「人和执行端之间两条相反方向的移动」真的接进了执行链。
 *
 *   A 段：真实只读 HTTP /workspace/loop-guard（真实 audit / HITL / 建议台账，不编造）
 *   B 段：三个执行链耦合点的静态守门（controller.receipt / controller.reply /
 *         collaboration-intake.ingest 确实调用了归一化函数）
 *   C 段：真实隔离子进程跑「human-gate 提问 → step:answer 真人回答 → 回流建议落盘」
 *   D 段：回流建议把半回路闭合成完整回合（无建议时 staleAnswers 非空）
 *   E 段：主链路「补充说明」经时间就近配对闭合回路
 *   F 段：只读红线——B1 主干、路由留痕、任务状态前后不变
 *
 * 不调用外部模型、不新增服务、不改业务状态。报告落 .runtime/loop-smoke.json。
 * 用法：npm run loop:smoke
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root, runtime, secrets } from '../src/config.ts';
import { memoryLogPath } from '../src/memory-log.ts';
import { routingLogPath } from '../src/routing-trace.ts';
import { Store } from '../src/store.ts';
import { askHuman } from '../src/step-hitl.ts';
import {
  loopReport, attachImplicitReplies, fromHitlLedger, fromAutoloopReceipt,
  mapFollowupToAnswer, assertLoopAdvisory, loopSignature,
  type LoopEvent,
} from '../src/collaboration-loop.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) =>
  checks.push({ name, ok: Boolean(ok), detail });
const lineCount = (file: string) => existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
const memoryFile = memoryLogPath(), routingFile = routingLogPath();
const memoryBefore = lineCount(memoryFile), routingBefore = lineCount(routingFile);
const store = new Store(runtime('bridge.sqlite'));
const tasksBefore = store.list().length;
const auditBefore = (store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('loop.upstream','loop.downstream')").get() as { n: number }).n;
const defaultProposalFile = path.join(runtime('step-hitl'), 'resume-proposals.jsonl');
const defaultProposalBefore = lineCount(defaultProposalFile);

// ---------------------------------------------------------------- A 真实只读体检
let http: Record<string, unknown> = {};
let httpStatus = 0;
try {
  const token = String(secrets().adminToken ?? '');
  const response = await fetch('http://127.0.0.1:4180/workspace/loop-guard', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ payload: {} }),
  });
  httpStatus = response.status;
  http = await response.json() as Record<string, unknown>;
} catch (error) {
  http = { error: String(error instanceof Error ? error.message : error).slice(0, 200) };
}
check('A1 只读体检真实返回 200 且是 advisory（不拦截、不写状态、无模型调用）',
  httpStatus === 200 && http.advisory === true && http.blocking === false && http.modelCalls === 0,
  { httpStatus, advisory: http.advisory, blocking: http.blocking });
check('A2 体检如实给出双向判据与四个耦合点计数，不编造事件',
  typeof http.bidirectional === 'boolean' && typeof http.signature === 'string'
    && typeof http.couplingPoints === 'object' && Array.isArray(http.openLoops),
  { bidirectional: http.bidirectional, couplingPoints: http.couplingPoints,
    total: http.total, signature: String(http.signature ?? '').slice(0, 12) });
const recomputed = Array.isArray(http.openLoops)
  ? loopSignature(http as unknown as Parameters<typeof loopSignature>[0]) : '';
check('A3 报告的签名与本地纯函数重算逐字节一致（同一判据）',
  typeof http.signature === 'string' && http.signature.length === 32
    && recomputed === http.signature,
  { httpSignature: String(http.signature ?? '').slice(0, 12),
    recomputed: recomputed.slice(0, 12), httpError: http.error ?? null });

// ---------------------------------------------------------------- B 执行链耦合点
const controller = readFileSync(path.join(root, 'src/controller.ts'), 'utf8');
const intake = readFileSync(path.join(root, 'src/collaboration-intake.ts'), 'utf8');
const serverSource = readFileSync(path.join(root, 'src/server.ts'), 'utf8');
const answerSource = readFileSync(path.join(root, 'scripts/step-answer.ts'), 'utf8');
const bridgeSource = readFileSync(path.join(root, 'src/hitl-bridge.ts'), 'utf8');
// P-11 起红线字样（requiresHumanApproval / autoExecute:false）在 collaboration-loop.ts 强制，
// CLI 入口只复用 hitl-bridge 的同一判据；断言跟随真正强制处。
const loopContract = readFileSync(path.join(root, 'src/collaboration-loop.ts'), 'utf8');
check('B1 回执入口复用 Autoloop 回执协议并登记上行事件',
  /resultFrom\(/.test(controller) && /fromAutoloopReceipt\(/.test(controller)
    && /loop\.upstream/.test(controller) && /continuationPolicy:\s*'wake_assignee'/.test(controller),
  { resultFrom: /resultFrom\(/.test(controller), wakeAssignee: /wake_assignee/.test(controller) });
check('B2 人的补充说明与飞书入站都登记下行应答，且真正唤醒下一轮',
  /loop\.downstream/.test(controller) && /loop\.downstream/.test(intake)
    && /phase = 'ready'/.test(controller) && /delegate\(/.test(intake)
    && /mapFollowupToAnswer/.test(controller) && /mapFollowupToAnswer/.test(intake));
check('B3 回答入口复用 Runner 成对留痕并桥接回流建议（CLI 与飞书共用同一判据）',
  /answerHuman\(/.test(bridgeSource) && /bridgeAnswerToResume\(/.test(bridgeSource)
    && /assertResumeProposal\(/.test(bridgeSource)
    && /requiresHumanApproval/.test(loopContract)
    && /routeAnswerToHitl\(/.test(answerSource) && /routeAnswerToHitl\(/.test(intake),
  { bridge: true, cli: /routeAnswerToHitl\(/.test(answerSource), feishu: /routeAnswerToHitl\(/.test(intake) });
check('B4 只读体检接进服务端并同步三处白名单',
  /action==='loop-guard'/.test(serverSource)
    && /loop-guard/.test(readFileSync(path.join(root, 'src/members.ts'), 'utf8'))
    && /loop-guard/.test(readFileSync(path.join(root, 'scripts/console-server.ts'), 'utf8')));
check('B5 loop-guard 去重双留痕、回路时间统一归一（第二十八轮修复不再双计 / NaN）',
  /dedupeLoopEvents\(/.test(serverSource) && /ledgerHealth/.test(serverSource)
    && /toLoopAt\(/.test(readFileSync(path.join(root, 'src/collaboration-loop.ts'), 'utf8')),
  { dedupe: /dedupeLoopEvents\(/.test(serverSource), ledgerHealth: /ledgerHealth/.test(serverSource) });

// ---------------------------------------------------------------- C 真实子进程：提问 → 回答 → 回流建议
const tmp = mkdtempSync(path.join(tmpdir(), 'collab-loop-'));
const ledger = path.join(tmp, 'events.jsonl');
const proposalFile = path.join(tmp, 'resume-proposals.jsonl');
const question = askHuman({ runId: 'LOOP-SMOKE', stepNo: 1, asker: 'step-runner',
  prompt: '这一步需要真人确认后才能继续', choices: ['继续', '暂停'] });
mkdirSync(tmp, { recursive: true, mode: 0o700 });
writeFileSync(ledger, JSON.stringify(question) + '\n', { mode: 0o600 });
const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs');
const child = spawnSync(process.execPath, ['--import', loader,
  path.join(root, 'scripts/step-answer.ts'), question.id, '继续', '真跑备注'],
  { cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, NODE_OPTIONS: '', COLLAB_HITL_LEDGER: ledger,
      COLLAB_HUMAN_ACTOR: '原发起人', NO_PROXY: '127.0.0.1,localhost',
      // P-11：隔离冒烟关闭自动续跑，避免真跑配置（step 模式）变化影响隔离口径。
      COLLAB_AUTO_RESUME: '0' } });
let answer: Record<string, any> = {};
try { answer = JSON.parse(String(child.stdout).trim()); } catch { /* 下面如实报 */ }
const proposals = existsSync(proposalFile)
  ? readFileSync(proposalFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  : [];
check('C1 真实子进程回答成功，成对留痕且不等于验收',
  child.status === 0 && answer.ok === true && answer.paired === true
    && answer.resumeProposal?.notAcceptance === true,
  { code: child.status, paired: answer.paired, stderr: String(child.stderr ?? '').slice(0, 160) });
check('C2 回流建议真实落盘到独立 append-only 台账，且只作 advisory',
  answer.proposalPersisted === true && proposals.length === 1
    && proposals[0].autoExecute === false && proposals[0].requiresHumanApproval === true
    && proposals[0].target === 'execution-chain'
    && proposals[0].questionId === question.id && proposals[0].responseId === answer.responseId,
  { proposals: proposals.length, persisted: answer.proposalPersisted });
check('C3 隔离口径：COLLAB_AUTO_RESUME=0 时本冒烟不触发自动续跑副作用',
  answer.autoResume === null || answer.autoResume === undefined,
  { autoResume: answer.autoResume ?? null });

// ---------------------------------------------------------------- D 半回路 → 完整回合
const ledgerEvents = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const hitlEvents = attachImplicitReplies(fromHitlLedger({ events: ledgerEvents }));
const without = loopReport({ events: hitlEvents });
const withProposal = loopReport({ events: hitlEvents,
  resumeProposals: proposals.map((p: any) => ({ id: p.id, inReplyTo: p.responseId })) });
check('D1 没有回流建议时判为半回路（答完就消失）',
  without.bidirectional === true && without.staleAnswers.length === 1
    && without.openLoops.some((o: any) => o.reason === 'reply-not-followed-through')
    && without.closedCycles === 0,
  { staleAnswers: without.staleAnswers, closedCycles: without.closedCycles });
check('D2 回流建议把半回路闭合成完整回合，且未突破红线',
  withProposal.staleAnswers.length === 0 && withProposal.closedCycles === 1
    && withProposal.violations.length === 0
    && assertLoopAdvisory(withProposal).blocking === false,
  { staleAnswers: withProposal.staleAnswers, closedCycles: withProposal.closedCycles,
    violations: withProposal.violations.length });
check('D3 同一事件流两次体检签名逐字节一致',
  loopSignature(withProposal) === loopSignature(loopReport({ events: hitlEvents,
    resumeProposals: proposals.map((p: any) => ({ id: p.id, inReplyTo: p.responseId })) })),
  { signature: loopSignature(withProposal).slice(0, 12) });

// ---------------------------------------------------------------- E 主链路补充说明
const upstream = fromAutoloopReceipt({ receiptId: 'LOOP-R1', taskId: 'LOOP-SMOKE',
  agent: 'worker', at: 1, result: { outcome: 'done',
    ask: [{ title: '要不要继续', options: ['继续', '暂停'] }] } });
const followup = mapFollowupToAnswer('继续，用方案二', 'ou_owner');
const replyEvent: LoopEvent = { id: 'down:followup-1', direction: 'downstream',
  kind: 'answer', at: 9, taskId: 'LOOP-SMOKE', actor: 'ou_owner', acceptance: false };
const paired = attachImplicitReplies([
  ...upstream, ...hitlEvents.map(e => ({ ...e, at: 2 + e.at })), replyEvent,
]);
const mainLoop = loopReport({ events: paired, humanOwners: ['ou_owner'] });
check('E1 飞书「补充说明」按时间就近配对到上行提问，回路可验证',
  followup.accepted === true && followup.acceptance === false
    && paired.find(e => e.id === 'down:followup-1')?.inReplyTo !== undefined
    && mainLoop.bidirectional === true,
  { questionId: followup.questionId, inReplyTo: paired.find(e => e.id === 'down:followup-1')?.inReplyTo });
check('E2 「确认验收」被明确拒收为回答，核可权不混入回路',
  mapFollowupToAnswer('确认验收 SUI-1', 'ou_owner').accepted === false
    && mapFollowupToAnswer('确认验收 SUI-1', 'ou_owner').acceptance === false);

// ---------------------------------------------------------------- F 只读红线
const auditAfter = (store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('loop.upstream','loop.downstream')").get() as { n: number }).n;
check('F1 真跑未写 B1 记忆主干、未写路由留痕、未改任务状态与回路审计',
  lineCount(memoryFile) === memoryBefore && lineCount(routingFile) === routingBefore
    && store.list().length === tasksBefore && auditAfter === auditBefore,
  { memory: [memoryBefore, lineCount(memoryFile)], routing: [routingBefore, lineCount(routingFile)],
    tasks: [tasksBefore, store.list().length], audit: [auditBefore, auditAfter] });
check('F2 隔离台账不污染 .runtime 默认建议台账',
  lineCount(defaultProposalFile) === defaultProposalBefore,
  { before: defaultProposalBefore, after: lineCount(defaultProposalFile),
    note: '真跑只写临时目录；默认台账若已有历史建议则行数保持不变' });

store.close();
rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0, checks: checks.length, failed,
  http: { status: httpStatus, bidirectional: http.bidirectional,
    couplingPoints: http.couplingPoints, total: http.total },
  details: checks,
  note: 'A 段读真实服务；C/D/E 段用真实执行链函数在隔离临时目录跑通「提问→真人回答→回流建议→回路闭合」；F 段核对只读红线。真实业务链路尚无回路留痕时 A 段如实报 bidirectional:false，不编造事件。',
  at: new Date().toISOString(),
};
mkdirSync(runtime(), { recursive: true });
writeFileSync(path.join(runtime(), 'loop-smoke.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed: report.failed,
  http: report.http }, null, 2));
if (failed.length) process.exitCode = 1;
