import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { exportCodeBundle, importRemoteCode } from '../src/workbench/isolation.ts';
import { bundleHash, codeBundleSchema } from '../src/workbench/code-bundle.ts';
import { executionCapabilities } from '../src/workbench/execution-capabilities.ts';
import { readMessage } from '../upstream/autoloop/worker/contract.ts';
import { claudeRunnerAdapter } from '../src/workbench/claude-runner-adapter.ts';

test('远端代码按冻结基线回收：拒绝越界、过期、路径伪造与并发覆盖，重复回执不重复改写', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'contractor-code-bundle-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', folder]);
  await mkdir(path.join(folder, 'pilot'));
  await writeFile(path.join(folder, 'pilot/index.html'), 'old');
  await writeFile(path.join(folder, 'README.md'), 'read-only');
  await writeFile(path.join(folder, '.env'), 'do-not-export');
  const bundle = await exportCodeBundle(folder, ['pilot/']);
  assert.deepEqual(Object.keys(bundle.files).sort(), ['README.md', 'pilot/index.html']);
  const delta = { base: bundleHash(bundle), files: { 'pilot/index.html': Buffer.from('new').toString('base64') } };
  await assert.rejects(importRemoteCode(folder, bundle, { ...delta, base: 'f'.repeat(64) }, () => true), /基线/);
  await assert.rejects(importRemoteCode(folder, bundle, { ...delta, files: { 'README.md': null } }, () => true), /授权/);
  await assert.rejects(importRemoteCode(folder, bundle, delta, () => false), /授权/);
  assert.equal(await readFile(path.join(folder, 'pilot/index.html'), 'utf8'), 'old');
  await writeFile(path.join(folder, 'pilot/index.html'), 'human edit');
  await assert.rejects(importRemoteCode(folder, bundle, delta, () => true), /宿主代码已变化/);
  await writeFile(path.join(folder, 'pilot/index.html'), 'old');
  await importRemoteCode(folder, bundle, delta, () => true);
  await importRemoteCode(folder, bundle, delta, () => true);
  assert.equal(await readFile(path.join(folder, 'pilot/index.html'), 'utf8'), 'new');
  for (const name of ['../escape', '/tmp/escape', '.env', '.git/config'])
    assert.equal(codeBundleSchema.safeParse({ paths: ['pilot/'], files: { [name]: '' } }).success, false);
  await symlink(path.join(folder, 'README.md'), path.join(folder, 'pilot/link'));
  await assert.rejects(exportCodeBundle(folder, ['pilot/']), /符号链接/);
});

test('引擎能力来自已实现的隔离方式，登记名称不等于可执行', () => {
  const base = { id: 'engineer', owner: 'engineer', engine: 'codex' as const, model: 'configured',
    execution: { kind: 'sandbox' as const, provider: 'openai', credential: 'own', domains: [], effort: 'low' as const } };
  assert.equal(executionCapabilities(base).code, true);
  assert.equal(executionCapabilities({ ...base, engine: 'cursor' }).available, false);
  assert.equal(executionCapabilities({ ...base, execution: undefined }).available, false);
  assert.equal(executionCapabilities({ ...base, execution: { ...base.execution, credential: undefined } }).available, false);
  const remote = { ...base, execution: { ...base.execution, kind: 'remote' as const } };
  assert.equal(executionCapabilities(remote).code, true);
  assert.equal(executionCapabilities(remote).platformDigest, false);
  const claude = executionCapabilities({ ...remote, engine: 'claude', execution: { ...remote.execution, provider: 'ollama', credential: undefined } });
  assert.equal(claude.read, true);
  assert.equal(claude.code, false);
  const configuredClaude = { ...remote, engine: 'claude' as const,
    execution: { ...remote.execution, provider: 'deepseek', credential: undefined } };
  assert.equal(executionCapabilities(configuredClaude).read, true);
  assert.equal(executionCapabilities(configuredClaude).code, false);
  assert.equal(executionCapabilities({ ...configuredClaude, execution: { ...configuredClaude.execution, credential: 'unexpected' } }).available, false);
});

test('Claude CLI 返回空标题时，原生 AutoLoop 收到正文或失败状态', () => {
  const adapter = claudeRunnerAdapter('ollama');
  const stream = (result: string) => JSON.stringify({ type: 'result', subtype: 'success', result, num_turns: 1 });
  const copy = '适合日常通勤，搭配起来省心。';
  const receipt = '```agent-autoloop\n{"later":[{"key":"review","at":"2026-11-16T17:00:00+08:00","about":"核对文案"}]}\n```';
  const output = adapter.read(stream('# Conclusion\n\n' + copy + '\n\n' + receipt), 0, '');
  assert.equal(readMessage(output.text!).summary, copy);
  assert.ok(readMessage(output.text!).receipt?.later);
  assert.equal(adapter.read(stream('结论：' + copy), 0, '').text, '结论：' + copy);
  assert.match(adapter.read(stream('# Conclusion'), 0, '').error!, /未给出可交付内容/);
});
