// 第三十六轮 · GitHub 监听（src/github-watch.ts）。
// 红线：事件只产生任务；指纹幂等（轮询与 webhook 双路径同指纹只建一次）；
// 首次运行只记基线不建任务；webhook 验签常量时间比较；凭据只从环境变量读。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.ts';
import { GithubWatcher, verifyGithubSignature, describeEvent, fingerprintOf, defaultGithubWatchConfig } from '../src/github-watch.ts';
import type { Config } from '../src/config.ts';

function fixture(env: Record<string, string | undefined> = {}, pages: Record<string, unknown[]> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-ghwatch-')), store = new Store(path.join(dir, 'state.sqlite'));
  const task: any = { id: 'task-base', identifier: 'SUI-1', triggerId: 't1', chatId: 'local', messageId: 'local', senderId: 'local-operator',
    agent: 'executor', generation: 1, phase: 'ready', kind: 'collaboration', context: '{}', workspace: '', branch: '' };
  store.save(task);
  const created: any[] = [], delegated: any[] = [];
  const w: any = {
    config: { feishu: { allowedSenders: [], allowedChats: [], botId: '', appId: '' }, paperclipUrl: 'http://127.0.0.1:3100' },
    store, manager: (a: any) => { if (!a.admin) throw new Error('Unauthorized'); },
    createTask: async (input: any, actor: any) => {
      const existing = store.list().find((t: any) => t.triggerId === 'workspace:' + input.requestKey);
      if (existing) return existing;
      const t = { ...task, id: 'task-' + (created.length + 2), identifier: 'SUI-' + (created.length + 2),
        triggerId: 'workspace:' + input.requestKey, context: JSON.stringify({ request: input.goal }) };
      created.push({ input, actor }); store.save(t); return t;
    },
  };
  const assistant: any = { delegate: async (taskId: string, _e: boolean, _m: string, instruction: string) => { delegated.push({ taskId, instruction }); } };
  // 测试仓库用不存在的名字，保证 gh api 必然失败、落到注入的 REST fetch。
  const config = { ...({} as any as Config), defaultAgent: 'executor', repository: 'suitme/nonexistent-watch-repo',
    githubWatch: { ...defaultGithubWatchConfig(), enabled: true, maxEventsPerTick: 5 } } as Config;
  const fetchImpl: typeof globalThis.fetch = (async (input: any) => {
    const url = String(input);
    for (const [suffix, page] of Object.entries(pages)) if (url.includes(suffix)) return new Response(JSON.stringify(page), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as any;
  const watcher = new GithubWatcher(w, assistant, config, env, fetchImpl, () => new Date('2026-11-09T10:00:00+08:00'));
  return { store, created, delegated, w, assistant, watcher, config, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const commit = { sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', message: '修复登录页崩溃\n\n附回归测试', author: { name: '陈默' } };
const issue = { number: 42, title: '搜索结果分页错误', state: 'open', updated_at: '2026-11-09T02:00:00Z', user: { login: 'gongzhe' }, html_url: 'https://github.com/suitme/nonexistent-watch-repo/issues/42' };
const pull = { number: 7, title: '重构交付流水线', state: 'open', updated_at: '2026-11-09T02:00:00Z', user: { login: 'lichen' }, html_url: 'https://github.com/suitme/nonexistent-watch-repo/pull/7' };

test('first tick only records a baseline: no tasks, events marked as seen', async () => {
  const f = fixture({ GITHUB_WATCH_TOKEN: 'test-token' }, { 'commits?': [commit], 'issues?': [issue], 'pulls?': [pull] });
  try {
    const report = await f.watcher.tick();
    assert.equal(report.baseline, true);
    assert.equal(report.observed, 3);
    assert.equal(report.tasksCreated, 0);
    assert.equal(f.created.length, 0);
    assert.equal((f.store.db.prepare("SELECT COUNT(*) n FROM events WHERE id LIKE 'github-watch:%' AND state='baseline'").get() as any).n, 3);
  } finally { f.close(); }
});

test('new events after the baseline become tasks with idempotent fingerprints', async () => {
  const f = fixture({ GITHUB_WATCH_TOKEN: 'test-token' }, { 'commits?': [commit], 'issues?': [issue], 'pulls?': [pull] });
  try {
    await f.watcher.tick(); // 基线
    (f.watcher as any).lastPollAt = 0; // 测试直改节流字段模拟下一个轮询窗口
    const updated = { ...issue, updated_at: '2026-11-09T03:00:00Z' };
    const f2pages = { 'commits?': [commit], 'issues?': [updated, issue], 'pulls?': [pull] };
    (f.watcher as any).fetchImpl = (async (input: any) => {
      const url = String(input);
      for (const [suffix, page] of Object.entries(f2pages)) if (url.includes(suffix)) return new Response(JSON.stringify(page), { status: 200 });
      return new Response('[]', { status: 200 });
    }) as any;
    const second = await f.watcher.tick();
    assert.equal(second.tasksCreated, 1, '只有 updated_at 变化的议题是新事件');
    assert.equal(f.created.length, 1);
    assert.match(f.created[0]!.input.title, /^\[GitHub\] 议题 #42 updated/);
    assert.match(f.created[0]!.input.goal, /不是新的人工需求/);
    assert.equal(f.created[0]!.actor.automation, 'github-watch');
    (f.watcher as any).lastPollAt = 0;
    const third = await f.watcher.tick();
    assert.equal(third.tasksCreated, 0, '同一指纹不重复建任务');
  } finally { f.close(); }
});

test('push and pull events describe tasks that never auto-approve', async () => {
  const described = describeEvent('push', commit, { pusher: { name: 'gongzhe' } })!;
  assert.match(described.title, /推送 a1b2c3d4e5/);
  assert.match(described.detail, /gongzhe/);
  const pr = describeEvent('pull', pull, { action: 'opened' })!;
  assert.match(pr.title, /PR #7 opened/);
  assert.match(pr.detail, /不要自动放行/);
  assert.equal(fingerprintOf('push', commit), commit.sha);
  assert.equal(fingerprintOf('issue', issue), '42:2026-11-09T02:00:00Z');
});

test('webhook requires a configured secret and a valid HMAC signature (constant-time)', async () => {
  const f = fixture({ GITHUB_WEBHOOK_SECRET: 'whsec' });
  try {
    await f.watcher.tick(); // 基线，避免 webhook 首事件撞上 baseline 分支
    const raw = JSON.stringify({ action: 'opened', issue: { ...issue, updated_at: '2026-11-09T05:00:00Z' } });
    const good = 'sha256=' + createHmac('sha256', 'whsec').update(raw).digest('hex');
    assert.equal(verifyGithubSignature('whsec', raw, good), true);
    assert.equal(verifyGithubSignature('whsec', raw, 'sha256=' + '0'.repeat(64)), false);
    assert.equal(verifyGithubSignature('whsec', raw, undefined), false);
    const unconfigured = fixture({});
    try {
      const r = await unconfigured.watcher.handleWebhook(raw, good, 'issues');
      assert.equal(r.handled, false); assert.equal(r.reason, 'webhook-secret-not-configured');
    } finally { unconfigured.close(); }
    const bad = await f.watcher.handleWebhook(raw, 'sha256=' + '0'.repeat(64), 'issues');
    assert.equal(bad.handled, false); assert.equal(bad.reason, 'bad-signature');
    const ok = await f.watcher.handleWebhook(raw, good, 'issues');
    assert.equal(ok.handled, true, '验签通过、指纹是新的 → 建任务');
    assert.equal(f.created.length, 1);
    const dup = await f.watcher.handleWebhook(raw, good, 'issues');
    assert.equal(dup.handled, false); assert.equal(dup.reason, 'duplicate', 'webhook 重放同指纹不重复');
    const ignored = await f.watcher.handleWebhook(raw, good, 'star_added');
    assert.equal(ignored.handled, false); assert.match(String(ignored.reason), /event-not-watched/);
  } finally { f.close(); }
});

test('disabled watcher and missing credentials report honestly in status', async () => {
  const f = fixture({});
  try {
    assert.equal((await f.watcher.tick()).observed, 0);
    const status = f.watcher.status();
    assert.equal(status.enabled, true);
    assert.equal(status.repository, 'suitme/nonexistent-watch-repo');
    assert.equal(status.tokenConfigured, false, '环境变量未设置时如实报告');
    assert.equal(status.webhookSecretConfigured, false);
  } finally { f.close(); }
  const off = fixture(); off.config.githubWatch!.enabled = false;
  try {
    const report = await off.watcher.tick();
    assert.equal(report.observed, 0);
    const r = await off.watcher.handleWebhook('{}', 'sha256=x', 'push');
    assert.equal(r.handled, false); assert.equal(r.reason, 'not-enabled');
  } finally { off.close(); }
});
