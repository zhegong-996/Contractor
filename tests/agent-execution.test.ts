// 第六十七轮 · 执行语义契约：
// `mode` 不再是配置里的注释——平台有没有能力兑现「托管」，由 use/command 判定；
// 判不出来就诚实降级成「人工接单」并标注配置缺口，绝不静默等待。
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentExecution, executionsOf, executionOfKey, executionRollup,
  assignmentFeasibility } from '../src/agent-execution.ts';
import type { Agent } from '../src/config.ts';

/** 只填判据需要的字段，其余走配置默认语义。 */
function agent(over: Partial<Agent> = {}): Agent {
  return {
    name: '测试执行端', mode: 'managed', use: 'codex', access: 'edit',
    enabled: true, paperclipId: 'pid-1', ...over,
  } as Agent;
}

test('managed + 引擎 → 自动执行', () => {
  const e = agentExecution('codex', agent());
  assert.equal(e.kind, 'auto');
  assert.equal(e.problem, null);
  assert.equal(e.readOnly, false);
  assert.match(e.reason, /平台托管/);
});

test('managed + 只读 → 自动执行但标注只能读', () => {
  const e = agentExecution('assistant', agent({ access: 'read' }));
  assert.equal(e.kind, 'auto');
  assert.equal(e.readOnly, true);
  assert.match(e.reason, /只有读权限/);
});

test('manual → 人工接单，即使配了引擎也不自动推进', () => {
  const e = agentExecution('role-product', agent({ mode: 'manual', use: 'command', access: 'read' }));
  assert.equal(e.kind, 'human');
  assert.match(e.reason, /人工接单/);
});

test('manual 且配了引擎 → 仍人工，但说明引擎只作辅助', () => {
  const e = agentExecution('wb', agent({ mode: 'manual', use: 'codex' }));
  assert.equal(e.kind, 'human');
  assert.match(e.reason, /只作辅助/);
});

test('managed + use=command 缺命令行 → 诚实降级成人工并报配置缺口', () => {
  const e = agentExecution('command', agent({ use: 'command', command: undefined }));
  assert.equal(e.kind, 'human');
  assert.ok(e.problem);
  assert.match(e.problem!, /未配命令行/);
  assert.match(e.reason, /配置缺口/);
});

test('managed + use=command 配了命令行 → 自动执行', () => {
  const e = agentExecution('cmd', agent({ use: 'command', command: ['node', 'x.mjs'] }));
  assert.equal(e.kind, 'auto');
  assert.equal(e.problem, null);
  assert.match(e.reason, /自定义命令/);
});

test('缺 paperclipId → 未注册，不会被派单', () => {
  const e = agentExecution('orphan', agent({ paperclipId: undefined }));
  assert.match(e.problem ?? '', /缺 paperclipId/);
});

test('汇总只数在岗：停用不计入 auto/human，但缺口照报', () => {
  const agents: Record<string, Agent> = {
    codex: agent(),
    role: agent({ mode: 'manual', use: 'command' }),
    off: agent({ enabled: false }),
    broken: agent({ use: 'command', command: undefined }),
  };
  const rollup = executionRollup(executionsOf(agents));
  assert.equal(rollup.auto, 1);
  assert.equal(rollup.human, 2);
  assert.equal(rollup.disabled, 1);
  assert.equal(rollup.problems, 1);
  assert.deepEqual(rollup.autoKeys, ['codex']);
  assert.deepEqual(rollup.humanKeys, ['broken', 'role']);
});

test('executionOfKey 对未知 key 返回 null，不编造', () => {
  assert.equal(executionOfKey({}, 'nope'), null);
  assert.equal(executionOfKey({}, null), null);
  assert.equal(executionOfKey({ codex: agent() }, 'codex')?.kind, 'auto');
});

test('承接人可行性：无候选 / 不在 config / 停用 / 人工 / 自动 各有显式结局', () => {
  const agents: Record<string, Agent> = {
    codex: agent(),
    role: agent({ mode: 'manual', use: 'command' }),
    off: agent({ enabled: false }),
  };
  assert.equal(assignmentFeasibility(null, agents).kind, 'unassignable');
  assert.match(assignmentFeasibility('ghost', agents).reason, /没有对应的执行定义/);
  assert.equal(assignmentFeasibility('off', agents).kind, 'unassignable');
  assert.equal(assignmentFeasibility('role', agents).kind, 'human');
  assert.equal(assignmentFeasibility('codex', agents).kind, 'auto');
  // 三种结局都必须带原因：不许静默等待。
  for (const key of [null, 'ghost', 'off', 'role', 'codex']) {
    assert.ok(assignmentFeasibility(key, agents).reason.length > 0);
  }
});

test('同一份配置重复求值稳定（纯函数，可重放）', () => {
  const agents: Record<string, Agent> = { a: agent(), b: agent({ mode: 'manual' }) };
  assert.deepEqual(executionsOf(agents), executionsOf(agents));
});
