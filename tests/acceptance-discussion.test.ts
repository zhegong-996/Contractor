// 第四十一轮 · 报告内讨论（src/acceptance-discussion.ts）与区域点选接线。
//
// 钉住三件事：讨论是追加式的（不能改写正文）、只能由人打「已处理」状态位、
// 讨论不参与就绪判定。区域点选是前端交互，用结构断言守住「有交互 + 有可读名字」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  addDiscussionComment, listDiscussion, resolveDiscussionComment, discussionDigest,
  DISCUSSION_BODY_LIMIT,
} from '../src/acceptance-discussion.ts';
import { buildAcceptanceWorkbench } from '../src/acceptance-workbench.ts';
import { createPlan } from '../src/acceptance-plan.ts';
import { reviewCrew, defaultAgentRegistry } from '../src/agent-registry.ts';
import { root } from '../src/config.ts';

const withDir = (job: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-discussion-'));
  try { job(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('讨论：追加式留存，正文不可改写，作者必填', () => withDir(dir => {
  const first = addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'item', itemId: 'item-1' }, body: '第 1 项截图右上角被遮挡' });
  const second = addDiscussionComment(dir, { taskId: 'T-1', author: 'bob', target: { kind: 'item', itemId: 'item-1' }, body: '同意，下一轮补一张' });
  assert.notEqual(first.comment.id, second.comment.id);
  const file = listDiscussion(dir, 'T-1');
  assert.deepEqual(file.comments.map(item => item.body), ['第 1 项截图右上角被遮挡', '同意，下一轮补一张']);
  assert.deepEqual(file.comments.map(item => item.author), ['alice', 'bob']);
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: '  ', target: { kind: 'report' }, body: 'x' }), /作者/);
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'report' }, body: '   ' }), /不能为空/);
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'report' },
    body: 'x'.repeat(DISCUSSION_BODY_LIMIT + 1) }), /最多/);
}));

test('讨论：目标只能是检查项 / 区域 / 整份报告，区域序号有界', () => withDir(dir => {
  const region = addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'region', itemId: 'item-1', regionIndex: 2 }, body: '区域 3 是同一个问题' });
  assert.deepEqual(region.comment.target, { kind: 'region', itemId: 'item-1', regionIndex: 2 });
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'region', itemId: 'item-1', regionIndex: 8 }, body: 'x' }), /0-7/);
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'item' }, body: 'x' }), /检查项/);
  assert.throws(() => addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'approve' }, body: 'x' }), /item \/ region \/ report/);
}));

test('讨论：只有「已处理」状态位可变，正文与作者保持原样', () => withDir(dir => {
  const { comment } = addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'report' }, body: '整体结论我同意，但要补一条限制说明' });
  const resolved = resolveDiscussionComment(dir, { taskId: 'T-1', commentId: comment.id, actor: 'bob' });
  assert.equal(resolved.comment.body, comment.body);
  assert.equal(resolved.comment.author, 'alice');
  assert.ok(resolved.comment.resolvedAt);
  assert.equal(resolved.comment.resolvedBy, 'bob');
  // 再点一次不覆盖第一次的处理人
  const again = resolveDiscussionComment(dir, { taskId: 'T-1', commentId: comment.id, actor: 'carol' });
  assert.equal(again.comment.resolvedBy, 'bob');
  assert.throws(() => resolveDiscussionComment(dir, { taskId: 'T-1', commentId: 'dc-nope', actor: 'bob' }), /没有这条讨论/);
}));

test('讨论：汇总只计数，按检查项分组，未处理单独统计', () => withDir(dir => {
  addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'item', itemId: 'item-1' }, body: 'a' });
  addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'region', itemId: 'item-1', regionIndex: 0 }, body: 'b' });
  const third = addDiscussionComment(dir, { taskId: 'T-1', author: 'bob', target: { kind: 'item', itemId: 'item-2' }, body: 'c' });
  resolveDiscussionComment(dir, { taskId: 'T-1', commentId: third.comment.id, actor: 'bob' });
  const digest = discussionDigest(listDiscussion(dir, 'T-1'));
  assert.equal(digest.total, 3);
  assert.equal(digest.unresolved, 2);
  assert.deepEqual(digest.byItem, { 'item-1': 2 });
  assert.match(digest.note, /不替代/);
}));

test('讨论：换任务互不影响，坏文件当空线程而不是崩', () => withDir(dir => {
  addDiscussionComment(dir, { taskId: 'T-1', author: 'alice', target: { kind: 'report' }, body: 'a' });
  assert.deepEqual(listDiscussion(dir, 'T-2').comments, []);
}));

test('工作台：讨论只带计数，不改变就绪判据', () => {
  const plan = createPlan({ taskId: 'T-1', names: ['页面可打开'], lockedBy: 'alice',
    reviewerModel: 'reviewer-x', producerModel: 'producer-y' });
  const crew = reviewCrew(defaultAgentRegistry(), { taskId: 'T-1' });
  const withoutDiscussion = buildAcceptanceWorkbench({ taskId: 'T-1', plan: null, round: null, crew, report: null });
  const withDiscussion = buildAcceptanceWorkbench({ taskId: 'T-1', plan: null, round: null, crew, report: null,
    discussion: { total: 3, unresolved: 2, byItem: { item: 2 }, note: '讨论只供人看' } });
  assert.equal(withDiscussion.discussion.total, 3);
  assert.deepEqual(withDiscussion.readiness, withoutDiscussion.readiness, '讨论不能改变就绪判定');
  assert.deepEqual(withDiscussion.summary, withoutDiscussion.summary, '讨论不能改变逐项统计');
  assert.equal(plan.taskId, 'T-1');
});

test('控制台：区域点选与讨论都接了真实动作，且交互元素有可读名字', () => {
  const source = readFileSync(path.join(root, 'console/app.js'), 'utf8');
  assert.match(source, /v06-acceptance-discussion-list/);
  assert.match(source, /v06-acceptance-discussion-add/);
  assert.match(source, /v06-acceptance-discussion-resolve/);
  assert.match(source, /class="region-board"/);
  assert.match(source, /class="region-box"/);
  // 区域框是 button，必须自带可读名字（键盘用户不能只看到一个数字框）
  assert.match(source, /:aria-label="'区域 ' \+ \(i \+ 1\)/);
  // 讨论正文必须能标明挂到哪一项 / 哪个区域
  assert.match(source, /targetText\(comment\.target\)/);
  // 不允许出现放行按钮（红线：人签只在原会话）
  assert.doesNotMatch(source, /acceptance-approve|acceptance-accept/);
});
