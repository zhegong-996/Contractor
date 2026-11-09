// 第三十九轮 · 通道体检（src/channel-health.ts）。
// 口径红线：只读配置与本地台账、不发外部请求；partial 不是失败，也不粉饰成 ready；
// 真实工单证据只从台账取，没有就写没有（不用模拟任务充数）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelHealth } from '../src/channel-health.ts';

const base = {
  feishu: { enabled: true, state: 'ready' as const, appId: 'cli_x', allowedSenders: 1, allowedChats: 1 },
  github: { enabled: true, repository: 'o/r', tokenConfigured: true, webhookSecretConfigured: true },
  im: { dingtalkConfigured: false, wecomConfigured: false },
  inbox: { enabled: true, claimed: ['gitlab'], pending: 2, mirrored: 0 },
  realStories: { total: 5, lastAt: '2026-11-09T10:20:00+08:00', lastIdentifier: 'SUI-129' },
};
const at = new Date('2026-11-09T11:00:00+08:00');
const pick = (report: ReturnType<typeof buildChannelHealth>, id: string) => report.checks.find(check => check.id === id)!;

test('全绿时判 ready，未配置的通道标 off 而不是算故障', () => {
  const report = buildChannelHealth(base, at);
  assert.equal(report.verdict, 'ready');
  assert.equal(pick(report, 'feishu').verdict, 'ready');
  assert.equal(pick(report, 'github').verdict, 'ready');
  // 钉钉/企微按需开启：没配是 off，不能因此把整体判成 degraded。
  assert.equal(pick(report, 'im').verdict, 'off');
  assert.equal(report.summary.off, 1);
  assert.match(report.note, /未配置的通道标 off/);
});

test('飞书能连但白名单为空 → partial，并给出「加人」这一条动作', () => {
  const report = buildChannelHealth({ ...base, feishu: { ...base.feishu, allowedSenders: 0, allowedChats: 0 } }, at);
  const feishu = pick(report, 'feishu');
  assert.equal(feishu.verdict, 'partial');
  assert.ok(feishu.missing.some(item => item.includes('白名单为空')));
  assert.match(feishu.next, /allowedSenders|allowedChats/);
  // 同一份体检里其他通道不该被误伤。
  assert.equal(pick(report, 'github').verdict, 'ready');
  assert.equal(report.verdict, 'degraded');
});

test('机器人身份没通过校验 → blocked，且整体判 blocked', () => {
  const report = buildChannelHealth({ ...base, feishu: { ...base.feishu, state: 'disconnected' as const } }, at);
  assert.equal(pick(report, 'feishu').verdict, 'blocked');
  assert.equal(report.verdict, 'blocked');
  assert.match(pick(report, 'feishu').next, /授权|日志/);
});

test('刚启动还在 connecting → partial 且说明「刚启动时正常」，不误判成断开', () => {
  const report = buildChannelHealth({ ...base, feishu: { ...base.feishu, state: 'connecting' as const } }, at);
  const feishu = pick(report, 'feishu');
  assert.equal(feishu.verdict, 'partial');
  assert.ok(feishu.missing.some(item => item.includes('还在建立')));
  assert.match(feishu.next, /稍等/);
});

test('GitHub 只有一种入口 → partial；两种都没配也判 partial（gh CLI 可能已登录）', () => {
  const one = buildChannelHealth({ ...base, github: { ...base.github, webhookSecretConfigured: false } }, at);
  assert.equal(pick(one, 'github').verdict, 'partial');
  assert.match(pick(one, 'github').next, /GITHUB_WEBHOOK_SECRET/);
  const none = buildChannelHealth({ ...base, github: { ...base.github, webhookSecretConfigured: false, tokenConfigured: false } }, at);
  // 不把「不确定」判成「不可用」：本机 gh 已登录时轮询仍然能收。
  assert.equal(pick(none, 'github').verdict, 'partial');
  assert.ok(pick(none, 'github').missing.some(item => item.includes('gh')));
});

test('没有真实来源工单 → real-story 是 partial，不冒充成 ready', () => {
  const report = buildChannelHealth({ ...base, realStories: { total: 0 } }, at);
  const story = pick(report, 'real-story');
  assert.equal(story.verdict, 'partial');
  assert.ok(story.facts.some(fact => fact.includes('0 条')));
  assert.match(story.next, /发一句真实需求/);
  assert.equal(report.verdict, 'degraded');
});

test('事件收件箱没登记来源 → off，并指出「登记来源」才是开口子的方式', () => {
  const report = buildChannelHealth({ ...base, inbox: { enabled: true, claimed: [], pending: 0, mirrored: 3 } }, at);
  const inbox = pick(report, 'event-inbox');
  assert.equal(inbox.verdict, 'off');
  assert.ok(inbox.facts.some(fact => fact.includes('已留痕 3 条')));
  assert.match(inbox.next, /eventInbox\.sources/);
});
