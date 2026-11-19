import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { inspectPull } from '../src/workbench/github-delivery.ts';
import { resourceView } from '../src/workbench/project-resources.ts';

test('任务中心隔离子项目与会话归档，主题依据和当版产品检查逐段解锁代码交付', { timeout: 35000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-task-center-'));
  const oldPath = process.env.PATH;
  process.env.COLLAB_STATE_DIR = state;
  const checkout = path.join(state, 'checkout'), remote = path.join(state, 'test.git');
  const repository = 'example/store-fixture';
  await mkdir(checkout);
  await mkdir(path.join(checkout, 'pilot'));
  await mkdir(path.join(state, 'console'));
  const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(checkout, 'init', '-b', 'main');
  git(checkout, 'config', 'user.name', 'Contractor Fixture');
  git(checkout, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(checkout, 'pilot/card.html'), '<p>base</p>');
  git(checkout, 'add', 'pilot/card.html');
  git(checkout, 'commit', '-m', 'base');
  git(state, 'clone', '--bare', checkout, remote);
  git(checkout, 'remote', 'add', 'origin', 'https://github.com/' + repository + '.git');
  const gitPath = path.join(state, 'git');
  await writeFile(gitPath, '#!' + process.execPath + '\n' +
    'const args = process.argv.slice(2);\n' +
    'if (["fetch", "ls-remote"].includes(args[0]) && args.includes("origin")) args[args.indexOf("origin")] = ' + JSON.stringify(remote) + ';\n' +
    'const git = require("node:child_process").spawnSync("/usr/bin/git", args, { stdio: "inherit" });\n' +
    'process.exit(git.status ?? 1);\n');
  await chmod(gitPath, 0o700);
  process.env.PATH = state + path.delimiter + oldPath;
  const worker = path.join(state, 'agent.mjs');
  await writeFile(worker, `import { appendFileSync, existsSync } from 'node:fs';
if (existsSync('pilot/card.html')) appendFileSync('pilot/card.html', '\\n<p>280px / 320px / 360px</p>');
console.log('本轮已核对门店推荐理由。');`);
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { platformPlugins }, { developmentFolder }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
    import('../src/workbench/platform-plugins.ts'), import('../src/workbench/development.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  const password = randomUUID();
  await auth.bootstrapOwner('product', password);
  await auth.createAccount('engineering', password, 'operator', 'product');
  const topic = 'recommendation';
  const config = settingsSchema.parse({
    executionRuntime: process.env.CONTRACTOR_TEST_EXECUTION === 'contractor' ? 'contractor' : 'autoloop',
    attribution: { checkouts: { [repository]: checkout } },
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'engineering'], maintainers: ['product'],
      topics: [{ id: topic, title: '推荐理由' }],
      resources: [{ source: 'github', externalId: repository, state: 'bound', contributors: ['product', 'engineering'],
        execution: { base: 'main', paths: ['pilot/'],
          deliveryTemplate: { id: 'store-layout', version: 1, stages: { requireTopicBasis: true },
            product: { manual: [{ id: 'viewport', title: '三个视口', expectation: '三个视口下长词不溢出' }] } } } }] },
    { id: 'private-pilot', title: '受限子项目', parent: 'store', members: ['product'], maintainers: ['product'],
      topics: [{ id: 'notes', title: '受限主题' }] }],
    functions: [{ id: 'develop', title: '核对改动' }],
    agents: [{ id: 'local-dev', title: '核对 Agent', owner: 'engineering', kind: 'personal', function: 'develop',
      projects: ['store'], active: true, engine: 'command', execution: { kind: 'test', provider: 'fixture' },
      capability: '核对推荐卡', command: [process.execPath, worker], skill: '按确认的依据交付。' }],
  });
  const url = 'https://github.com/' + repository + '/pull/1';
  let observed: Awaited<ReturnType<typeof inspectPull>>;
  const native = platformPlugins(config).use('delivery');
  const plugins = platformPlugins(config, { delivery: { id: 'test-store-delivery', api: 1, service: { ...native, inspectPull: async () => observed } } });
  const work = await openCollaboration(config, auth, undefined, undefined, undefined, plugins);
  t.after(async () => { await work.close(); process.env.PATH = oldPath; await rm(state, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined | null) {
    for (let index = 0; index < 160; index++) {
      const value = read();
      if (value) return value;
      await delay(100);
    }
    assert.fail('未取得当前工单证据');
  }
  const ref = resourceView('store', config.projects[0]!.resources[0]!).ref;
  const brief = { project: 'store', title: '门店推荐理由 · 小屏换行', request: '按三档视口改进推荐卡',
    agent: 'local-dev', priority: 'normal' as const, nonce: randomUUID(), material: [], target: ref };
  assert.throws(() => work.start('product', brief), { status: 409 });
  const opening = work.start('product', { ...brief, topic });
  const id = await wait(() => work.resolveStart('product', opening.trigger));
  const copy = work.start('product', { ...brief, title: '门店推荐理由 · 文案核对', nonce: randomUUID(), target: undefined, topic });
  const copyId = await wait(() => work.resolveStart('product', copy.trigger));
  const detail = () => work.detail('product', id);
  assert.throws(() => work.setTopic('product', id), { status: 409 });
  work.approveDevelopment('engineering', id);
  await wait(() => detail().runs.find(run => run.state === 'queued'));
  assert.equal(detail().recovery?.kind, 'stage-scope');
  assert.equal(detail().runs.length, 1);

  const ownPage = work.conversationIndex('product', { q: '受限主题' });
  assert.deepEqual(ownPage.rows.map(row => row.project), ['private-pilot']);
  assert.equal(work.conversationIndex('engineering', { q: '受限主题' }).rows.length, 0);
  assert.throws(() => work.conversationIndex('engineering', { project: 'private-pilot' }), { status: 404 });
  work.postConversation('product', 'store', { ticket: id, nonce: randomUUID(), text: '长词需要换行。' });
  work.postConversation('product', 'store', { ticket: copyId, nonce: randomUUID(), text: '先写穿着场景。' });
  const first = work.conversationIndex('product', { project: 'store', q: '门店推荐理由 ·', limit: 1 });
  assert.ok(first.next);
  const rest = work.conversationIndex('product', { project: 'store', q: '门店推荐理由 ·', after: first.next });
  assert.deepEqual(new Set([...first.rows, ...rest.rows].map(row => row.ticket)), new Set([id, copyId]));
  assert.deepEqual(work.conversation('product', 'store', { ticket: copyId }).map(row => row.text), ['先写穿着场景。']);
  assert.deepEqual(work.archiveConversation('product', 'store', { ticket: id, archived: true }), { archived: true });
  assert.deepEqual(work.archiveConversation('product', 'store', { ticket: id, archived: true }), { archived: true });
  assert.deepEqual(work.conversationIndex('product', { archived: true }).rows.map(row => row.ticket), [id]);
  assert.ok(work.conversationIndex('engineering', { q: '小屏换行' }).rows.some(row => row.ticket === id));
  work.archiveConversation('product', 'store', { ticket: id, archived: false });

  work.postConversation('product', 'store', { topic, nonce: randomUUID(), text: '三档均需可读，连续长词可换行。' });
  const basis = work.ticketTopicContext('product', id).recent[0]!;
  const selected = { source: basis.source, id: basis.id, revision: basis.revision, confirmed: true };
  assert.throws(() => work.setTicketTopicBasis('engineering', id, selected), { status: 403 });
  assert.throws(() => work.setTicketTopicBasis('product', id, { ...selected, revision: 'stale' }), { status: 409 });
  assert.ok(work.setTicketTopicBasis('product', id, selected).changed);
  assert.equal(work.setTicketTopicBasis('product', id, selected).changed, false);
  const output = await wait(() => detail().result);
  assert.equal(detail().runs.length, 1);
  assert.equal(work.executionSnapshot('product', id, output.run, output.attempt).review?.topicBasis, true);
  const head = git(developmentFolder(id), 'rev-parse', 'HEAD');
  const base = git(checkout, 'rev-parse', 'HEAD');
  const identity = { id: 101, login: 'engineering', type: 'User' };
  const checks = [{ id: 1, name: 'collab-pilot', head_sha: head, status: 'completed', conclusion: 'success',
    app: { id: 15368, slug: 'github-actions' } }];
  observed = {
    body: 'Contractor-Work: ' + id, pushes: [], commits: [{ sha: head, author: identity, committer: identity }], attempts: checks,
    snapshot: { repository, url, pr: 1, headSha: head, baseSha: base, repoId: 1, headRepoId: 1, headBranch: 'contractor/' + id,
      baseBranch: 'main', state: 'open', creator: identity, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ci: 'passed', checks, requiredChecks: [{ name: 'collab-pilot', app: 'github-actions' }], deployed: undefined,
      mergedBy: undefined, mergedAt: null, milestone: undefined, reviews: [], labels: [], assignees: [], requestedReviewers: [] },
  };
  await work.linkDelivery('product', id, url);
  const waiting = () => work.needsYou('product').filter(row => row.ticket === id && row.kind === 'acceptance');
  assert.equal(waiting().length, 0);
  assert.equal(detail().recovery?.kind, 'stage-verification');
  await assert.rejects(work.accept('product', id, output.revision, '', '', head), { status: 409 });
  const check = { case: 'viewport', revision: output.revision, head, previous: 0, passed: true, note: '逐档核对通过' };
  assert.throws(() => work.recordProductCheck('product', id, { ...check, head: base }), { status: 409 });
  work.recordProductCheck('product', id, check);
  work.recordProductCheck('product', id, check);
  assert.equal(waiting().length, 1);
  await work.accept('product', id, output.revision, '', '', head);
  assert.equal(waiting().length, 0);
  assert.deepEqual(detail().versions[0]?.reviews[0]?.stages?.stages.map(stage => stage.state), Array(4).fill('passed'));
});
