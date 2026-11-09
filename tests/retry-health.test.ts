// 第三十八轮 · 出站重试健康（src/retry-health.ts）。
//
// 口径是本模块最容易被误读的地方，所以测试先把话说死：
//   pending ≠ 失败（飞书不可达时故意堆积等恢复）；local_only 是有意的；
//   suppressed 是注意力预算裁掉过程通知，人类必达消息不裁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { buildRetryHealth, readRetryHealth } from '../src/retry-health.ts';

const now = new Date('2026-11-09T10:00:00+08:00');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

test('全部送达就是健康，待投递为 0 时不给最久等待', () => {
  const health = buildRetryHealth({ rows: [
    { id: 'a', issueId: 't1', state: 'sent' }, { id: 'b', issueId: 't1', state: 'mirrored' },
  ], failures: [], now });
  assert.equal(health.verdict, 'healthy');
  assert.equal(health.total, 2);
  assert.equal(health.pending.count, 0);
  assert.equal(health.pending.oldestMinutes, null);
  assert.deepEqual(health.states.map(cell => cell.label).sort(), ['已送达', '已镜像到他路'].sort());
});

test('待投递超阈值算积压，并列出最久的那几条', () => {
  const health = buildRetryHealth({ rows: [
    { id: 'x1', issueId: 't1', state: 'pending', at: minutesAgo(40) },
    { id: 'x2', issueId: 't2', state: 'pending', at: minutesAgo(2) },
  ], failures: [], now, stuckThresholdMinutes: 15 });
  assert.equal(health.verdict, 'backlog');
  assert.equal(health.pending.count, 2);
  assert.equal(health.pending.oldestMinutes, 40);
  assert.deepEqual(health.pending.stuck.map(item => item.id), ['x1']);
  assert.ok(health.notes.some(note => note.includes('确认通道是否可达，不要直接清队列')));
});

test('有失败且仍有待投递判为 failing，并给出通道级计数', () => {
  const health = buildRetryHealth({ rows: [{ id: 'y1', issueId: 't1', state: 'pending', at: minutesAgo(3) }],
    failures: [{ channel: 'dingtalk', at: minutesAgo(5) }, { channel: 'dingtalk', at: minutesAgo(90) }, { channel: 'wecom', at: minutesAgo(1) }],
    now });
  assert.equal(health.verdict, 'failing');
  assert.deepEqual(health.failures.map(cell => [cell.channel, cell.count]), [['dingtalk', 2], ['wecom', 1]]);
  assert.ok(health.notes[0]!.includes('最近 24 小时有投递失败'));
});

test('窗口外的失败不计入；没有 at 的旧行不猜时长', () => {
  const health = buildRetryHealth({ rows: [{ id: 'z1', issueId: 't1', state: 'pending' }],
    failures: [{ channel: 'wecom', at: minutesAgo(60 * 30) }], now, failureWindowHours: 24 });
  assert.deepEqual(health.failures, []);
  assert.equal(health.pending.count, 1);
  assert.equal(health.pending.oldestMinutes, null, '没有 at 就不能编一个时长出来');
  assert.equal(health.verdict, 'healthy');
});

test('三条口径说明始终在，避免把 pending 读成故障', () => {
  const health = buildRetryHealth({ rows: [], failures: [], now });
  assert.ok(health.notes.some(note => note.includes('待投递不等于失败')));
  assert.ok(health.notes.some(note => note.includes('仅本机是有意的')));
  assert.ok(health.notes.some(note => note.includes('永远不裁')));
});

test('从库里读：notify 写出 at，失败审计按通道汇总', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-retry-'));
  try {
    const store = new Store(path.join(dir, 'state.sqlite'));
    store.notify('n1', 'task-1', '第一条通知');
    store.notify('n1', 'task-1', '重复通知不会插两条');
    store.audit('im-outbound.failed', 'task-1', { channel: 'dingtalk', notificationId: 'n1' });
    const health = readRetryHealth(store, { now: new Date() });
    assert.equal(health.total, 1);
    assert.equal(health.pending.count, 1);
    assert.equal(health.pending.oldestMinutes, 0);
    assert.deepEqual(health.failures.map(cell => cell.channel), ['dingtalk']);
    assert.equal(health.verdict, 'failing');
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
