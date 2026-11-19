import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AgentBudgets } from '../src/workbench/agent-budget.ts';
import { TokenPoints, pointPolicyInput, type PointScope } from '../src/workbench/token-points.ts';

test('积分按实际 Token 和冻结倍率扣减，预留拦住低倍率和其他类型的委托', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let now = Date.parse('2026-11-16T12:01:00+08:00');
    const calls = new AgentBudgets(db, () => now);
    const points = new TokenPoints(db, () => now);
    const rates = [{ provider: 'openai', model: 'small', multiplier: 0.1, reserveTokens: 1000 },
      { provider: 'deepseek', model: 'other', multiplier: 0.5, reserveTokens: 1000 },
      { provider: 'openai', model: 'large', multiplier: 3, reserveTokens: 1000 }];
    const policy = pointPolicyInput.parse({ tokensPerPoint: 1000, rates });
    assert.equal(pointPolicyInput.safeParse({ ...policy, rates: [rates[0], rates[0]] }).success, false);
    points.setPolicy(policy);
    const project = { kind: 'project', subject: 'store' } as const;
    const execution = { kind: 'execution', subject: 'store' } as const;
    const personal = { kind: 'personal', subject: 'engineer' } as const;
    const agent = { kind: 'agent', subject: 'store/codex' } as const;
    const child: PointScope = { kind: 'project', subject: 'store-child' };
    const scopes = [project, execution, agent];
    points.setLimit({ ...project, period: 'day', limit: 3 });
    points.setLimit({ ...agent, period: 'month', limit: 3 });
    const quote = points.quote('openai', 'large')!;
    const cheap = points.quote('openai', 'small')!;
    assert.equal(cheap.reserved, 100);
    assert.equal(points.admit(scopes, undefined, true), '实际选用的模型尚未配置 Token 积分倍率');
    assert.equal(points.admit(scopes, quote, true), undefined);
    assert.ok(calls.reserve({ ...execution, run: 1, attempt: 1, project: 'store', owner: 'engineer', agent: 'codex' }));
    points.reserve(1, 1, quote);
    assert.equal(points.view(project).reserved, 3);
    assert.match(points.admit([project, personal], cheap, true)!, /项目总积分/);
    assert.equal(points.view(child).remaining, null);
    assert.equal(points.view(child).reserved, 0);
    points.setPolicy({ tokensPerPoint: 2000, rates });
    points.settle(1, 1, 'codex', { input: 400, cached: 100, output: 100, cost: 99 }, true);
    points.settle(1, 1, 'codex', { input: 6000, output: 1000 });
    const first = points.receipts('store')[0]!;
    assert.deepEqual([first.tokens, first.charged, first.outstanding, first.tokensPerPoint, first.state], [500, 1.5, 1.5, 1000, 'partial']);
    assert.equal(points.view(project).remaining, 0);
    now += 24 * 60 * 60 * 1000;
    assert.equal(points.view(project).remaining, 3);
    assert.match(points.admit(scopes, cheap, true)!, /Agent 积分/);

    const next = points.quote('deepseek', 'other')!;
    assert.ok(calls.reserve({ ...personal, run: 2, attempt: 1, project: 'store', owner: 'engineer', agent: 'claude' }));
    points.reserve(2, 1, next);
    points.settle(2, 1, 'claude', { input: 200, output: 100, cached: 100 });
    const second = points.receipts('store')[1]!;
    assert.deepEqual([second.tokens, second.charged, second.outstanding, second.state], [400, 0.1, 0, 'metered']);
    assert.equal(points.view(project).used, 0.1);
    assert.equal(points.view(personal).used, 0.1);
    assert.equal(points.view(execution).used, 1.5, '个人代办只增加个人池和项目总池');

    for (const [run, neverLaunched] of [[3, false], [4, true]] as const) {
      assert.ok(calls.reserve({ ...personal, run, attempt: 1, project: 'store', owner: 'engineer', agent: 'claude' }));
      points.reserve(run, 1, next);
      points.settle(run, 1, 'claude', undefined, false, neverLaunched);
    }
    const [, , unreported, unlaunched] = points.receipts('store');
    assert.deepEqual([unreported?.charged, unreported?.outstanding, unreported?.state], [null, 0.25, 'unreported']);
    assert.deepEqual([unlaunched?.charged, unlaunched?.outstanding, unlaunched?.state], [0, 0, 'not-launched']);
  } finally { db.close(); }
});

test('启停显式可见，历史不追扣，停用后在途执行仍按原倍率结算', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const calls = new AgentBudgets(db), points = new TokenPoints(db);
    const project = { kind: 'project', subject: 'store' } as const;
    const pool = { kind: 'execution', subject: 'store' } as const;
    const charge = (run: number) => calls.reserve({ ...pool, run, attempt: 1, project: 'store', owner: 'member', agent: 'codex' });
    const policy = { enabled: true, tokensPerPoint: 1000, rates: [{ provider: 'openai', model: 'fast', multiplier: 0.5, reserveTokens: 1000 }] };
    assert.equal(points.status().enabled, false);
    charge(1);
    points.reserve(1, 1, points.quote('openai', 'fast'));
    points.setPolicy(policy);
    points.settle(1, 1, 'codex', { input: 1000, output: 1000 });
    assert.equal(points.receipts('store').length, 0, '未启用时产生的历史执行不追扣');
    assert.match(points.admit([project], undefined, true)!, /未配置/, '启用后未知倍率不能通过无限额池绕过记账');
    points.setLimit({ ...project, period: 'day', limit: 0.5 });
    charge(2); points.reserve(2, 1, points.quote('openai', 'fast'));
    points.setPolicy({ ...policy, enabled: false });
    points.setPolicy({ tokensPerPoint: policy.tokensPerPoint, rates: policy.rates });
    assert.equal(points.status().enabled, false, '旧客户端只改倍率不能无意中重新启用');
    assert.equal(points.view(project).enforced, false);
    assert.equal(points.quote('openai', 'fast'), undefined);
    assert.equal(points.admit([project], undefined, true), undefined);
    points.settle(2, 1, 'codex', { input: 1500, output: 500 });
    assert.equal(points.receipts('store')[0]!.charged, 1);
    assert.equal(points.receipts('store')[0]!.overReservation, 0.5);
    points.setPolicy(policy);
    assert.equal(points.view(project).blocked, true);
    assert.equal(points.view(project).overLimit, 0.5);
  } finally { db.close(); }
});

test('超预留如实扣账，各池和换端共享项目上限，重复回执与并发预留不重扣', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const calls = new AgentBudgets(db), points = new TokenPoints(db);
    const project = { kind: 'project', subject: 'store' } as const;
    const kinds = [ { kind: 'platform', subject: 'platform' }, { kind: 'personal', subject: 'member' },
      { kind: 'execution', subject: 'store' } ] as const;
    points.setPolicy({ enabled: true, tokensPerPoint: 1000, rates: [
      { provider: 'openai', model: 'fast', multiplier: 1, reserveTokens: 1000 },
      { provider: 'other', model: 'cheap', multiplier: 0.1, reserveTokens: 1000 },
    ] });
    points.setLimit({ ...project, period: 'day', limit: 2 });
    for (const pool of kinds) points.setLimit({ ...pool, period: 'day', limit: 10 });
    const quote = points.quote('openai', 'fast')!;
    db.exec('BEGIN IMMEDIATE');
    assert.equal(points.admit([project, kinds[2]], quote, true), undefined);
    calls.reserve({ ...kinds[2], run: 1, attempt: 1, project: 'store', owner: 'member', agent: 'codex' });
    points.reserve(1, 1, quote); points.reserve(1, 1, quote);
    db.exec('COMMIT');
    assert.equal(points.view(project).reserved, 1);
    assert.equal(points.admit([project], { ...quote, reserved: 2000 }, true)?.includes('不足'), true);
    for (let n = 0; n < 3; n++) points.settle(1, 1, 'codex', { input: 2500, output: 500 });
    assert.equal(points.receipts('store').length, 1);
    assert.equal(points.view(project).used, 3);
    assert.equal(points.view(project).overLimit, 1);
    assert.equal(points.view(kinds[2]).used, 3);
    assert.equal(points.view(kinds[0]).used, 0);
    assert.equal(points.view(kinds[1]).used, 0);
    for (const pool of kinds) assert.match(points.admit([project, pool], points.quote('other', 'cheap'), true)!, /项目总积分/);
    assert.equal(points.view({ kind: 'project', subject: 'child' }).used, 0);
    points.setLimit({ ...project, period: 'day', limit: 5 });
    assert.equal(points.admit([project, kinds[1]], quote, true), undefined, '只由有权限的预算配置补额后恢复');
  } finally { db.close(); }
});
