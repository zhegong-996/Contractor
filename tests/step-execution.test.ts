// P-1 契约：长程循环单步化（第二十二轮）。
// 默认 loop 可回退；step 必须配状态外置队列；一次调用只做一步；步间重评权限；
// 旧凭据失效、崩溃可回收、换机器续跑；不改变 B1 主干；各处接线不漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configSchema, loadConfig, root, defaultExecutionConfig } from '../src/config.ts';
import {
  InMemoryStepQueue, executeOneStep, driveSteppedLoop, stepExecutionSummary,
  executionView, defaultStepRecheck, STEP_RED_LINES,
} from '../src/step-execution.ts';
import { driveLegacyLoop, driveSteppedPump } from '../src/loop-pump.ts';
import { stepRunnerHandlers, STEP_RUNNER_TOOLS } from '../src/step-runner.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const handlers = stepRunnerHandlers();
const stepConfig = () => configSchema.parse({ ...loadConfig(),
  host: { ...loadConfig().host, provider: 'local-pg' as const },
  execution: { schemaVersion: 1 as const, mode: 'step' as const, maxStepsPerRun: 60, staleSeconds: 60 } });

test('执行形态默认仍是常驻循环，step 没有状态外置队列就被配置层拒绝', () => {
  assert.equal(defaultExecutionConfig().mode, 'loop');
  assert.equal(loadConfig().execution.mode, 'loop');
  assert.throws(() => configSchema.parse({ ...loadConfig(),
    host: { ...loadConfig().host, provider: 'paperclip' },
    execution: { schemaVersion: 1, mode: 'step' } }), /local-pg/);
  assert.equal(stepConfig().execution.mode, 'step');
});

test('只读视图如实说明是否启用，缺项不隐藏，modelCalls=0', () => {
  const view = executionView(loadConfig());
  assert.equal(view.steppedReady, false);
  assert.equal(view.mode, 'loop');
  assert.equal(view.modelCalls, 0);
  assert.ok(view.missing.some(m => /默认底座仍是 paperclip/.test(m)));
  assert.ok(view.missing.some(m => /模型端点/.test(m)));
  assert.equal(executionView(stepConfig()).steppedReady, true);
  assert.equal(STEP_RED_LINES.length, 5);
});

test('队列只有首步 ready，并发领取只有一个 worker 拿到', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('t1', [
    { kind: 'tool-call', payload: { tool: 'sha256', input: 'a' } },
    { kind: 'tool-call', payload: { tool: 'sha256', input: 'b' } },
  ]);
  const states = await queue.runState('t1');
  assert.deepEqual(states.map(s => s.status), ['ready', 'queued']);
  const raced = await Promise.all([queue.claimStep('w1', 't1'), queue.claimStep('w2', 't1')]);
  assert.equal(raced.filter(Boolean).length, 1);
  assert.equal((await queue.runState('t1')).filter(s => s.status === 'running').length, 1);
});

test('完成动作原子激活下一棒，旧 runToken 不得重复写结果', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('t2', [{ kind: 'tool-call' }, { kind: 'tool-call' }]);
  const step = (await queue.claimStep('w1', 't2'))!;
  const done = await queue.completeStep(step.runToken, { ok: true }, { checkpoint: { n: 1 }, modelCalls: 0 });
  assert.equal(done.nextStepNo, 2);
  assert.deepEqual((await queue.runState('t2')).map(s => s.status), ['done', 'ready']);
  await assert.rejects(() => queue.completeStep(step.runToken, { again: true }), /runToken 无效/);
});

test('一次调用只做一步，会话状态只能从队列 checkpoint 续上', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  const seen: Array<{ counter: number; environment: string }> = [];
  const traced = { 'tool-call': (step: any, ctx: any) => {
    seen.push({ counter: Number(ctx.previousCheckpoint.counter ?? 0), environment: ctx.environment });
    return handlers['tool-call']!(step, ctx);
  } };
  const drive = await driveSteppedLoop({ queue, runId: 't3', principal: 'worker-a',
    first: { kind: 'tool-call', payload: { tool: 'sha256', input: 'x', remaining: 2 } },
    handlers: traced, maxSteps: 10,
    worker: n => ({ workerId: `w${n}`, environment: n % 2 ? '机器甲' : '机器乙' }) });
  assert.equal(drive.steps, 3);
  assert.equal(drive.stoppedBy, 'settled');
  assert.deepEqual(seen.map(s => s.counter), [0, 1, 2]);
  assert.deepEqual([...new Set(drive.environments)].sort(), ['机器乙', '机器甲'].sort());
  assert.equal((await queue.runState('t3')).length, 3);
});

test('步间按当前主体重评权限：缺身份 / 范围不一致都 fail-closed', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('t4', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'a' } }]);
  const noPrincipal = await executeOneStep({ queue, handlers, workerId: 'w', principal: '',
    environment: '机器甲' });
  assert.equal(noPrincipal.failed, true);
  assert.match(noPrincipal.reason ?? '', /最小权限/);
  const scopeQueue = new InMemoryStepQueue(() => 0);
  await scopeQueue.enqueueSteps('t5', [{ kind: 'tool-call', payload: { scope: '全域' } }]);
  const wrongScope = await executeOneStep({ queue: scopeQueue, handlers, workerId: 'w',
    principal: 'worker-a', environment: '机器乙', scope: '本任务' });
  assert.equal(wrongScope.failed, true);
  assert.match(wrongScope.reason ?? '', /资料范围/);
  assert.equal(defaultStepRecheck({ principal: 'worker-a', scope: '本任务', environment: '机器乙',
    step: { kind: 'tool-call', payload: { scope: '本任务' } } as any }).ok, true);
});

test('未登记步骤、模型步、人工确认步、白名单外工具一律拒绝，不静默跳过', async () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['unregistered', {}, /没有登记/],
    ['model-call', {}, /不编造模型调用/],
    ['human-gate', {}, /原会话/],
    ['worker-tick', {}, /宿主入口/],
  ];
  for (const [kind, payload, pattern] of cases) {
    const queue = new InMemoryStepQueue(() => 0);
    await queue.enqueueSteps('reject-' + kind, [{ kind, payload }]);
    const result = await executeOneStep({ queue, handlers, workerId: 'w', principal: 'worker-a',
      environment: '机器甲' });
    assert.equal(result.failed, true, kind);
    assert.match(result.reason ?? '', pattern, kind);
  }
  const badTool = new InMemoryStepQueue(() => 0);
  await badTool.enqueueSteps('reject-tool', [{ kind: 'tool-call', payload: { tool: 'shell', input: 'x' } }]);
  const toolResult = await executeOneStep({ queue: badTool, handlers, workerId: 'w',
    principal: 'worker-a', environment: '机器甲' });
  assert.equal(toolResult.failed, true);
  assert.match(toolResult.reason ?? '', /工具白名单/);
  assert.deepEqual([...STEP_RUNNER_TOOLS], ['sha256']);
});

test('崩溃回收把 running 放回 ready，旧 runToken 立即作废', async () => {
  let clock = 0;
  const queue = new InMemoryStepQueue(() => clock);
  await queue.enqueueSteps('t6', [{ kind: 'tool-call' }]);
  const step = (await queue.claimStep('w1', 't6'))!;
  clock = 120_000;
  assert.equal((await queue.recoverStaleSteps(60)).length, 1);
  assert.equal((await queue.runState('t6'))[0].status, 'ready');
  await assert.rejects(() => queue.completeStep(step.runToken, {}), /runToken 无效/);
});

test('失败可重试且旧凭据作废；确定性摘要两次逐字节一致', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('t7', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'r' } }]);
  const step = (await queue.claimStep('w1', 't7'))!;
  const failed = await queue.failStep(step.runToken, '模拟失败', 3);
  assert.equal(failed.retryable, true);
  await assert.rejects(() => queue.completeStep(step.runToken, {}), /runToken 无效/);
  const retried = (await queue.claimStep('w2', 't7'))!;
  await queue.completeStep(retried.runToken, { ok: true }, { modelCalls: 2 });
  const states = await queue.runState('t7');
  assert.equal(stepExecutionSummary(states).signature,
    stepExecutionSummary(await queue.runState('t7')).signature);
  assert.equal(stepExecutionSummary(states).modelCalls, 2);
});

test('空队列不产生状态；调度器已排首步时不重复插队', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  const empty = await executeOneStep({ queue, handlers, workerId: 'w', principal: 'worker-a',
    environment: '机器甲' });
  assert.equal(empty.claimed, false);
  assert.equal((await queue.runState('none')).length, 0);
  const idem = new InMemoryStepQueue(() => 0);
  await idem.enqueueSteps('t8', [{ kind: 'tool-call', payload: { tool: 'sha256', input: 'i' } }]);
  await driveSteppedLoop({ queue: idem, runId: 't8', principal: 'worker-a',
    first: { kind: 'tool-call', payload: { tool: 'sha256', input: 'i' } }, handlers, maxSteps: 5 });
  assert.equal((await idem.runState('t8')).length, 1);
});

test('默认泵逐字等价；单步泵把会话快照写回队列', async () => {
  let ticks = 0;
  const legacy = await driveLegacyLoop({ tick: () => { ticks += 1; },
    settled: () => ticks >= 3, intervalMs: 0 });
  assert.equal(legacy.ticks, 3);
  const queue = new InMemoryStepQueue(() => 0);
  let pumpTicks = 0;
  const pumped = await driveSteppedPump({ config: stepConfig(), queue, runId: 't9',
    taskId: 'P1', principal: 'worker-a', tick: () => { pumpTicks += 1; },
    settled: () => pumpTicks >= 3, snapshot: () => ({ ticks: pumpTicks }) });
  assert.equal(pumped.steps, 3);
  assert.equal(pumped.stoppedBy, 'settled');
  assert.equal(((await queue.runState('t9'))[2].checkpoint as { settled?: boolean }).settled, true);
});

test('接线：两个宿主入口无常驻 while，只读白名单与脚本入口不漂移', () => {
  const runner = read('src/runner.ts');
  const assistant = read('src/assistant-runner.ts');
  assert.doesNotMatch(runner, /while\s*\(!settled\)/);
  assert.doesNotMatch(assistant, /while\s*\(!settled\)/);
  assert.match(runner, /driveLegacyLoop\(pump\)/);
  assert.match(runner, /driveSteppedPump\(/);
  assert.match(assistant, /driveLegacyLoop\(pump\)/);
  assert.match(assistant, /driveSteppedPump\(/);
  assert.match(read('src/config.ts'), /execution\.mode === 'step' && cfg\.host\.provider !== 'local-pg'/);
  assert.match(read('src/v06.ts'), /case 'execution-view':/);
  assert.match(read('src/server.ts'), /'execution-view'\]/);
  assert.match(read('scripts/console-server.ts'), /'v06-execution-view'/);
  assert.match(read('console/app.js'), /card\('长程执行'/);
  assert.match(read('package.json'), /"steps:smoke"/);
  assert.match(read('package.json'), /"step:once"/);
});

test('真跑脚本不写真实记忆日志，PG 只连专属库且用唯一 runId', () => {
  const smoke = read('scripts/steps-smoke.ts');
  assert.match(smoke, /memoryBefore === memoryAfter/);
  assert.match(smoke, /suitme_collab_c1/);
  assert.match(smoke, /randomUUID\(\)/);
  assert.doesNotMatch(smoke, /resetForTest/);
  assert.match(read('src/step-execution.ts'), /assertLocalPgDsn/);
});
