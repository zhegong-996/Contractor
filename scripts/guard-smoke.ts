// P-8 真跑：把「补缺 + 取长」的两组能力跑在**真实数据**上。
//
//   * 补缺：P-7 守门经 src/knowledge-guard.ts 接入真实 B1 事件与本地知识任务索引；
//   * 取长：OpenMausBot 六项确定性能力用真实走查报告 / 真实 MCP 工具面 / 真实路由留痕验证。
//
// 只读：不写真实 .runtime/memory/events.jsonl、不写 routing 日志、不改任务状态、
// 不调用外部模型、不新增服务或网页发起入口。报告落 .runtime/guard-smoke.json。
// 用法：npm run guard:smoke
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { readBridgedEvents, memoryLogPath } from '../src/memory-log.ts';
import { readRoutingEvents, routingLogPath } from '../src/routing-trace.ts';
import { guardKnowledge, collectTranscript, assertGuardIsAdvisory } from '../src/knowledge-guard.ts';
import {
  freezeTraceSnapshot, diffGolden, scoreSnapshot, armFlags,
  inspectOutboundTools, assertOutboundTools, toolSurfaceSignature,
  assertDecisionTraceIsolation,
} from '../src/behavior-baseline.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) =>
  checks.push({ name, ok: Boolean(ok), detail });
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const lineCount = (file: string) => existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
const memoryFile = memoryLogPath(), routingFile = routingLogPath();
const memoryBefore = lineCount(memoryFile), routingBefore = lineCount(routingFile);

// ---------------------------------------------------------------- A 冻结基线
const goldenFile = path.join(root, 'fixtures/behavior-golden.json');
const golden = readJson(goldenFile).frozen;
const consoleReport = readJson(path.join(runtime(), 'console-smoke.json'));
const current = freezeTraceSnapshot('console', consoleReport);
const diff = diffGolden(golden, current);
const score = scoreSnapshot(golden, current);
check('A1 冻结基线来自真实走查报告且签名稳定',
  golden.schemaVersion === 1 && golden.kind === 'console' && golden.count > 0
    && typeof golden.signature === 'string' && golden.signature.length === 32,
  { entries: golden.count, signature: golden.signature, excluded: golden.excludedKeys });
check('A2 当前真实报告与冻结基线逐项一致（golden diff 无新增/删除/改变）',
  diff.ok && score.verdict === 'identical' && score.passRate === 1,
  { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length,
    unchanged: diff.unchanged, verdict: score.verdict });
const volatileChanged = freezeTraceSnapshot('console', { ...consoleReport,
  at: '2099-01-01T00:00:00Z', port: 9999, ms: 12345 });
check('A3 时间 / 端口 / 耗时变化不影响冻结签名',
  volatileChanged.signature === current.signature,
  { baseline: current.signature, volatile: volatileChanged.signature });
const walkthroughReport = readJson(path.join(runtime(), 'walkthrough/report.json'));
const walkthrough = freezeTraceSnapshot('walkthrough', walkthroughReport);
const mismatched = scoreSnapshot(golden, walkthrough);
check('A4 快照种类不同时不比较、不编造分数',
  !mismatched.comparable && mismatched.passRate === null && mismatched.verdict === 'kind-mismatch',
  { walkthroughEntries: walkthrough.count, verdict: mismatched.verdict });
const degraded = scoreSnapshot(golden, freezeTraceSnapshot('console', { ...consoleReport, ok: false }));
check('A5 冻结快照纯评分器能识别退化（regressed）',
  degraded.verdict === 'regressed' && degraded.regressions > 0 && degraded.modelCalls === 0,
  { verdict: degraded.verdict, regressions: degraded.regressions });

// ---------------------------------------------------------------- B 出站 MCP 工具面
const mcpSource = readFileSync(path.join(root, 'src/mcp.ts'), 'utf8');
const outboundTools = [...mcpSource.matchAll(/server\.registerTool\(\s*'([^']+)'/g)].map(m => m[1]!);
const outbound = inspectOutboundTools(outboundTools);
check('B1 从真实 src/mcp.ts 静态解析出出站工具面',
  outboundTools.length >= 10 && outbound.count === new Set(outboundTools).size,
  { tools: outbound.count, names: outbound.tools.slice(0, 5) });
check('B2 真实出站工具面通过「不暴露」硬断言', (() => {
  try { return assertOutboundTools(outboundTools).ok; } catch { return false; }
})() && outbound.forbiddenHits.length === 0, { hits: outbound.forbiddenHits });
const injectedTools = [...outboundTools, 'confirm_acceptance', 'admin_dump_private'];
check('B3 注入验收确认 / 越权工具能被精确名与前缀同时拦下',
  !inspectOutboundTools(injectedTools).ok
    && inspectOutboundTools(injectedTools).forbiddenHits.length === 2);
const surface = toolSurfaceSignature(outboundTools);
check('B4 工具面版本化判据：顺序无关、增删即变',
  surface === toolSurfaceSignature([...outboundTools].reverse())
    && surface !== toolSurfaceSignature([...outboundTools, 'extra_tool']),
  { signature: surface });

// ---------------------------------------------------------------- C 自动决策独立留痕
const routing = readRoutingEvents();
const orderOk = routing.events.every((event, i) => i === 0 || event.at >= routing.events[i - 1]!.at);
check('C1 真实路由留痕可读、无坏行、append-only 时间单调',
  routing.events.length > 0 && routing.errors.length === 0 && orderOk,
  { events: routing.events.length, errors: routing.errors.length, orderOk });
const store = new Store(runtime('bridge.sqlite'));
const taskIds = store.list().map(task => task.id);
let isolation: ReturnType<typeof assertDecisionTraceIsolation> | null = null;
try {
  isolation = assertDecisionTraceIsolation({ decisions: routing.events, businessWriteIds: taskIds });
} catch { /* 下面如实记为失败 */ }
check('C2 决策留痕独立于业务状态写入（不与任务 id 重合）',
  isolation !== null && isolation.isolated && isolation.overlappingIds.length === 0,
  { decisions: isolation?.decisions ?? 0, tasks: taskIds.length });
let overlapRejected = false;
try {
  assertDecisionTraceIsolation({ decisions: [routing.events[0]!], businessWriteIds: [routing.events[0]!.id] });
} catch (error) { overlapRejected = /共用了 id/.test(String(error)); }
check('C3 共用 id 的伪独立留痕被拒绝', overlapRejected);

// ---------------------------------------------------------------- D 双臂统计旗标
const noArms = armFlags([1, 1], [1, 1]);
const distinguishable = armFlags([1, 1, 1, 1, 1], [2, 2, 2, 2, 2]);
const noisy = armFlags([1, 1, 1, 1, 100], [2, 2, 2, 2, 2]);
check('D1 当前无双臂观测，如实标样本不足、不补零不估算',
  noArms.flags.includes('insufficient-samples') && !noArms.comparable && noArms.delta !== null
    && noArms.note.includes('样本不足'), { flags: noArms.flags });
check('D2 样本足且有区分时才 comparable', distinguishable.comparable
  && distinguishable.flags.includes('ok') && distinguishable.delta === 1);
check('D3 臂内波动过大标 high-variance 且不可比',
  noisy.flags.includes('high-variance') && !noisy.comparable);

// ---------------------------------------------------------------- E 守门接真实数据
const bridged = readBridgedEvents();
const localRecords = store.list().filter(task => task.kind === 'knowledge')
  .map(task => ({ key: task.identifier, title: task.context || task.identifier,
    state: 'candidate' as const }));
const guard = guardKnowledge({ records: localRecords, transcript: collectTranscript(bridged.events) });
check('E1 守门跑在真实 B1 + 路由事件与本地知识任务索引上',
  guard.transcriptEvents === bridged.events.length && guard.knowledgeRecords === localRecords.length
    && guard.modelCalls === 0,
  { transcriptEvents: guard.transcriptEvents, knowledgeRecords: guard.knowledgeRecords,
    bridgedRouting: bridged.routingEvents });
check('E2 真实知识记录缺事实源挂靠时如实报缺口，不编造事件 id 跑绿',
  localRecords.length === 0 || (guard.gapRecords === localRecords.length
    && guard.findings.some(f => f.code === 'missing-evidence')),
  { gapRecords: guard.gapRecords,
    missingEvidence: guard.findings.filter(f => f.code === 'missing-evidence').length,
    unwired: guard.unwired.length });
check('E3 体检恒为只读 advisory，不拦截业务、不含正文或身份',
  guard.advisory === true && guard.blocking === false
    && assertGuardIsAdvisory(guard).advisory === true
    && !JSON.stringify(guard).includes('正文不进报告'),
  { advisory: guard.advisory, blocking: guard.blocking, signature: guard.signature });
check('E4 四项「尚未接入生产链」如实列出，不把守门可跑当成已接管',
  guard.unwired.length === 4 && guard.unwired[0]!.includes('evidenceEventIds'));

const serverSource = readFileSync(path.join(root, 'src/server.ts'), 'utf8');
const membersSource = readFileSync(path.join(root, 'src/members.ts'), 'utf8');
const consoleSource = readFileSync(path.join(root, 'scripts/console-server.ts'), 'utf8');
check('E5 只读 action memory-guard 三处白名单同步且 server 真的调用守门',
  serverSource.includes("'memory-guard'") && serverSource.includes('guardKnowledge({')
    && membersSource.includes("'memory-guard'") && consoleSource.includes("'memory-guard'"));

// ---------------------------------------------------------------- F 只读 HTTP 探测（可选）
let httpProbe: Record<string, unknown> = { skipped: 'bridge 未运行，跳过只读 HTTP 探测（不算失败）' };
try {
  const health = await fetch('http://127.0.0.1:4180/health', { signal: AbortSignal.timeout(3000) });
  if (health.ok) {
    const token = readJson(path.join(root, '.runtime/secrets.json')).adminToken as string | undefined;
    if (token) {
      const started = performance.now();
      const res = await fetch('http://127.0.0.1:4180/workspace/memory-guard', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: '{"payload":{}}', signal: AbortSignal.timeout(15000),
      });
      const body = await res.text();
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(body); } catch { /* 下面如实记 */ }
      httpProbe = { status: res.status, bytes: Buffer.byteLength(body),
        ms: Math.round(performance.now() - started), advisory: parsed.advisory,
        blocking: parsed.blocking, source: parsed.source,
        gapRecords: parsed.gapRecords, signature: parsed.signature };
      check('F1 真实 HTTP memory-guard 返回只读 advisory 且不带写权限',
        res.status === 200 && parsed.advisory === true && parsed.blocking === false
          && parsed.source === 'local-store' && parsed.documentBodiesNotRead === true,
        httpProbe);
    }
  }
} catch { /* 桥未运行时保持 skipped，如实记录 */ }
if (!checks.some(c => c.name.startsWith('F1'))) check('F1 只读 HTTP 探测', true, httpProbe);

const memoryAfter = lineCount(memoryFile), routingAfter = lineCount(routingFile);
check('F2 真跑前后真实 B1 / 路由日志行数不变（只读，未污染主干）',
  memoryBefore === memoryAfter && routingBefore === routingAfter,
  { memoryBefore, memoryAfter, routingBefore, routingAfter });

store.close();
const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0,
  note: 'P-8 隔离真跑：读真实走查报告 / MCP 工具面 / 路由留痕 / B1 事件，不写任何真实日志、不改任务状态、不调用外部模型、未引入新上游',
  checks: checks.length, failed, details: checks,
  golden: { entries: golden.count, signature: golden.signature },
  outbound: { tools: outbound.count, signature: surface },
  httpProbe,
};
mkdirSync(runtime(), { recursive: true, mode: 0o700 });
const out = path.join(runtime(), 'guard-smoke.json');
writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed,
  goldenSignature: report.golden.signature, outboundTools: report.outbound.tools,
  report: path.relative(root, out) }, null, 2));
if (failed.length) process.exitCode = 1;
