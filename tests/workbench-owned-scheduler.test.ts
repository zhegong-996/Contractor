import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codexAttemptUsage } from '../src/workbench/execution/cli.ts';
import { openScheduler, type ExecutionRule } from '../src/workbench/execution/scheduler.ts';

const assignment: ExecutionRule = {
  source: 'contractor', type: 'assigned.review',
  agent: { id: 'review', name: '核对小屏验收', use: 'command', access: 'read' },
  rule: { name: '项目核对', cwd: '/' },
};
const task = (id: string) => ({ id, type: assignment.type, subject: 'store-1', summary: '门店推荐理由', detail: '核对小屏验收条件' });

test('自研调度器重启后只恢复原租约，断线不释放，停止回执幂等', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contractor-scheduler-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'dispatch.sqlite');
  let time = Date.parse('2026-11-19T03:50:00Z');
  const start = () => openScheduler(db, [assignment], () => time).hub;
  let hub = start();
  t.after(() => hub.close());
  assert.deepEqual(hub.ingest(assignment.source, task('message-1')).routed, [assignment.rule.name]);
  const first = hub.claimNext('first-node', 'first-request')!;
  assert.ok(first);
  assert.deepEqual(hub.claimNext('first-node', 'first-request'), first);
  hub.ingest(assignment.source, task('message-1'));
  assert.equal(hub.runs('store-1').length, 1);
  hub.ingest(assignment.source, task('message-2'));
  hub.close();
  hub = start();
  time += 121_000;
  hub.tick();
  assert.equal(hub.run(first.run)?.state, 'unknown');
  assert.equal(hub.claimNext('second-node', 'second-request'), null);
  hub.heartbeat('second-node', [first.run]);
  assert.equal(hub.run(first.run)?.state, 'unknown');
  hub.heartbeat('first-node', [first.run]);
  assert.deepEqual(hub.claimNext('first-node', 'first-request'), first);
  hub.cancel(first.run);
  assert.deepEqual(hub.cancels('first-node'), [first.run]);
  assert.equal(hub.claimNext('second-node', 'second-request'), null);
  assert.throws(() => hub.finish(first.run, 'wrong-token', { outcome: 'cancelled' }), /租约/);
  assert.throws(() => hub.finish(first.run, first.token, { outcome: 'done' }), /正在停止/);
  const stopped = { outcome: 'cancelled', usage: { input: 31, output: 2 } } as const;
  assert.deepEqual(hub.finish(first.run, first.token, stopped), { rejected: [] });
  assert.deepEqual(hub.finish(first.run, first.token, stopped), { rejected: [] });
  assert.deepEqual(JSON.parse(hub.run(first.run)!.usage!), stopped.usage);
  assert.throws(() => hub.finish(first.run, first.token, { ...stopped, usage: { input: 32 } }), /不同内容/);
  const second = hub.claimNext('second-node', 'second-request')!;
  assert.notEqual(second.run, first.run);
  assert.deepEqual(second.context.events.map(event => event.id), ['message-2']);
  assert.equal(hub.claimNext('second-node', 'other-request'), null);
});

test('独立账本重启后群整理只补最新周期', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contractor-schedule-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-11-19T02:00:00Z');
  const rule = { ...assignment, cron: '0 0,12 * * *', agent: { ...assignment.agent, id: 'store-digest' },
    rule: { ...assignment.rule, name: '门店反馈整理' } };
  const start = () => openScheduler(path.join(dir, 'dispatch.sqlite'), [rule], () => time).hub;
  let hub = start();
  t.after(() => hub.close());
  assert.equal(hub.nextSchedule(rule.rule.name), '2026-11-19T04:00:00.000Z');
  hub.close();
  time = Date.parse('2026-11-20T07:00:00Z');
  hub = start();
  hub.tick();
  hub.tick();
  const run = hub.claimNext('summarizer', 'digest')!;
  assert.equal(run.context.events.length, 1);
  assert.equal(run.context.events[0]?.type, 'schedule.tick');
  assert.match(run.context.events[0]!.id, /2026-11-20T04:00:00.000Z$/);
  hub.finish(run.run, run.token, { outcome: 'nothing' });
  assert.equal(hub.claimNext('summarizer', 'later'), null);
  assert.equal(hub.nextSchedule(rule.rule.name), '2026-11-20T16:00:00.000Z');
});


test('同一 Codex 会话继续执行时只结算相对启动基线的增量', () => {
  const baseline = { input: 24687, output: 363, cached: 12032 };
  const sessionUsage = { input: 83119, output: 1690, cached: 62976 };
  const reading = { session: 'codex-thread', sessionUsage };
  assert.deepEqual(codexAttemptUsage(reading, null), sessionUsage);
  assert.deepEqual(codexAttemptUsage(reading, reading.session, baseline), { input: 58432, output: 1327, cached: 50944 });
  assert.equal(codexAttemptUsage(reading, reading.session), undefined);
  assert.deepEqual(codexAttemptUsage(reading, reading.session, { ...baseline, cached: 100_000 }), { input: 58432, output: 1327 });
});
