// 任务时间线：审计事件 → 人 / Agent / 系统 三类时间线。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskTimeline } from '../src/task-timeline.ts';

test('审计事件翻译成人话，并归到人 / Agent / 系统三类', () => {
  const entries = buildTaskTimeline({
    audit: [
      { at: '2026-11-09T10:34:36Z', action: 'task.created', value: '{}' },
      { at: '2026-11-09T10:34:36Z', action: 'routing.decision', value: '{"outcome":"committed"}' },
      { at: '2026-11-09T10:39:24Z', action: 'loop.downstream', value: '{}' },
      { at: '2026-11-09T11:16:58Z', action: 'loop.upstream', value: '{}' },
      { at: '2026-11-09T11:22:31Z', action: 'subscription.released', value: '{"reason":"任务已验收"}' },
    ],
    request: '写一个反转字符串的函数',
  });
  const labels = entries.map(e => e.label);
  assert.ok(labels.includes('任务创建'));
  assert.ok(labels.includes('派活决策'));
  assert.ok(labels.includes('发来消息'));
  assert.ok(labels.includes('回执 / 进度'));
  assert.ok(labels.includes('验收完成'));

  // 归类：下行是人，上行是 Agent，其余是系统
  const byLabel = Object.fromEntries(entries.map(e => [e.label, e.kind]));
  assert.equal(byLabel['发来消息'], 'human');
  assert.equal(byLabel['回执 / 进度'], 'agent');
  assert.equal(byLabel['任务创建'], 'system');

  // 初始请求垫底、归人
  const last = entries.at(-1)!;
  assert.equal(last.label, '发起请求');
  assert.equal(last.kind, 'human');
  assert.equal(last.detail, '写一个反转字符串的函数');
});

test('派活决策的 detail 翻译 outcome', () => {
  const entries = buildTaskTimeline({
    audit: [{ at: '', action: 'routing.decision', value: '{"outcome":"committed"}' }],
  });
  assert.match(entries[0]!.detail, /已派单/);
});

test('交付信息置顶为 Agent 条目，含 CI 与合并状态', () => {
  const entries = buildTaskTimeline({
    audit: [],
    delivery: { pr: 4, ci: 'passed', merged: false, previewUrl: 'http://x/preview' },
  });
  assert.equal(entries[0]!.kind, 'agent');
  assert.equal(entries[0]!.label, '交付');
  assert.match(entries[0]!.detail, /PR #4/);
  assert.match(entries[0]!.detail, /CI 通过/);
  assert.match(entries[0]!.detail, /未合并/);
});
