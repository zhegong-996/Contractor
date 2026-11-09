// 第四十一轮 · 一条命令安装（src/bootstrap.ts）。
//
// 钉住四件事：计划幂等（已完成的步骤会跳过）、失败即停（不假装装好了）、
// dry-run 不执行任何命令、自动化边界如实写在 nextSteps 里而不是「一键搞定」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBootstrapPlan, runBootstrap, nodeTooOld, parseNodeVersion, type BootstrapEnv } from '../src/bootstrap.ts';

const env = (over: Partial<BootstrapEnv> = {}): BootstrapEnv => ({
  nodeVersion: 'v24.11.0', hasNodeModules: true, hasConfig: true, hasSecrets: true,
  hasRuntime: true, servicesRunning: true, ...over,
});

test('安装计划：全新机器要生成配置、装依赖、起服务；已装好的机器只做幂等步骤', () => {
  const fresh = buildBootstrapPlan(env({ hasNodeModules: false, hasConfig: false, hasSecrets: false, servicesRunning: false }));
  const freshIds = fresh.steps.map(step => step.id);
  assert.deepEqual(freshIds, ['prepare-config', 'install-deps', 'start-services', 'provision', 'doctor', 'audit']);

  const ready = buildBootstrapPlan(env());
  assert.deepEqual(ready.steps.map(step => step.id), ['provision', 'doctor', 'audit'],
    '已装好的机器不应重复生成配置 / 装依赖 / 起服务');
});

test('安装计划：Node 版本按 engines 声明判断，默认只警告不拦', () => {
  assert.equal(parseNodeVersion('v22.22.2').major, 22);
  assert.equal(nodeTooOld('v22.22.2'), true);
  assert.equal(nodeTooOld('v24.11.0'), false);
  assert.equal(nodeTooOld('v24.9.0'), true);
  const soft = buildBootstrapPlan(env({ nodeVersion: 'v22.22.2' }));
  assert.equal(soft.blocked, null, '实测能跑的版本不该硬拦');
  assert.equal(soft.warnings.length, 1);
  const strict = buildBootstrapPlan(env({ nodeVersion: 'v22.22.2', strictNode: true }));
  assert.ok(strict.blocked?.includes('engines'));
});

test('安装计划：人必须做的步骤写在 nextSteps，不写成自动完成', () => {
  const plan = buildBootstrapPlan(env());
  const text = plan.nextSteps.join('｜');
  assert.match(text, /console:owner/, '建管理员必须留给人');
  assert.match(text, /rules:view/);
  assert.match(text, /4200/, '控制台端口要写对');
  assert.ok(plan.notes.some(note => note.includes('失败即停')));
});

test('执行：失败即停，后续步骤不再执行，也不会报告成功', async () => {
  const plan = buildBootstrapPlan(env({ hasNodeModules: false }));
  const calls: string[] = [];
  const outcome = await runBootstrap(plan, {
    exec: async (command, args) => {
      calls.push(command + ' ' + args.join(' '));
      if (args.includes('ci')) return { code: 1, stderr: 'EACCES 权限不足' };
      return { code: 0 };
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stoppedAt, 'install-deps');
  assert.equal(calls.length, 1, '失败后不应继续执行后续步骤');
  assert.match(outcome.message, /EACCES/);
});

test('执行：dry-run 只打印，不调用任何命令', async () => {
  const plan = buildBootstrapPlan(env({ hasNodeModules: false }));
  const lines: string[] = [];
  const outcome = await runBootstrap(plan, {
    dryRun: true, log: line => lines.push(line),
    exec: async () => { throw new Error('dry-run 不应执行命令'); },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.executed.length, 0);
  assert.ok(lines.some(line => line.includes('将执行')), lines.join('｜'));
});

test('执行：非致命步骤失败只记录，不中断剩下的步骤', async () => {
  const plan = buildBootstrapPlan(env());
  const calls: string[] = [];
  const outcome = await runBootstrap(plan, {
    exec: async (command, args) => {
      calls.push(args[0] ?? command);
      if (args.includes('doctor')) return { code: 2, stderr: '飞书未授权' };
      return { code: 0 };
    },
  });
  assert.equal(outcome.ok, true, '体检失败不该拦住整个安装');
  assert.equal(calls.length, 3);
  assert.equal(outcome.executed.find(step => step.id === 'doctor')?.code, 2);
});
