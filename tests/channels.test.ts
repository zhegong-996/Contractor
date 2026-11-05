// The channel layer exists so v0.6 objects can live in the CURRENT product
// shape: IM conversation in, plain text + workbench link out. Degradation
// must never silently drop a responsibility or acceptance field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feishuAdapter, defaultRegistry, renderForChannel, workspaceEnvelope,
  endpointCapabilities, PLAIN_TEXT, type ChannelContext, type SemanticObject,
} from '../src/channels.ts';

const ctx: ChannelContext = { botId: 'bot-1', appId: 'app-1', workbenchUrl: 'http://127.0.0.1:3100' };
const url = ctx.workbenchUrl;

const feishuEvent = {
  message_id: 'om_abc', chat_id: 'oc_group', chat_type: 'group',
  sender_id: 'ou_user', sender_type: 'user',
  content: '请 @_user_1 做客户方案', create_time: '1730000000000',
  mentions: [{ id: 'bot-1', key: '@_user_1', name: '协作助手' }],
};

test('the existing Feishu trigger maps to a channel-independent envelope', () => {
  const envelope = feishuAdapter.normalize(feishuEvent, ctx);
  assert.ok(envelope);
  assert.equal(envelope.channel, 'feishu');
  assert.equal(envelope.actorId, 'ou_user');
  assert.equal(envelope.chatId, 'oc_group');
  assert.equal(envelope.messageId, 'om_abc');
  assert.equal(envelope.human, true);
  assert.equal(envelope.addressed, true);
  assert.equal(envelope.direct, false);
  assert.equal(envelope.threadId, 'oc_group:om_abc');
  assert.match(envelope.text, /@协作助手/);
  assert.ok(envelope.triggerId.length > 0);
});

test('bot messages and non-Feishu payloads are ignored without throwing', () => {
  assert.equal(feishuAdapter.normalize({ ...feishuEvent, sender_id: 'bot-1' }, ctx), undefined);
  assert.equal(feishuAdapter.normalize({}, ctx), undefined);
  assert.equal(feishuAdapter.normalize('not an event', ctx), undefined);
  const registry = defaultRegistry();
  assert.equal(registry.normalize(feishuEvent, ctx)?.adapter.id, 'feishu');
  assert.equal(registry.normalize({}, ctx), undefined);
  assert.deepEqual(registry.list().map(a => a.id), ['feishu']);
});

test('a Transfer card degraded to Feishu text keeps every responsibility field', () => {
  const transfer: SemanticObject = {
    kind: 'transfer-card', taskId: 'task-1', identifier: 'SUI-42',
    grantor: '产品职能 owner', grantee: '开发小李', capability: '参与过 3 次需求评审',
    scope: '仅本 Task', standardOwner: '产品 Role Agent', counterSigner: '产品职能 owner',
  };
  const rendered = renderForChannel(transfer, { capabilities: feishuAdapter.capabilities, workbenchUrl: url });
  assert.equal(rendered.degraded, true);
  assert.equal(rendered.card, undefined);
  for (const field of ['授权人：产品职能 owner', '承接人：开发小李', '能力依据：参与过 3 次需求评审',
    '授权范围：仅本 Task', '验收标准起草方：产品 Role Agent', '联签人：产品职能 owner', '有效期']) {
    assert.ok(rendered.text.includes(field), `降级文本缺少字段：${field}`);
  }
  assert.match(rendered.link, /\/SUI\/knowledge-workspaces$/);
  assert.ok(rendered.text.includes(rendered.link));
});

test('a card-capable channel gets the same object as structured data', () => {
  const obj: SemanticObject = { kind: 'context-grant', taskId: 'task-1', space: '客户域',
    granularity: '指定片段', approver: '目标空间 owner', readonly: true };
  const rich = renderForChannel(obj, { capabilities: endpointCapabilities.a2a, workbenchUrl: url });
  assert.equal(rich.degraded, false);
  assert.equal((rich.card as any)?.data.granularity, '指定片段');
  assert.ok(rich.text.includes('审批人：目标空间 owner'));
  // capability changes presentation only, never the content
  const plain = renderForChannel(obj, { capabilities: PLAIN_TEXT, workbenchUrl: url });
  assert.equal(plain.text, rich.text);
});

test('acceptance report states only the failed items are returned; signals never rank people', () => {
  const report = renderForChannel({ kind: 'acceptance-report', taskId: 'task-1', round: 2, level: 'L4',
    reviewer: 'independent-reviewer', passed: 3, failed: ['报价版本', '客户可见文案'] },
  { capabilities: feishuAdapter.capabilities, workbenchUrl: url });
  assert.match(report.text, /未通过（只退这些项）：报价版本、客户可见文案/);
  assert.match(report.text, /签字人仍是任务发起人/);

  const signal = renderForChannel({ kind: 'organization-signal', metric: '跨职能派单占比',
    value: '32%', hint: '检查产品职能是否缺人' },
  { capabilities: feishuAdapter.capabilities, workbenchUrl: url });
  assert.match(signal.text, /仅提示，不拦截任务、不做人员排名与考核/);
});

test('the local workbench is an endpoint envelope, not a fake IM message', () => {
  const envelope = workspaceEnvelope({ requestKey: 'req-1', text: '写方案' });
  assert.equal(envelope.channel, 'workspace');
  assert.equal(envelope.triggerId, 'req-1');
  assert.equal(envelope.chatId, 'local-workspace');
  assert.equal(envelope.addressed, true);
  assert.deepEqual(endpointCapabilities.cli, PLAIN_TEXT);
});
