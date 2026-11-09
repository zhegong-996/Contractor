// 第三十八轮 · 通用入站事件源与事件收件箱（src/event-inbox.ts）。
//
// 覆盖的契约（都是红线级）：
//   1. 没登记来源 / 没配密钥 / 签名不对 / 正文不是 JSON / 缺事件类型 —— 一律拒收，
//      不静默吞掉、不猜测调用方意图；
//   2. GitLab 的人话事件名映射成稳定类型；GitHub 与监听器已用的三类型对齐；
//   3. 幂等：同 source + type + 指纹只落一条，重复投递不重复开工单；
//   4. 类型白名单外的事件照样入箱（filtered），但不会被 pending 选中；
//   5. 消费后写 consumed 并带 taskId，可回溯到哪条任务接走的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.ts';
import { EventInbox, inboxConfigSchema, inboxTypeMatches, defaultInboxConfig } from '../src/event-inbox.ts';

function fixture(sources: Record<string, unknown>, env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-inbox-'));
  const store = new Store(path.join(dir, 'state.sqlite'));
  const config = inboxConfigSchema.parse({ enabled: true, sources });
  const inbox = new EventInbox(store, config, env, () => new Date('2026-11-09T10:00:00+08:00'));
  return { dir, store, inbox, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const hex = (secret: string, raw: string) => createHmac('sha256', secret).update(raw).digest('hex');

test('没登记来源 / 没配密钥 / 显式关掉总开关，都拒收且给出原因', () => {
  const { inbox, cleanup } = fixture({ gitlab: { secretEnv: 'GITLAB_TOKEN' } }, {});
  try {
    assert.deepEqual(inbox.accept('nobody', '{}', {}), { ok: false, reason: 'source-not-configured' });
    // 登记了来源但环境变量没值：宁可不收，也不开一个谁都能投的口子。
    assert.deepEqual(inbox.accept('gitlab', '{}', { 'x-gitlab-token': 'x' }), { ok: false, reason: 'secret-not-configured' });
    // 默认配置总开关是开的，但没有登记来源 = 没有入口：不会因为「默认开启」多出一个裸奔口子。
    const empty = new EventInbox(inbox['store'], defaultInboxConfig(), {});
    assert.deepEqual(empty.accept('gitlab', '{}', {}), { ok: false, reason: 'source-not-configured' });
    assert.equal(empty.status().enabled, true);
    assert.deepEqual(empty.status().claimed, []);
    // 显式关掉总开关：即使登记了来源、密钥也对，仍然不收。
    const off = new EventInbox(inbox['store'], inboxConfigSchema.parse({ enabled: false, sources: { gitlab: { secretEnv: 'T' } } }), { T: 'k' });
    assert.deepEqual(off.accept('gitlab', '{}', {}), { ok: false, reason: 'events-disabled' });
  } finally { cleanup(); }
});

test('claims 决定 GitHub 走哪条通道；mirror 只留痕、不参与分流', () => {
  const { inbox, store, cleanup } = fixture({}, {});
  try {
    // 没登记 github：不由收件箱接管，既有 /github/webhook 即时通道继续用。
    assert.equal(inbox.claims('github'), false);
    const raw = JSON.stringify({ ref: 'refs/heads/main', head_commit: { message: 'fix: 修一个空指针' } });
    const mirrored = inbox.mirror('github', raw, { 'x-github-event': 'push' }, 'github-watch', 'github');
    assert.equal(mirrored.ok, true);
    assert.equal(mirrored.duplicate, false);
    // 留痕只是台账：pending 里没有它，规则不会拿它去开工单。
    assert.equal(inbox.pending().length, 0);
    const status = inbox.status();
    assert.equal(status.mirrored, 1);
    assert.equal(status.pending, 0);
    assert.ok(status.counts.some(cell => cell.state === 'mirrored' && cell.type === 'push'), '按 github 事件名归一化');
    // 同一事实重复留痕是幂等的。
    assert.equal(inbox.mirror('github', raw, { 'x-github-event': 'push' }, 'github-watch', 'github').duplicate, true);
    // 登记之后由收件箱接管：一个来源只有一条路径。
    const claimed = new EventInbox(store, inboxConfigSchema.parse({ sources: { github: { secretEnv: 'T', kind: 'github' } } }), { T: 'k' });
    assert.equal(claimed.claims('github'), true);
    assert.deepEqual(claimed.status().claimed, ['github']);
  } finally { cleanup(); }
});

test('GitLab 推送：X-Gitlab-Token 直比通过，人话事件名映射成 push', () => {
  const { inbox, cleanup } = fixture({ gitlab: { secretEnv: 'GITLAB_TOKEN', kind: 'gitlab' } }, { GITLAB_TOKEN: 's3cr3t' });
  try {
    const body = JSON.stringify({ object_kind: 'push', ref: 'refs/heads/main', after: 'abc123', user_name: 'zhe' });
    const bad = inbox.accept('gitlab', body, { 'x-gitlab-token': 'wrong', 'x-gitlab-event': 'Push Hook' });
    assert.deepEqual(bad, { ok: false, reason: 'bad-signature' });
    const ok = inbox.accept('gitlab', body, { 'x-gitlab-token': 's3cr3t', 'x-gitlab-event': 'Push Hook' });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.type, 'push');
    const [event] = inbox.pending();
    assert.equal(event?.source, 'gitlab');
    assert.equal(event?.type, 'push');
    // 正文只抽「发生了什么」，不抽「该做什么」。
    assert.match(event!.detail, /refs\/heads\/main/);
    assert.equal(event?.state, 'pending');
  } finally { cleanup(); }
});

test('通用来源：HMAC 签名（sha256= 前缀与裸 hex 都认），指纹相同则幂等', () => {
  const { inbox, store, cleanup } = fixture({ erp: { secretEnv: 'ERP_SECRET' } }, { ERP_SECRET: 'k' });
  try {
    const body = JSON.stringify({ type: 'order.paid', id: 'ORD-9', title: '订单已付款', detail: '金额 1200' });
    const first = inbox.accept('erp', body, { 'x-signature-256': 'sha256=' + hex('k', body) });
    assert.equal(first.ok, true);
    const again = inbox.accept('erp', body, { 'x-signature-256': hex('k', body) });
    assert.equal(again.ok && again.duplicate, true, '同一个事实重复投递不能落两条');
    const rows = store.db.prepare("SELECT count(*) AS n FROM events WHERE id LIKE 'inbox:erp:%'").get() as { n: number };
    assert.equal(rows.n, 1);
    assert.equal(inbox.pending().length, 1);
  } finally { cleanup(); }
});

test('类型白名单外的事件照样入箱，但不会被 pending 选中', () => {
  const { inbox, cleanup } = fixture({ erp: { secretEnv: 'ERP_SECRET', allow: ['order.*'] } }, { ERP_SECRET: 'k' });
  try {
    const paid = JSON.stringify({ type: 'order.paid', id: 'A1' });
    const ping = JSON.stringify({ type: 'system.ping', id: 'B1' });
    inbox.accept('erp', paid, { authorization: 'Bearer k' });
    const filtered = inbox.accept('erp', ping, { authorization: 'Bearer k' });
    assert.equal(filtered.ok, true, '不在白名单也不是错误，只是不参与分流');
    assert.deepEqual(inbox.pending().map(event => event.type), ['order.paid']);
    assert.equal(inbox.status().pending, 1);
    assert.equal(inboxTypeMatches(['order.*'], 'order.paid'), true);
    assert.equal(inboxTypeMatches(['order.*'], 'order'), false);
    assert.equal(inboxTypeMatches(['*'], 'anything'), true);
    assert.equal(inboxTypeMatches([], 'anything'), true);
  } finally { cleanup(); }
});

test('坏签名 / 非 JSON / 缺事件类型都拒收，不落库', () => {
  const { inbox, store, cleanup } = fixture({ gitlab: { secretEnv: 'T', kind: 'gitlab' } }, { T: 'k' });
  try {
    const body = JSON.stringify({ object_kind: 'push' });
    assert.deepEqual(inbox.accept('gitlab', body, { 'x-gitlab-token': 'nope' }), { ok: false, reason: 'bad-signature' });
    assert.deepEqual(inbox.accept('gitlab', 'not json', { 'x-gitlab-token': 'k' }), { ok: false, reason: 'bad-json' });
    const noType = inbox.accept('gitlab', JSON.stringify({ object_kind: '' }), { 'x-gitlab-token': 'k' });
    assert.deepEqual(noType, { ok: false, reason: 'missing-type' });
    const rows = store.db.prepare("SELECT count(*) AS n FROM events WHERE id LIKE 'inbox:%'").get() as { n: number };
    assert.equal(rows.n, 0);
  } finally { cleanup(); }
});

test('消费后标记 consumed 并记下接走它的任务，状态里如实计数', () => {
  const { inbox, cleanup } = fixture({ erp: { secretEnv: 'K' } }, { K: 'k' });
  try {
    const ids: string[] = [];
    for (const id of ['C1', 'C2']) {
      const result = inbox.accept('erp', JSON.stringify({ type: 'order.paid', id }), { authorization: 'Bearer k' });
      if (result.ok) ids.push(result.id);
    }
    assert.equal(inbox.pending().length, 2);
    inbox.consume(ids, 'task-1');
    assert.equal(inbox.pending().length, 0);
    const status = inbox.status();
    assert.equal(status.pending, 0);
    assert.deepEqual(status.counts.find(cell => cell.state === 'consumed'),
      { source: 'erp', type: 'order.paid', state: 'consumed', count: 2 });
    assert.deepEqual(status.sources, [{ name: 'erp', kind: 'generic', allow: [], secretConfigured: true }]);
  } finally { cleanup(); }
});
