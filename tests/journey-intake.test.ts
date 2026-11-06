// Real-journey regressions: the acceptance items declared in a Feishu message
// must survive into the sealed plan, and the independent review must be
// triggerable from the running instance without changing who signs off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { businessAcceptanceFrom } from '../src/controller.ts';
import { planForTask } from '../src/acceptance-plan.ts';
import { expectedTokens } from '../src/vision-semantics.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('飞书消息中的「。验收：」必须进入锁定清单，不再静默退化成通用项', () => {
  const text = '/task [role-growth] 【联调】跨岗位真实一单：增长整理销售反馈后交产研形成方案。验收：页面可见验收与责任；期望文本：验收与责任';
  assert.deepEqual(businessAcceptanceFrom(text), ['页面可见验收与责任', '期望文本：验收与责任']);
  assert.deepEqual(businessAcceptanceFrom('验收：A；B'), ['A', 'B']);
  assert.deepEqual(businessAcceptanceFrom('验收: A; B'), ['A', 'B']);
  assert.deepEqual(businessAcceptanceFrom('没有验收声明的任务'), ['符合任务要求']);
  const plan = planForTask({ id: 'T-1', context: JSON.stringify({ businessAcceptance: businessAcceptanceFrom(text) }) },
    'ou-owner', { reviewerModel: 'local-vision:apple-vision-local', producerModel: 'producer' });
  assert.deepEqual(plan.items.map(i => i.name), ['页面可见验收与责任', '期望文本：验收与责任']);
  // The second item declares the exact on-screen text the vision model must see.
  assert.deepEqual(expectedTokens(plan.items[1]!).explicit, ['验收与责任']);
});

test('独立评审可在运行实例上触发，但只写证据报告，最终核可仍是 /accept', () => {
  const server = read('src/server.ts');
  const cli = read('src/cli.ts');
  assert.match(server, /reconcile\|review\|trace\|knowledge-propose/);
  assert.match(server, /if \(action === 'review'\)/);
  assert.match(server, /control\.runIndependentReview\(task\.id, artifacts\)/);
  assert.match(server, /独立评审只由本地 owner 触发/);
  assert.match(cli, /action === 'review'/);
  // No new approval path: /accept still owns the final decision.
  assert.doesNotMatch(server, /action === 'review'[\s\S]{0,600}phase = 'accepted'/);
});

test('捕获事件只能由可信执行端写入，taskId 取自 URL，字段不完整则拒绝', () => {
  const server = read('src/server.ts');
  const cli = read('src/cli.ts');
  assert.match(server, /reconcile\|review\|trace\|knowledge-propose/);
  assert.match(server, /if \(action === 'trace'\)/);
  assert.match(server, /capture\(\{ \.\.\.\(data\.event \?\? data\), taskId: task\.id \}\)/);
  assert.match(server, /事件字段不完整，未写入过程流水/);
  assert.match(cli, /action === 'trace'/);
});
