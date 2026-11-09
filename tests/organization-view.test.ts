// 组织视图只读：共享上下文底座 + 按职能配置的三层座位 + 可见任务分布。
// 关键口径：没有配置就是扁平，不硬造主管；同一个 Agent 可兼任多层。
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRegistrySchema, defaultAgentRegistry } from '../src/agent-registry.ts';
import { buildOrganizationView } from '../src/organization-view.ts';
import type { Task } from '../src/store.ts';

function task(id: string, agent: string, phase: string, context = '一件真实任务'): Task {
  return { id, identifier: id.toUpperCase(), kind: 'collaboration', agent, phase, context, generation: 1 } as Task;
}

const empty = defaultAgentRegistry();
const registry = agentRegistrySchema.parse({
  schemaVersion: 1,
  agents: [
    { key: 'lead-product', label: '产品负责人助手', responsibilities: ['personal', 'supervisor'], domains: ['product'] },
    { key: 'builder', label: '产品执行助手', responsibilities: ['worker', 'acceptance'], domains: ['product'] },
    { key: 'ops-lead', label: '运营主管助手', responsibilities: ['supervisor'], domains: ['growth'] },
  ],
});

test('空编制如实显示扁平，不硬造主管或验收 Agent', () => {
  const view = buildOrganizationView({
    shape: { mode: 'flat', domains: [], maxHops: 1 },
    registry: empty,
    tasks: [task('t1', 'builder', 'review')],
    events: 12, sources: 3, spaces: 1,
  });
  assert.equal(view.shape.layered, false);
  assert.equal(view.shape.maxHops, 1);
  assert.ok(view.shape.label.includes('扁平'));
  assert.equal(view.contextBase.shared, true);
  assert.equal(view.contextBase.modelCalls, 0);
  assert.ok(view.contextBase.projections.includes('Context Pack'));
  assert.equal(view.layers.find(layer => layer.key === 'supervisor')?.configured, false);
  assert.equal(view.tasks.unassigned, 1);
  assert.ok(view.notes.some(note => note.includes('不硬造')));
});

test('按业务域分层：主管、执行、验收各就各位，任务按承接 Agent 归并', () => {
  const view = buildOrganizationView({
    shape: { mode: 'layered', domains: ['product', 'growth'], maxHops: 2 },
    registry,
    tasks: [task('t1', 'builder', 'review'), task('t2', 'builder', 'accepted'), task('t3', 'lead-product', 'in_progress')],
    events: 30, sources: 5, spaces: 2,
  });
  assert.equal(view.shape.layered, true);
  assert.equal(view.shape.maxHops, 2);
  assert.deepEqual(view.shape.domains, ['growth', 'product']);
  const personal = view.layers.find(layer => layer.key === 'personal');
  const supervisor = view.layers.find(layer => layer.key === 'supervisor');
  const delivery = view.layers.find(layer => layer.key === 'delivery');
  assert.deepEqual(personal?.agents.map(agent => agent.key), ['lead-product']);
  assert.deepEqual(supervisor?.agents.map(agent => agent.key).sort(), ['lead-product', 'ops-lead']);
  assert.deepEqual(delivery?.agents.map(agent => agent.key), ['builder']);
  const product = view.domains.find(row => row.domain === 'product');
  assert.equal(product?.supervisor, 'lead-product');
  assert.equal(product?.workers, 1);
  assert.equal(product?.reviewers, 1);
  assert.equal(product?.tasks, 3);
  assert.equal(view.tasks.byAgent.find(row => row.agent === 'builder')?.count, 2);
  assert.equal(view.tasks.unassigned, 0);
  assert.equal(view.tasks.byPhase.review, 1);
});

test('未登记的业务域与未分配任务如实计数，不靠猜标题补全', () => {
  const view = buildOrganizationView({
    shape: { mode: 'flat', domains: [] },
    registry,
    tasks: [task('t1', 'outside-agent', 'intake'), task('t2', 'builder', 'review')],
    events: 1, sources: 0, spaces: 0,
  });
  assert.equal(view.tasks.unassigned, 1);
  assert.ok(view.tasks.note.includes('职能域来自组织编制配置'));
  assert.equal(view.shape.maxHops, 1);
});
