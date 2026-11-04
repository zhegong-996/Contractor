import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Github } from '../src/github.ts';
import { command } from '../src/commands.ts';
import { configSchema } from '../src/config.ts';
import type { Task } from '../src/store.ts';

test('committing an out-of-scope file does not bypass the delivery boundary with a clean worktree', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'suitme-publish-'));
  const git = (args: string[]) => command('git', ['-c', 'user.name=Protocol Test', '-c', 'user.email=test@example.invalid', ...args], dir);
  try {
    await git(['init', '-b', 'collab/test']);
    await writeFile(path.join(dir, 'README.md'), 'Original\n'); await git(['add', '--', 'README.md']); await git(['commit', '-m', 'base']);
    const baseSha = (await git(['rev-parse', 'HEAD'])).trim();
    await writeFile(path.join(dir, 'README.md'), 'Unauthorized change\n'); await git(['add', '--', 'README.md']); await git(['commit', '-m', 'outside allowed paths']);
    const config = configSchema.parse({ paperclipUrl: 'http://127.0.0.1:3100', repository: 'test/repo', checkout: dir,
      allowedPaths: ['pilot/'], agents: {}, defaultAgent: 'manual', feishu: { profile: 'test' } });
    const task: Task = { id: 'test', identifier: 'SUI-TEST', triggerId: 'test', chatId: 'local', messageId: 'local', senderId: 'test', agent: 'manual',
      workspace: dir, branch: 'collab/test', context: JSON.stringify({ allowedPaths: ['pilot/'], baseSha }), generation: 1, phase: 'executed' };
    assert.equal((await git(['status', '--porcelain'])).trim(), '');
    await assert.rejects(new Github(config).publish(task), /Committed changes exceed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
