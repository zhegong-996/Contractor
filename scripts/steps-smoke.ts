// P-1 真跑证据：长程循环单步化（第二十二轮）。
//
// 三段证据，互不替代：
//   A 配置 / 只读视图：默认 loop 可回退，step 必须配 local-pg，不能静默假装单步。
//   B 隔离内存队列：一次调用一步、并发领取、旧凭据失效、崩溃回收、步间重评、
//     换机器续跑、会话状态外置、确定性摘要、接线守门。不写任何真实日志。
//   C 专属 PG 库 + 真实子进程：step:once 每次只领一步，第二棒由另一台「机器」
//     的进程领走；model-call 无端点时如实拒绝。用唯一 runId，不 reset 别人的数据。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { configSchema, configPath, defaultExecutionConfig, loadConfig, root, runtime } from '../src/config.ts';
import {
  InMemoryStepQueue, PgStepQueue, executeOneStep, driveSteppedLoop,
  stepExecutionSummary, executionView, defaultStepRecheck, STEP_RED_LINES,
} from '../src/step-execution.ts';
import { driveLegacyLoop, driveSteppedPump } from '../src/loop-pump.ts';
import { stepRunnerHandlers, STEP_RUNNER_TOOLS } from '../src/step-runner.ts';
import { assertHitlRedLines, FileHitlSink } from '../src/step-hitl.ts';
import { TrackedStepQueue, deliveryReadiness, notificationText } from '../src/step-delivery.ts';
import {
  deriveMissionState, MISSION_STATE_LABELS, resolveRuntime, assertNoStoredArgv,
  assertCoordinationLayering, assertSnapshotNoRewrite,
} from '../src/mission-state.ts';

type Detail = { name: string; ok: boolean; note?: unknown };
const checks: Detail[] = [];
const check = (name: string, ok: boolean, note?: unknown) => checks.push({ name, ok, note });
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const memoryLog = runtime('memory', 'events.jsonl');
const memoryBefore = existsSync(memoryLog) ? readFileSync(memoryLog, 'utf8').split('\n').filter(Boolean).length : 0;

async function main() {
  const real = JSON.parse(readFileSync(configPath, 'utf8'));
  const stepConfig = configSchema.parse({ ...real,
    host: { ...(real.host ?? {}), provider: 'local-pg' },
    execution: { schemaVersion: 1, mode: 'step', maxStepsPerRun: 60, staleSeconds: 60 } });
  const loopConfig = loadConfig();

  // ---- A. 配置与只读视图 -------------------------------------------------
  check('A1 默认仍是常驻循环，可直接回退', loopConfig.execution.mode === 'loop'
    && defaultExecutionConfig().mode === 'loop', { mode: loopConfig.execution.mode });
  let rejected = false;
  try { configSchema.parse({ ...real, host: { ...(real.host ?? {}), provider: 'paperclip' },
    execution: { schemaVersion: 1, mode: 'step' } }); } catch (error) {
    rejected = /local-pg/.test(String(error));
  }
  check('A2 step 配 paperclip 被配置层拒绝，不静默假装单步', rejected);
  check('A3 step 配 local-pg 才是合法单步配置', stepConfig.execution.mode === 'step'
    && stepConfig.host.provider === 'local-pg');
  const view = executionView(loopConfig);
  check('A4 默认只读视图如实说明未启用', view.steppedReady === false
    && view.mode === 'loop' && view.missing.some(m => /默认底座仍是 paperclip/.test(m)),
    { note: view.note });
  check('A5 单步红线五条齐全且 modelCalls=0', STEP_RED_LINES.length === 5 && view.modelCalls === 0);
  check('A6 step+local-pg 视图才标已启用', executionView(stepConfig).steppedReady === true);

  // ---- B. 隔离内存队列 ---------------------------------------------------
  const q = new InMemoryStepQueue();
  await q.enqueueSteps('B1', [
    { kind: 'tool-call', payload: { tool: 'sha256', input: 'a' } },
    { kind: 'tool-call', payload: { tool: 'sha256', input: 'b' } },
    { kind: 'tool-call', payload: { tool: 'sha256', input: 'c' } },
  ]);
  const b1 = await q.runState('B1');
  check('B1 只有第一步 ready，其余排队，不会两步并跑',
    b1.filter(s => s.status === 'ready').length === 1 && b1.filter(s => s.status === 'queued').length === 2,
    b1.map(s => s.status));
  const raced = await Promise.all([q.claimStep('w1', 'B1'), q.claimStep('w2', 'B1')]);
  check('B2 并发领取只有一个 worker 拿到这一步',
    raced.filter(Boolean).length === 1 && (await q.runState('B1')).filter(s => s.status === 'running').length === 1);
  const taken = raced.find(Boolean)!;
  await q.completeStep(taken.runToken, { ok: true }, { checkpoint: { counter: 1 }, modelCalls: 0 });
  let duplicate = false;
  try { await q.completeStep(taken.runToken, { again: true }); } catch { duplicate = true; }
  check('B3 旧 runToken 重复写结果被拒', duplicate);
  const afterFirst = await q.runState('B1');
  check('B4 完成动作原子激活下一棒（预排步骤优先）',
    afterFirst[0].status === 'done' && afterFirst[1].status === 'ready' && afterFirst[2].status === 'queued');

  const chainQ = new InMemoryStepQueue();
  const seen: number[] = [];
  const handlers = stepRunnerHandlers();
  const chained = {
    'tool-call': (step: any, ctx: any) => {
      seen.push(Number(ctx.previousCheckpoint.counter ?? 0));
      return handlers['tool-call']!(step, ctx) as any;
    },
  };
  const b5 = await driveSteppedLoop({ queue: chainQ, runId: 'B5', principal: 'worker-a',
    first: { kind: 'tool-call', payload: { tool: 'sha256', input: 'x', remaining: 2 } },
    handlers: chained, maxSteps: 10,
    worker: n => ({ workerId: `w${n}`, environment: n % 2 ? '机器甲' : '机器乙' }) });
  const b5States = await chainQ.runState('B5');
  check('B5 会话状态从队列 checkpoint 续上，换机器不丢上下文',
    JSON.stringify(seen) === JSON.stringify([0, 1, 2]) && b5.steps === 3
      && new Set(b5.environments).size === 2, { seen, environments: b5.environments });
  check('B6 每一步只触发一次执行器', seen.length === 3 && b5States.length === 3);
  const summaryA = stepExecutionSummary(b5States);
  const summaryB = stepExecutionSummary(await chainQ.runState('B5'));
  check('B7 两次摘要逐字节一致，模型调用如实累计', summaryA.signature === summaryB.signature
    && summaryA.done === 3 && summaryA.modelCalls === 0, { signature: summaryA.signature.slice(0, 12) });

  const rejectQ = new InMemoryStepQueue();
  await rejectQ.enqueueSteps('B8', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'y' } }]);
  const noPrincipal = await executeOneStep({ queue: rejectQ, handlers, workerId: 'w', principal: '',
    environment: '机器甲' });
  check('B8 未声明当前主体时 fail-closed，步间重评拒绝执行',
    noPrincipal.failed && /最小权限/.test(noPrincipal.reason ?? ''), { reason: noPrincipal.reason });
  const scopeQ = new InMemoryStepQueue();
  await scopeQ.enqueueSteps('B9', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'y', scope: '全域' } }]);
  const wrongScope = await executeOneStep({ queue: scopeQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器乙', scope: '本任务' });
  check('B9 换执行环境不放大资料范围：范围不一致被拒',
    wrongScope.failed && /资料范围/.test(wrongScope.reason ?? ''), { reason: wrongScope.reason });
  check('B10 默认重评对同一范围放行', defaultStepRecheck({ principal: 'worker-a', scope: '本任务',
    environment: '机器乙', step: { kind: 'tool-call', payload: { scope: '本任务' } } as any }).ok === true);

  const unknownQ = new InMemoryStepQueue();
  await unknownQ.enqueueSteps('B11', [{ kind: 'unregistered' }]);
  const unknown = await executeOneStep({ queue: unknownQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  check('B11 未登记的步骤类型拒绝静默跳过', unknown.failed && /没有登记/.test(unknown.reason ?? ''));
  const modelQ = new InMemoryStepQueue();
  await modelQ.enqueueSteps('B12', [{ kind: 'model-call' }]);
  const modelStep = await executeOneStep({ queue: modelQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  check('B12 无外部模型端点时如实拒绝，不编造模型调用',
    modelStep.failed && /不编造模型调用/.test(modelStep.reason ?? ''), { reason: modelStep.reason });
  const gateQ = new InMemoryStepQueue();
  await gateQ.enqueueSteps('B13', [{ kind: 'human-gate' }]);
  const gate = await executeOneStep({ queue: gateQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  check('B13 执行进程不得自行放行人工确认', gate.failed && /原会话/.test(gate.reason ?? ''));
  const toolQ = new InMemoryStepQueue();
  await toolQ.enqueueSteps('B14', [{ kind: 'tool-call', payload: { tool: 'rm', input: 'z' } }]);
  const badTool = await executeOneStep({ queue: toolQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  check('B14 工具白名单外一律拒绝', badTool.failed && /工具白名单/.test(badTool.reason ?? '')
    && STEP_RUNNER_TOOLS.length === 1);

  const retryQ = new InMemoryStepQueue();
  await retryQ.enqueueSteps('B15', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'r' } }]);
  const firstClaim = await retryQ.claimStep('w1', 'B15');
  const failResult = await retryQ.failStep(firstClaim!.runToken, '模拟工具失败', 3);
  let staleToken = false;
  try { await retryQ.completeStep(firstClaim!.runToken, {}); } catch { staleToken = true; }
  check('B15 失败可重试且旧 runToken 立即作废', failResult.retryable && staleToken
    && (await retryQ.runState('B15'))[0].status === 'ready');
  let clock = 0;
  const crashQ = new InMemoryStepQueue(() => clock);
  await crashQ.enqueueSteps('B16', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'c' } }]);
  const crashed = await crashQ.claimStep('w1', 'B16');
  clock = 120_000;
  const recovered = await crashQ.recoverStaleSteps(60);
  let crashedTokenDead = false;
  try { await crashQ.completeStep(crashed!.runToken, {}); } catch { crashedTokenDead = true; }
  check('B16 崩溃步骤被回收为 ready，旧凭据失效', recovered.length === 1 && crashedTokenDead);

  const emptyQ = new InMemoryStepQueue();
  const empty = await executeOneStep({ queue: emptyQ, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  check('B17 空队列不产生任何状态，也不写日志',
    empty.claimed === false && (await emptyQ.runState('none')).length === 0);

  const idemQ = new InMemoryStepQueue();
  await idemQ.enqueueSteps('B20', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'i' } }]);
  await driveSteppedLoop({ queue: idemQ, runId: 'B20', principal: 'worker-a',
    first: { kind: 'tool-call', payload: { tool: 'sha256', input: 'i' } }, handlers, maxSteps: 5 });
  check('B20 调度器幂等：已排好首步时不重复插队',
    (await idemQ.runState('B20')).length === 1);

  let legacyTicks = 0;
  const legacy = await driveLegacyLoop({ tick: () => { legacyTicks += 1; },
    settled: () => legacyTicks >= 3, intervalMs: 0 });
  check('B18 默认常驻泵与改造前逐字等价（tick 次数一致）', legacy.ticks === 3 && legacyTicks === 3);
  const pumpQ = new InMemoryStepQueue();
  let pumpTicks = 0;
  const pumped = await driveSteppedPump({ config: stepConfig, queue: pumpQ, runId: 'B19',
    taskId: 'P1', principal: 'worker-a', tick: () => { pumpTicks += 1; },
    settled: () => pumpTicks >= 3, snapshot: () => ({ ticks: pumpTicks }) });
  const pumpStates = await pumpQ.runState('B19');
  check('B19 单步泵把会话快照写回队列，三步后自然收束',
    pumped.steps === 3 && pumped.stoppedBy === 'settled' && pumpStates.length === 3
      && (pumpStates[2].checkpoint as any)?.settled === true,
    { stoppedBy: pumped.stoppedBy, lastCheckpoint: pumpStates[2].checkpoint });

  // ---- D. 接线守门 -------------------------------------------------------
  const runner = read('src/runner.ts');
  const assistant = read('src/assistant-runner.ts');
  check('D1 两个宿主入口不再有常驻 while', !/while\s*\(!settled\)/.test(runner)
    && !/while\s*\(!settled\)/.test(assistant));
  check('D2 两个入口按配置分派 legacy / stepped 泵',
    /driveLegacyLoop/.test(runner) && /driveSteppedPump/.test(runner)
    && /driveLegacyLoop/.test(assistant) && /driveSteppedPump/.test(assistant));
  check('D3 v06 / server / 控制台只读白名单都含执行视图',
    /case 'execution-view':/.test(read('src/v06.ts'))
    && /'execution-view'\]/.test(read('src/server.ts'))
    && /'v06-execution-view'/.test(read('scripts/console-server.ts'))
    && /card\('长程执行'/.test(read('console/app.js')));
  check('D4 配置层有 step 必须配 local-pg 的校验',
    /execution\.mode === 'step' && cfg\.host\.provider !== 'local-pg'/.test(read('src/config.ts')));
  check('D5 脚本入口齐全', /"steps:smoke"/.test(read('package.json'))
    && /"step:once"/.test(read('package.json')));

  // ---- C. 专属 PG 库 + 真实跨进程单步 ------------------------------------
  const tmp = mkdtempSync(path.join(tmpdir(), 'collab-p1-'));
  const cfgFile = path.join(tmp, 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ ...real,
    host: { ...(real.host ?? {}), provider: 'local-pg' },
    execution: { schemaVersion: 1, mode: 'step', maxStepsPerRun: 60, staleSeconds: 60 } }, null, 2), { mode: 0o600 });
  const hitlFile = path.join(tmp, 'hitl.jsonl');
  const baseEnv = { ...process.env, COLLAB_CONFIG: cfgFile, COLLAB_STEP_PRINCIPAL: 'worker-a',
    COLLAB_STEP_SCOPE: 'p1-smoke', COLLAB_HITL_LEDGER: hitlFile,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    NODE_USE_ENV_PROXY: '0' };
  const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs');
  const entry = path.join(root, 'src/step-runner.ts');
  const once = (runId: string, extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, ['--import', loader, entry, runId],
      { cwd: root, env: { ...baseEnv, ...extra }, encoding: 'utf8', timeout: 90_000 });
    try { return { code: result.status, parsed: JSON.parse(String(result.stdout).trim()), stderr: result.stderr }; }
    catch { return { code: result.status, parsed: null as any, stderr: String(result.stderr || result.stdout).slice(0, 400) }; }
  };
  let pgQueue: PgStepQueue | null = null;
  try {
    pgQueue = PgStepQueue.fromConfig(stepConfig);
    const { rows } = await pgQueue.host.pool.query('select current_database() as db');
    check('C1 真实 PG 连接且只连专属库', rows[0].db === 'suitme_collab_c1', { db: rows[0].db });

    const runId = 'p1-' + randomUUID().slice(0, 8);
    await pgQueue.host.post('/heartbeat-runs', { id: runId, context: { taskId: 'P1' } });
    await pgQueue.enqueueSteps(runId, [{ kind: 'tool-call',
      payload: { tool: 'sha256', input: '真实跨进程单步', remaining: 1 } }]);
    const before = await pgQueue.runState(runId);
    check('C2 PG 队列只有第一步 ready', before.length === 1 && before[0].status === 'ready');

    const first = once(runId);
    const mid = await pgQueue.runState(runId);
    check('C3 子进程 1 真的只跑一步并原子激活下一棒',
      first.code === 0 && first.parsed?.claimed === true && first.parsed?.ok === true
        && first.parsed?.mode === 'step' && first.parsed?.queue === 'local-pg' && mid.length === 2
        && mid[0].status === 'done' && mid[1].status === 'ready'
        && (mid[0] as any).result?.counter === 1,
      { first: first.parsed, stderr: first.stderr?.slice(0, 160), states: mid.map(s => s.status) });

    const second = once(runId, { COLLAB_STEP_WORKER: 'step-worker-b',
      COLLAB_STEP_ENVIRONMENT: '另一台机器' });
    const end = await pgQueue.runState(runId);
    check('C4 第二棒由另一台机器领走，会话状态从队列续上',
      second.code === 0 && second.parsed?.ok === true && end.length === 2
        && end[1].status === 'done' && (end[1] as any).result?.counter === 2
        && (end[1] as any).result?.previousEnvironment === '本机执行环境',
      { second: second.parsed, stderr: second.stderr?.slice(0, 160), lastResult: end[1].result });
    const third = once(runId);
    check('C5 队列空时不产生新步骤', third.parsed?.claimed === false
      && (await pgQueue.runState(runId)).length === 2);

    const tokenQ = 'p1tok-' + randomUUID().slice(0, 8);
    await pgQueue.enqueueSteps(tokenQ, [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'token' } }]);
    const claimed = await pgQueue.claimStep('token-worker', tokenQ);
    await pgQueue.completeStep(claimed!.runToken, { done: true });
    let pgTokenDead = false;
    try { await pgQueue.completeStep(claimed!.runToken, { again: true }); } catch { pgTokenDead = true; }
    check('C6 PG 旧 runToken 完成被拒，不得重复写结果', pgTokenDead);

    const modelRun = 'p1model-' + randomUUID().slice(0, 8);
    await pgQueue.enqueueSteps(modelRun, [{ kind: 'model-call', payload: {} }]);
    const modelOnce = once(modelRun);
    const modelState = await pgQueue.runState(modelRun);
    check('C7 真实子进程遇到模型步如实拒绝并留下失败状态',
      modelOnce.parsed?.failed === true && /不编造模型调用/.test(modelOnce.parsed?.reason ?? '')
        && modelState[0].status === 'failed', { reason: modelOnce.parsed?.reason });
    const summary = stepExecutionSummary(end);
    check('C8 PG 状态摘要确定性且与隔离真跑口径一致',
      summary.done === 2 && summary.total === 2 && summary.modelCalls === 0
        && summary.signature === stepExecutionSummary(await pgQueue.runState(runId)).signature);

    // ---- E. HITL 成对留痕：真实子进程提问 + 真人入口回答 -----------------
    const hitlRun = 'p1hitl-' + randomUUID().slice(0, 8);
    await pgQueue.enqueueSteps(hitlRun, [{ kind: 'human-gate', payload: {
      question: '这一步需要真人确认后才能继续', choices: ['继续', '暂停'], triggeredBy: 'smoke-e1' } }]);
    const hitlOnce = once(hitlRun);
    const hitlSink = new FileHitlSink(hitlFile);
    const asked = hitlSink.read();
    check('E1 执行进程只提问不放行，并留下问题编号',
      hitlOnce.parsed?.failed === true && /原会话/.test(hitlOnce.parsed?.reason ?? '')
        && hitlOnce.parsed?.hitlQuestionId === asked[0]?.id
        && (await pgQueue.runState(hitlRun))[0].status === 'failed',
      { questionId: hitlOnce.parsed?.hitlQuestionId, reason: hitlOnce.parsed?.reason });
    check('E2 台账是 human_question，因果放载荷、信封只留标识',
      asked.length === 1 && asked[0].type === 'human_question'
        && asked[0].payload.triggered_by === 'smoke-e1'
        && !('triggered_by' in asked[0]) && !('question_id' in asked[0]));

    const answerBin = path.join(root, 'scripts/step-answer.ts');
    const runAnswer = (extra: Record<string, string>) => {
      const child = spawnSync(process.execPath, ['--import', loader, answerBin,
        String(hitlOnce.parsed?.hitlQuestionId ?? ''), '继续', '真跑备注'],
        { cwd: root, env: { ...baseEnv, ...extra }, encoding: 'utf8', timeout: 60_000 });
      let parsed: any = null;
      try { parsed = JSON.parse(String(child.stdout).trim()); } catch {}
      return { code: child.status, parsed, stderr: String(child.stderr ?? '').slice(0, 200) };
    };
    const answer = runAnswer({ COLLAB_HUMAN_ACTOR: '原发起人' });
    const answered = hitlSink.read();
    let projection: ReturnType<typeof assertHitlRedLines> | null = null;
    try { projection = assertHitlRedLines(answered); } catch { /* 下面按 null 判失败 */ }
    check('E3 真人回答只追加 human_response，成对闭环且不等于验收',
      answer.code === 0 && answer.parsed?.paired === true && projection !== null
        && projection.pairs.length === 1 && projection.pending.length === 0
        && projection.acceptanceAttempts.length === 0
        && answered[1]?.payload.question_id === asked[0].id
        && answered[1]?.payload.acceptance === false,
      { answer: answer.parsed, events: answered.length, stderr: answer.stderr });
    const repeat = runAnswer({ COLLAB_HUMAN_ACTOR: '原发起人' });
    check('E4 同一问题重复回答被拒，历史不回溯改写',
      repeat.parsed?.ok === false && /已经有回答/.test(repeat.parsed?.error ?? ''),
      { error: repeat.parsed?.error });
    const anonymous = runAnswer({ COLLAB_HUMAN_ACTOR: '' });
    check('E5 未声明真人身份时回答入口拒绝，执行进程不得冒充',
      anonymous.parsed?.ok === false && /真人身份/.test(anonymous.parsed?.error ?? ''),
      { error: anonymous.parsed?.error });
    check('E6 成对台账与 B1 记忆主干分离，未写进 events.jsonl',
      !existsSync(path.join(tmp, 'events.jsonl')) && answered.length === 2);

    // ---- F. 送达证据：PG 队列上的累计确认 / 至少一次通知 -----------------
    const tracked = new TrackedStepQueue(pgQueue);
    const deliveryRun = 'p1del-' + randomUUID().slice(0, 8);
    await tracked.enqueueSteps(deliveryRun, [
      { kind: 'tool-call', payload: { tool: 'sha256', input: 'delivery-a' } },
      { kind: 'tool-call', payload: { tool: 'sha256', input: 'delivery-b' } },
    ]);
    const claimedDelivery = await tracked.claimStep('delivery-worker', deliveryRun);
    await tracked.completeStep(claimedDelivery!.runToken, { ok: true });
    const evidence = tracked.evidence(deliveryRun);
    check('F1 领取与完成都留下送达/确认证据，通知至少一次',
      evidence.delivered === 1 && evidence.acknowledged === 1 && evidence.pendingDelivery === 0
        && evidence.notifications >= 1 && evidence.errors === 0 && evidence.atLeastOnce === true,
      evidence);
    const firstAck = tracked.acknowledgeUpTo(deliveryRun, 'd000002');
    const staleAck = tracked.acknowledgeUpTo(deliveryRun, 'd000001');
    check('F2 累计确认只前进，旧确认不回退且积压清零',
      firstAck === 'd000002' && staleAck === 'd000002'
        && tracked.evidence(deliveryRun).atLeastOnce === false,
      { firstAck, staleAck });
    check('F3 通知幂等、投递就绪按能力声明，重投递只认空闲',
      notificationText(2) === notificationText(2)
        && deliveryReadiness({ idle: false, working: true, runtime: 'claude-code' }).ready === true
        && deliveryReadiness({ idle: false, working: true, runtime: 'step-once' }).ready === false
        && deliveryReadiness({ idle: false, working: true, runtime: 'claude-code',
          redelivery: true }).ready === false);

    // ---- G. Runner 四项借思想的落地守门 ---------------------------------
    const mission = deriveMissionState({ steps: [{ status: 'running' }], pendingQuestions: 0,
      hasFailure: false, interrupted: false, ended: false, lastActivityAt: 0, now: 30_000 });
    check('G1 六态由任务事实派生，已收敛与运行中可并存',
      mission.settled === true && mission.running === true && mission.state === 'working'
        && Object.keys(MISSION_STATE_LABELS).length === 6);
    let argvRejected = false;
    try { assertNoStoredArgv({ argv: ['--model', 'x'] }); } catch { argvRejected = true; }
    check('G2 运行时只声明能力、不存启动参数，未知名称保守处理',
      resolveRuntime('claude-code').queuesInputMidTurn === true
        && resolveRuntime('unknown').queuesInputMidTurn === false && argvRejected);
    let layeringRejected = false;
    try {
      assertCoordinationLayering({ configTables: [{ name: 'config', columns: ['mode'] }],
        coordinationLog: memoryLog, singleMutableSharedState: memoryLog });
      assertCoordinationLayering({ configTables: [{ name: 'config', columns: ['status'] }],
        coordinationLog: memoryLog, singleMutableSharedState: memoryLog });
    } catch { layeringRejected = true; }
    check('G3 配置库只放配置、实时协作只在追加写日志（机器化守门）', layeringRejected);
    let rewriteRejected = false;
    try {
      assertSnapshotNoRewrite([{ id: 'd1', configRevision: 'r1', evidence: 'agents:r1:0' }],
        [{ id: 'd1', configRevision: 'r2', evidence: 'agents:r2:0' }], 'r2');
    } catch { rewriteRejected = true; }
    check('G4 编制快照变更不回溯改写历史决策', rewriteRejected);
    const stepView = executionView(stepConfig);
    check('G5 只读执行视图暴露六态、能力声明与两条协议说明',
      stepView.mission.states.length === 6 && stepView.mission.settledAndRunningCanCoexist === true
        && stepView.hitl.pairedEvidence === true && /只前进/.test(stepView.delivery.cumulativeAck)
        && stepView.modelCalls === 0);
  } catch (error) {
    check('C0 PG 真跑未发生（不得把跳过算作通过）', false,
      { error: String(error instanceof Error ? error.message : error) });
  } finally {
    if (pgQueue) await pgQueue.close();
    rmSync(tmp, { recursive: true, force: true });
  }

  const memoryAfter = existsSync(memoryLog) ? readFileSync(memoryLog, 'utf8').split('\n').filter(Boolean).length : 0;
  check('D6 真跑前后 B1 记忆主干行数不变，不污染既有证据', memoryBefore === memoryAfter,
    { before: memoryBefore, after: memoryAfter });

  const failed = checks.filter(c => !c.ok).map(c => c.name);
  const report = {
    ok: failed.length === 0, checks: checks.length, failed, details: checks,
    note: 'A/B/D 在隔离内存队列与静态守门上真跑；C 在本机 PG 专属库 suitme_collab_c1 上用唯一 runId + 真实子进程跨进程领步；E 用真实子进程提出人工问题、真人入口回答并校验成对留痕；F 在同一 PG 队列上验证送达/确认证据、累计确认与至少一次通知；G 验证 Runner 四项借思想的落地守门。台账写在临时目录，未 reset 他人数据、未写 B1 主干、未发生任何外部模型调用。',
    pgRunIdEvidence: '本次 runId 为随机值，PG 内留下 append-only 留痕，未清空其它数据',
  };
  mkdirSync(runtime(), { recursive: true });
  writeFileSync(runtime('steps-smoke.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed,
    report: '.runtime/steps-smoke.json' }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error('STEPS_SMOKE_FAILED', error);
  process.exitCode = 1;
});
