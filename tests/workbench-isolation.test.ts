import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import test from 'node:test';

const execute = promisify(execFile);
const state = await realpath(await mkdtemp(path.join(os.tmpdir(), 'suitme-isolation-test-')));
process.env.COLLAB_STATE_DIR = state;
const { sandboxPolicy, sandboxInvocation, isolateJob, importIsolatedChanges, modelReceipt, discardIsolation } = await import('../src/workbench/isolation.ts');
test.after(() => rm(state, { recursive: true, force: true }));

test('实际 Seatbelt 限制跨成员资料、旧会话、宿主环境、符号链接及写入范围', { skip: process.platform !== 'darwin', timeout: 20000 }, async () => {
  const base = path.join(state, 'boundary');
  const workspace = path.join(base, 'workspace'), home = path.join(base, 'home'), input = path.join(base, 'input');
  const temp = await realpath(await mkdtemp('/private/tmp/suitme-boundary-'));
  try {
    for (const directory of [workspace, home, input]) await mkdir(directory, { recursive: true });
    const outside = path.join(state, 'other-member.txt');
    await writeFile(outside, 'another member secret');
    await writeFile(path.join(input, 'context.json'), 'current authorized context');
    await symlink(outside, path.join(workspace, 'escape.txt'));
    const policy = path.join(base, 'policy.json');
    await writeFile(policy, JSON.stringify(sandboxPolicy(workspace, home, input, '/bin/sh', ['allowed.txt'], [], temp)));
    const script = [
      'test -z "$SUITME_TEST_HOST_SECRET" || exit 90',
      'test "$HOME" = "$1" || exit 91',
      'test "$CODEX_HOME" = "$1" || exit 92',
      'test ! -r "$2" || exit 93',
      'test ! -r escape.txt || exit 94',
      'test "$(cat "$3/context.json")" = "current authorized context" || exit 95',
      'if echo bad > "$3/context.json" 2>/dev/null; then exit 96; fi',
      'if echo bad > forbidden.txt 2>/dev/null; then exit 97; fi',
      'echo allowed > allowed.txt',
      'echo ISOLATION_OK',
    ].join('\n');
    const args = sandboxInvocation({ home, temp, policy }, ['/bin/sh', '-c', script, 'probe', home, outside, input], path.join(input, 'context.json'));
    const { stdout } = await execute(args[0]!, args.slice(1), { cwd: workspace, timeout: 15000,
      env: { ...process.env, SUITME_TEST_HOST_SECRET: 'must-not-leak' } });
    assert.equal(stdout.trim(), 'ISOLATION_OK');
    assert.equal((await readFile(path.join(workspace, 'allowed.txt'), 'utf8')).trim(), 'allowed');
    assert.equal(await readFile(outside, 'utf8'), 'another member secret');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('缺模型、缺本成员凭据及生产误用测试执行器都不会继承宿主登录', async () => {
  const job = { run: 1, attempt: 1 } as Parameters<typeof isolateJob>[1];
  const base = { id: 'a', owner: 'replacement', engine: 'codex', model: 'configured-model' };
  await assert.rejects(isolateJob(base as never, job, {}), /配置/);
  const agent = { ...base, execution: { kind: 'sandbox', provider: 'openai', credential: 'model', domains: [], effort: 'low' } };
  await assert.rejects(isolateJob({ ...agent, model: undefined } as never, job, {}), /模型/);
  await mkdir(path.join(state, 'member-credentials', 'engineering'), { recursive: true });
  await writeFile(path.join(state, 'member-credentials', 'engineering', 'model.json'), '{"OPENAI_API_KEY":"test-only"}', { mode: 0o600 });
  await assert.rejects(isolateJob(agent as never, job, {}), /ENOENT/, '不会回退到上一位成员的凭据');
  await mkdir(path.join(state, 'member-credentials', 'replacement'), { recursive: true });
  const credential = path.join(state, 'member-credentials', 'replacement', 'model.json');
  await writeFile(credential, '{"OPENAI_API_KEY":"test-only"}');
  await chmod(credential, 0o644);
  await assert.rejects(isolateJob(agent as never, job, {}), /0600/);
  const script = `import {isolateJob} from ${JSON.stringify(new URL('../src/workbench/isolation.ts', import.meta.url).href)};
    try {await isolateJob(${JSON.stringify({ ...base, execution: { kind: 'test', provider: 'fixture' } })},{},{});process.exit(99)}
    catch(error){if(!error.message.includes('测试进程'))throw error}`;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env });
});

test('代码交接核对全部路径和宿主基线后才导入，旧授权环境可清除，费用以外保留实际模型回执', async () => {
  const canonical = path.join(state, 'canonical'), workspace = path.join(state, 'copy');
  for (const directory of [canonical, workspace, path.join(state, 'isolation-launches')]) await mkdir(directory, { recursive: true });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  await writeFile(path.join(canonical, 'index.html'), 'original');
  await writeFile(path.join(workspace, 'index.html'), 'changed');
  const launch = { canonical, workspace, paths: ['index.html'], baseline: { 'index.html': hash('original') } };
  await writeFile(path.join(state, 'isolation-launches', '1-1.json'), JSON.stringify(launch));
  await writeFile(path.join(workspace, 'private.txt'), 'unauthorized');
  await assert.rejects(importIsolatedChanges(1, 1), /范围外/);
  assert.equal(await readFile(path.join(canonical, 'index.html'), 'utf8'), 'original');
  await rm(path.join(workspace, 'private.txt'));
  await writeFile(path.join(canonical, 'index.html'), 'concurrent host update');
  await assert.rejects(importIsolatedChanges(1, 1), /宿主代码已变化/);
  await writeFile(path.join(canonical, 'index.html'), 'original');
  await assert.rejects(importIsolatedChanges(1, 1, () => false), /授权已变化/);
  assert.equal(await readFile(path.join(canonical, 'index.html'), 'utf8'), 'original');
  await link(path.join(workspace, 'index.html'), path.join(state, 'outside-link.html'));
  await assert.rejects(importIsolatedChanges(1, 1), /硬链接/);
  await rm(path.join(state, 'outside-link.html'));
  await importIsolatedChanges(1, 1);
  await importIsolatedChanges(1, 1);
  assert.equal(await readFile(path.join(canonical, 'index.html'), 'utf8'), 'changed');
  const isolation = { scope: 'old-authority', owner: 'engineering', agent: 'developer', provider: 'openai', model: 'requested-model',
    credentialVersion: 'test', boundary: 'os-sandbox' as const };
  const logs = path.join(state, 'isolated', isolation.scope, 'home', 'sessions', '2026');
  await mkdir(logs, { recursive: true });
  await writeFile(path.join(logs, 'rollout-session-a.jsonl'), JSON.stringify({ type: 'turn_context', payload: { model: 'actual-model' } }));
  assert.deepEqual(await modelReceipt(isolation, 'session-a'), { provider: 'openai', requested: 'requested-model', reported: 'actual-model', verification: 'session-reported' });
  await discardIsolation(isolation);
  assert.equal((await modelReceipt(isolation, 'session-a')).verification, 'requested-only');
});
