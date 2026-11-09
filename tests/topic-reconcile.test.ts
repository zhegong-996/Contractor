// 回群对账 + 主题聚合的契约：
// 对账只报不改、没产物不冒充通过；主题只聚合有责任人的东西、一个任务只属一个主题。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reconcile, isReconcileRequest } from '../src/reconcile.ts';
import { attachChannel, attachTask, createTopic, listTopics, readTopic, topicDigest } from '../src/topic.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'topic-'));

test('清单与报告逐项对上时，结论才说「对上」，并照样声明没有改动', () => {
  const result = reconcile({
    declared: [{ id: 'E1', name: '能导出', required: true }, { id: 'E2', name: '能回滚', required: true }],
    produced: [{ id: 'E1', status: 'pass' }, { id: 'E2', status: 'pass' }],
    artifact: { ref: 'report.json', revision: 3 },
  });
  assert.equal(result.comparable, true);
  assert.equal(result.findings.length, 0);
  assert.match(result.conclusion, /对上/);
  assert.match(result.card, /修订 3/);
  assert.match(result.card, /没有改动/);
});

test('四类差异分别报：漏验、清单外、未通过、未出结论', () => {
  const result = reconcile({
    declared: [
      { id: 'E1', name: '能导出', required: true },
      { id: 'E2', name: '能回滚', required: true },
      { id: 'E3', name: '能撤销', required: true },
    ],
    produced: [
      { id: 'E1', status: 'fail' },
      { id: 'E2', status: 'pending' },
      { id: 'X9', name: '顺手改了文案', status: 'pass' },
    ],
  });
  assert.deepEqual(result.counts, { missing: 1, extra: 1, unpassed: 1, pending: 1 });
  const kinds = result.findings.map(f => `${f.kind}:${f.id}`).sort();
  assert.deepEqual(kinds, ['extra:X9', 'missing:E3', 'pending:E2', 'unpassed:E1']);
});

test('可选项没通过不报，但漏验照样要报出来', () => {
  const result = reconcile({
    declared: [
      { id: 'E1', name: '必做', required: true },
      { id: 'E2', name: '可选', required: false },
    ],
    produced: [{ id: 'E1', status: 'pass' }, { id: 'E2', status: 'fail' }],
  });
  assert.equal(result.findings.length, 0);

  const missing = reconcile({
    declared: [{ id: 'E2', name: '可选', required: false }],
    produced: [],
  });
  assert.equal(missing.counts.missing, 1);
  assert.match(missing.findings[0]!.detail, /可选/);
});

test('没有产物时不能说「核对通过」——没得比和比过是两件事', () => {
  const result = reconcile({ declared: [{ id: 'E1', name: '能导出', required: true }], produced: null });
  assert.equal(result.comparable, false);
  assert.equal(result.findings.length, 0);
  assert.match(result.conclusion, /不是核对通过/);
  assert.equal(result.card, '');
});

test('只把「对一下」认成对账，改清单不算', () => {
  for (const text of ['表更新过了，和待办对一下', '你核对一下清单', '帮我对账', '报告改了，跟清单比一下'])
    assert.equal(isReconcileRequest(text), true, text);
  for (const text of ['把验收清单改一下，少两项', '帮我把清单加一项', '这个任务继续做'])
    assert.equal(isReconcileRequest(text), false, text);
});

test('主题必须有负责人和目标，否则不进聚合', () => {
  const base = dir();
  assert.throws(() => createTopic({ title: '闭门会筹备', goal: '', ownerUserId: 'ou_a' }, base), /目标不能为空/);
  assert.throws(() => createTopic({ title: '闭门会筹备', goal: '把活动办完', ownerUserId: '' }, base), /负责人不能为空/);
  assert.throws(() => createTopic({ title: '', goal: '把活动办完', ownerUserId: 'ou_a' }, base), /标题不能为空/);
});

test('入口和任务都要挂到人；同一入口重复挂是幂等的', () => {
  const base = dir();
  const topic = createTopic({ title: '闭门会筹备', goal: '把活动办完', ownerUserId: 'ou_a' }, base);
  assert.throws(() => attachChannel({ topicId: topic.id, kind: 'im', ref: 'oc_1', ownerUserId: '' }, base),
    /负责人不能为空/);
  const once = attachChannel({ topicId: topic.id, kind: 'im', ref: 'oc_1', ownerUserId: 'ou_a' }, base);
  const twice = attachChannel({ topicId: topic.id, kind: 'im', ref: 'oc_1', ownerUserId: 'ou_a' }, base);
  assert.equal(once.channels.length, 1);
  assert.equal(twice.channels.length, 1);
  // 主题文件含真实标识，只给本人读写。
  assert.equal(statSync(path.join(base, `${topic.id}.json`)).mode & 0o777, 0o600);
});

test('一个任务只能属于一个主题，重复挂要说清已经挂在哪儿', () => {
  const base = dir();
  const a = createTopic({ title: 'A', goal: 'ga', ownerUserId: 'ou_a' }, base);
  const b = createTopic({ title: 'B', goal: 'gb', ownerUserId: 'ou_b' }, base);
  attachTask({ topicId: a.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a' }, base);
  assert.throws(() => attachTask({ topicId: b.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_b' }, base),
    /已属于主题 .*「A」/);
  const again = attachTask({ topicId: a.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a' }, base);
  assert.equal(again.tasks.length, 1);
});

test('主题摘要只陈述现状：几入口、几任务、几个卡点', () => {
  const base = dir();
  const topic = createTopic({ title: '闭门会筹备', goal: '把活动办完', ownerUserId: 'ou_a' }, base);
  attachChannel({ topicId: topic.id, kind: 'im', ref: 'oc_1', ownerUserId: 'ou_a' }, base);
  attachChannel({ topicId: topic.id, kind: 'board', ref: 'bd_1', ownerUserId: 'ou_a' }, base);
  attachTask({ topicId: topic.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a' }, base);
  attachTask({ topicId: topic.id, taskId: 't2', roleId: 'role-product', ownerUserId: 'ou_b' }, base);
  const digest = topicDigest(readTopic(topic.id, base), {
    t1: { state: 'accepted' },
    t2: { state: 'blocked', blockedReason: '等物料规格' },
  });
  assert.equal(digest.channels, 2);
  assert.equal(digest.tasks, 2);
  assert.deepEqual(digest.byState, { accepted: 1, blocked: 1 });
  assert.deepEqual(digest.blocked, [{ taskId: 't2', reason: '等物料规格' }]);
  assert.match(digest.summary, /2 个入口 \/ 2 个任务/);
  assert.match(digest.summary, /1 个卡点/);

  const empty = createTopic({ title: '空主题', goal: '还没挂东西', ownerUserId: 'ou_a' }, base);
  assert.match(topicDigest(readTopic(empty.id, base)).summary, /还没有任务/);
  assert.equal(listTopics(base).length, 2);
});
