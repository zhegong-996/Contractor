// P3: read-only workbench projections + runtime-guard observation bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Store } from '../src/store.ts';
import { V06Services } from '../src/v06.ts';
import { MemoryV06Store } from '../src/v06-store.ts';
import { RuntimeGuardBridge } from '../src/runtime-bridge.ts';
import { createPlan, encodePlan, type AcceptancePlan } from '../src/acceptance-plan.ts';

const at = '2026-11-06T08:00:00.000Z';
const opts = { workbenchUrl: 'http://127.0.0.1:4180', channel: 'workspace' as const, actorUserId: 'pd-owner' };
const admin = { admin: true, userId: 'pd-owner' };

function setup(pc?: { get: (route: string) => Promise<any>; document: (a: string, b: string, c: string, d: string) => Promise<any> }) {
  const localStore = { audit: () => {}, notify: () => {} } as unknown as Store;
  return new V06Services(localStore, pc, new MemoryV06Store());
}
function pcWithPlan(plan: AcceptancePlan) {
  const docs: Record<string, any> = {
    [`/issues/${plan.taskId}/documents/acceptance-plan`]: { body: encodePlan(plan), latestRevisionId: 'rev-plan-1' },
  };
  return {
    get: async (route: string) => {
      const doc = docs[route];
      if (!doc) throw new Error(`Paperclip GET ${route}: 404 not found`);
      return doc;
    },
    document: async () => ({}),
  };
}

test('org-overview 一次返回十段组织视图（含 L2 抽取状态与飞书组织映射），单段失败不影响其余', async () => {
  const value: any = await setup().dispatch('org-overview', { space: 'default' }, admin, opts);
  assert.equal(value.space, 'default');
  assert.deepEqual(value.sections.map((s: any) => s.name),
    ['registry', 'transferPolicy', 'policy', 'attention', 'watchdog', 'reviewer', 'ontology', 'extraction', 'feishuOrg', 'signals']);
  assert.ok(value.sections.every((s: any) => typeof s.ok === 'boolean' && (s.ok ? 'value' in s : 'error' in s)));
  assert.ok(value.sections.filter((s: any) => s.ok).length >= 4);
});

test('plan-view 读回开工前锁定的清单及原生修订号', async () => {
  const plan = createPlan({ taskId: 'SUI-900', names: ['报价版本正确', '客户可见文案'], lockedBy: 'pd-owner', lockedAt: at });
  const service = setup(pcWithPlan(plan));
  const value: any = await service.dispatch('plan-view', { taskId: plan.taskId }, admin, opts);
  assert.equal(value.plan.hash, plan.hash);
  assert.equal(value.revision, 'rev-plan-1');
  assert.equal(value.plan.items.length, 2);
});

test('未接原生文档存储时 plan-view / round-view 返回 null 而不抛错', async () => {
  const service = setup();
  assert.equal(await service.dispatch('plan-view', { taskId: 'SUI-901' }, admin, opts), null);
  assert.equal(await service.dispatch('round-view', { taskId: 'SUI-901' }, admin, opts), null);
});

test('round-view 在没有评审报告时返回 null', async () => {
  const plan = createPlan({ taskId: 'SUI-902', names: ['报价版本正确'], lockedBy: 'pd-owner', lockedAt: at });
  const value = await setup(pcWithPlan(plan)).dispatch('round-view', { taskId: plan.taskId }, admin, opts);
  assert.equal(value, null);
});

test('RuntimeGuardBridge 观测一轮执行并写审计，默认不拦截', async () => {
  const audits: any[] = [];
  const bridge = new RuntimeGuardBridge({ audit: (...args: any[]) => audits.push(args) });
  const result = await bridge.observe({ taskId: 'SUI-903', runId: 'run-1', actorId: 'li',
    summary: '模型调用回执', at }, 'default');
  assert.equal(result.enforced, false);
  assert.equal(typeof result.attention.wake, 'boolean');
  assert.ok(['healthy', 'stalled', 'runaway', 'waiting'].includes(result.watchdog.state));
  assert.equal(audits[0]?.[0], 'v06.runtime-observed');
  assert.equal(audits[0]?.[1], 'SUI-903');
});

test('Watchdog 识别停滞；无检查点禁止自动重放，有检查点才允许恢复', async () => {
  const bridge = new RuntimeGuardBridge({ audit: () => {} });
  const base = { taskId: 'SUI-904', runId: 'run-2', actorId: 'li', summary: '执行回执',
    at: '2026-11-06T09:00:00.000Z', lastProgressAt: '2026-11-06T08:00:00.000Z', status: 'running' as const };
  const stalled = await bridge.observe(base);
  assert.equal(stalled.watchdog.state, 'stalled');
  assert.equal(stalled.watchdog.recoveryAllowed, false);
  const resumable = await bridge.observe({ ...base, checkpoint: 'cp-1' });
  assert.equal(resumable.watchdog.recoveryAllowed, true);
});

test('策略读取失败时降级到默认策略，不影响观测结果', async () => {
  const bridge = new RuntimeGuardBridge({ audit: () => {} }, async () => { throw new Error('config unavailable'); }, true);
  const result = await bridge.observe({ taskId: 'SUI-905', runId: 'run-3', actorId: 'li', summary: '回执', at });
  assert.equal(result.enforced, true);
  assert.equal(typeof result.attention.wake, 'boolean');
});

test('新增只读 action 同时登记在 server 与 members 的 v06Reads', () => {
  for (const file of ['src/server.ts', 'src/members.ts']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const name of ['plan-view', 'round-view', 'org-overview', 'context-pack']) {
      assert.ok(source.includes(`'${name}'`), `${file} 的只读清单缺少 ${name}`);
    }
  }
});

test('工作台三个视图接进现有 5 tab 的二级导航', () => {
  // 前端已按职责拆分；二级导航分散在 task-detail / spaces / settings，读取整个 ui 目录。
  const dir = path.join(new URL('..', import.meta.url).pathname, 'plugins/knowledge-workspaces/src/ui');
  const source = readdirSync(dir).filter(f => f.endsWith('.tsx'))
    .map(f => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(source.includes("['governance', '验收与责任']"));
  assert.ok(source.includes("['relations', '关系与状态']"));
  assert.ok(source.includes("tab === 'organization'"));
  assert.ok(source.includes('<GovernancePanel') && source.includes('<OrganizationPanel') && source.includes('<KnowledgeStatePanel'));
});
