import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { PullCheck } from '../src/workbench/github-delivery.ts';
import { digest } from '../src/workbench/knowledge.ts';
import type { OutboundMessage } from '../upstream/superagent/src/core/index.ts';

const directory = await mkdtemp(path.join(os.tmpdir(), 'suitme-code-acceptance-'));
process.env.COLLAB_STATE_DIR = directory;
const { pullChecks } = await import('../src/workbench/github-delivery.ts');

const sha = 'a'.repeat(40), base = 'b'.repeat(40), foreign = 'c'.repeat(40);
const check = (id: number, change: Partial<PullCheck> = {}): PullCheck => ({ id, name: 'collab-pilot',
  head_sha: sha, status: 'completed', conclusion: 'success', app: { id: 15368, slug: 'github-actions' }, ...change });

test('版本 CI 只采信当前 SHA 的原生 Actions 最新检查，缺少或进行中均不可验收', () => {
  assert.equal(pullChecks(sha, []).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1, { head_sha: foreign })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1, { app: { id: 1, slug: 'untrusted-app' } })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1), check(2, { status: 'in_progress', conclusion: null })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1), check(2, { conclusion: 'failure' })]).ci, 'failed');
  assert.equal(pullChecks(sha, [check(1), check(2, { conclusion: 'cancelled' })]).ci, 'failed');
  assert.deepEqual(pullChecks(sha, [check(1), check(2)]).checks.map(item => item.id), [2]);
});

test('自定义 CI 门禁绑定本单运行提交、PR 分支基线与当前 CI，缺参数及外来交付均拒绝', { timeout: 25000 }, async t => {
  // Local admission regression: real native lifecycle, trusted ledger fixtures, mocked GitHub transport.
  // Live Codex, Git and GitHub evidence is collected separately by the integration journey.
  const oldPath = process.env.PATH;
  process.env.COLLAB_STATE_DIR = directory;
  process.env.PATH = directory + path.delimiter + oldPath;
  await mkdir(path.join(directory, 'console'));
  const remoteFile = path.join(directory, 'remote.json');
  const github = path.join(directory, 'gh');
  await writeFile(github, '#!' + process.execPath + '\n'
    + 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(' + JSON.stringify(remoteFile) + ', "utf8"));\n'
    + 'const route = process.argv[3]; let result;\n'
    + 'if (route.includes("/check-runs?")) result = [{check_runs:data.checks}];\n'
    + 'else if (route.includes("/commits?")) result = [data.commits];\n'
    + 'else if (route.includes("/reviews?")) result = [[]];\n'
    + 'else if (route.includes("/activity?")) result = [];\n'
    + 'else if (/\\/pulls\\/\\d+$/.test(route)) result = data.pull;\n'
    + 'else { console.error("unexpected route",route); process.exit(1); }\n'
    + 'process.stdout.write(JSON.stringify(result));\n');
  await chmod(github, 0o700);
  const fixture = path.join(directory, 'agent.mjs');
  await writeFile(fixture, 'console.log("门店推荐理由的本轮成果");');
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'only-for-unit-test');
  await auth.createAccount('maker', 'only-for-unit-test', 'operator', 'owner');
  const requiredName = 'store-mobile-layout';
  const codeCheck = (id: number, change: Partial<PullCheck> = {}) => check(id, { name: requiredName, ...change });
  const config = settingsSchema.parse({
    feishu: { appId: 'app', botId: 'bot', profile: 'test' },
    projects: [{ id: 'store', title: '门店推荐理由', members: ['owner', 'maker'], maintainers: ['owner'],
      resources: [{ source: 'github', externalId: 'team/test', state: 'bound', contributors: ['owner', 'maker'],
        execution: { base: 'main', paths: ['collab-pilot/'], requiredChecks: [{ name: requiredName, app: 'github-actions', appId: 15368 }] } }] }],
    functions: [{ id: 'delivery', title: '交付' }],
    agents: [{ id: 'review', title: '核对', projects: ['store'], active: true, owner: 'maker', function: 'delivery',
      kind: 'personal', execution: { kind: 'test', provider: 'fixture' }, engine: 'command', command: [process.execPath, fixture], capability: '核对推荐理由', skill: '核对' }],
  });
  const messages: OutboundMessage[] = [];
  const work = await openCollaboration(config, auth, async message => { messages.push(message); return 'sent'; });
  for (const member of ['owner', 'maker']) {
    const identity = { provider: 'feishu' as const, namespace: 'app', id: 'ou_' + member, label: member };
    work.proveAccount(work.accountProof(member, 'feishu').command.split(' ')[1]!, identity);
    work.confirmAccount(member, 'feishu', identity);
  }
  const db = new DatabaseSync(path.join(directory, 'orchestrator.sqlite'));
  t.after(async () => { db.close(); await work.close(); process.env.PATH = oldPath;
    await rm(directory, { recursive: true, force: true }); });
  const wait = async <T>(get: () => T | undefined) => {
    for (let index = 0; index < 150; index++) { const result = get(); if (result) return result; await delay(100); }
    assert.fail('等待原生执行完成超时');
  };
  const start = work.start('owner', { project: 'store', title: '门店推荐理由', request: '核对门店推荐理由',
    nonce: 'code-acceptance', agent: 'review', material: [], priority: 'normal' });
  const id = await wait(() => work.resolveStart('owner', start.trigger) ?? undefined);
  const output = await wait(() => work.detail('owner', id).result);
  const original = JSON.parse(String(db.prepare('SELECT value FROM workbench_ticket WHERE id=?').get(id)!.value));
  const development = { repository: 'team/test', base: 'main', paths: ['collab-pilot/'],
    branch: 'suitme/' + id, baseSha: base, commit: sha };
  db.prepare('UPDATE workbench_ticket SET value=? WHERE id=?').run(JSON.stringify({ ...original,
    development: { repository: development.repository, base: development.base, paths: development.paths } }), id);
  const manifest = JSON.parse(String(db.prepare('SELECT value FROM workbench_manifest WHERE run=?').get(output.run)!.value));
  db.prepare('UPDATE workbench_manifest SET value=? WHERE run=?').run(JSON.stringify({ ...manifest, development }), output.run);
  const identity = { id: 1, login: 'maker', type: 'User' };
  const repository = { id: 100, full_name: 'team/test' };
  const remote = {
    pull: { number: 1, html_url: 'https://github.com/team/test/pull/1', body: 'SuitMe-Work: ' + id,
      base: { sha: base, ref: 'main', repo: repository }, head: { sha, ref: development.branch, repo: repository },
      user: identity, state: 'open', draft: false, merged: false, created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z', merged_at: null, requested_reviewers: [], assignees: [], labels: [] },
    commits: [{ sha, author: identity, committer: identity }], checks: [codeCheck(1)],
  };
  const save = () => writeFile(remoteFile, JSON.stringify(remote));
  const accept = (commit?: string) => work.accept('owner', id, output.revision, '本轮范围', '', commit);
  await assert.rejects(accept(), /代码工单必须/);
  await assert.rejects(accept(sha), /代码工单必须/);
  const refresh = () => work.refreshGithubEvidence({ id: String(repository.id), name: 'team/test' }, new Set());
  const pending = (actor: string, kind: 'acceptance' | 'delivery') => work.needsYou(actor).find(d => d.ticket === id && d.kind === kind);
  await refresh();
  const missing = await wait(() => {
    const decision = pending('maker', 'delivery');
    return decision?.notification === 'sent' ? decision : undefined;
  });
  assert.equal(pending('owner', 'acceptance'), undefined);
  assert.equal(work.overview('owner').tickets.find(ticket => ticket.id === id)?.attention, false);
  await save();
  remote.pull.head.ref = 'suitme/another-ticket'; await save();
  await assert.rejects(work.linkDelivery('owner', id, remote.pull.html_url), /本工单当前成果/);
  remote.pull.head.ref = development.branch;
  remote.pull.head.sha = foreign; remote.commits[0]!.sha = foreign; await save();
  await assert.rejects(work.linkDelivery('owner', id, remote.pull.html_url), /本工单当前成果/);
  remote.pull.head.sha = sha; remote.commits[0]!.sha = sha;
  remote.pull.head.repo = { id: 101, full_name: 'fork/test' }; await save();
  await assert.rejects(work.linkDelivery('owner', id, remote.pull.html_url), /本工单当前成果/);
  remote.pull.head.repo = repository;
  remote.pull.base.ref = 'other-base'; await save();
  await assert.rejects(work.linkDelivery('owner', id, remote.pull.html_url), /本工单当前成果/);
  remote.pull.base.ref = 'main';
  remote.pull.base.sha = foreign; await save();
  await assert.rejects(work.linkDelivery('owner', id, remote.pull.html_url), /本工单当前成果/);
  remote.pull.base.sha = base;
  remote.checks = [check(99)];
  await save();
  await work.linkDelivery('owner', id, remote.pull.html_url);
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'missing-evidence');
  assert.equal(pending('owner', 'acceptance'), undefined);
  remote.checks = [codeCheck(1, { status: 'in_progress', conclusion: null })];
  await save();
  await work.linkDelivery('owner', id, remote.pull.html_url);
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'ci-pending');
  assert.equal(pending('owner', 'acceptance'), undefined);
  assert.equal(pending('maker', 'delivery'), undefined);
  await assert.rejects(accept(), /代码工单必须/);
  await assert.rejects(work.accept('maker', id, output.revision, '', '', sha), /原发起人验收/);
  for (const checks of [[], [codeCheck(1, { head_sha: foreign })], [codeCheck(1), codeCheck(2, { status: 'in_progress', conclusion: null })],
    [codeCheck(2, { conclusion: 'failure' })]]) {
    remote.checks = checks; await save();
    await assert.rejects(accept(sha), /CI 已变化/);
    assert.equal(work.detail('owner', id).work.accepted, undefined);
  }
  await refresh(); await refresh();
  const failed = await wait(() => {
    const decision = pending('maker', 'delivery');
    return decision?.notification === 'sent' ? decision : undefined;
  });
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'ci-failed');
  assert.notEqual(failed.id, missing.id);
  assert.equal(messages.filter(message => message.channel.address.decision === failed.id).length, 1);
  assert.equal(pending('owner', 'acceptance'), undefined);
  remote.checks = [codeCheck(3)];
  remote.pull.head.sha = foreign; remote.commits[0]!.sha = foreign; await save();
  await assert.rejects(accept(sha), /CI 已变化/);
  await refresh();
  assert.equal(work.detail('owner', id).work.delivery, undefined, 'a newer but unrelated head is only a PR observation');
  assert.equal(work.detail('owner', id).work.deliveryPr?.url, remote.pull.html_url);
  assert.equal(pending('owner', 'acceptance'), undefined);
  remote.pull.head.sha = sha; remote.commits[0]!.sha = sha;
  remote.pull.draft = true; await save();
  await refresh();
  await assert.rejects(accept(sha), /CI 已变化/);
  remote.pull.draft = false; await save();
  // Migrate a prior revision that had cleared its current delivery. The historical explicit link is enough to follow the same PR.
  db.prepare("UPDATE workbench_ticket SET value=json_remove(value,'$.delivery','$.deliveryPr') WHERE id=?").run(id);
  await refresh(); await refresh();
  const ready = await wait(() => {
    const decision = pending('owner', 'acceptance');
    return decision?.notification === 'sent' ? decision : undefined;
  });
  assert.equal(messages.filter(message => message.channel.address.decision === ready.id).length, 1);
  assert.equal(pending('maker', 'delivery'), undefined);
  // A later failed attempt hides the review inbox item. Restoring green for the same output doesn't push again.
  remote.checks = [codeCheck(4, { conclusion: 'failure' })]; await save(); await refresh();
  assert.equal(pending('owner', 'acceptance'), undefined);
  remote.checks = [codeCheck(5)]; await save(); await refresh();
  assert.equal(pending('owner', 'acceptance')?.id, ready.id);
  assert.equal(messages.filter(message => message.channel.address.decision === ready.id).length, 1);
  const attempts = () => work.detail('owner', id).ciAttempts.filter(item => item.head_sha === sha);
  assert.deepEqual(attempts().filter(item => [4, 5].includes(item.id)).map(item => [item.id, item.conclusion]),
    [[5, 'success'], [4, 'failure']]);
  await accept(sha);
  const accepted = work.detail('owner', id).work;
  assert.equal(accepted.accepted?.commit, sha);
  assert.equal(accepted.delivery?.commits?.find(item => item.sha === sha)?.run?.ticket, id);
  assert.equal(accepted.delivery?.checks?.[0]?.id, 5);
  assert.equal(accepted.delivery?.checks?.[0]?.head_sha, sha);
  // A CI rerun on a signed SHA is also tracked. It cannot change the recorded acceptance.
  remote.checks = [codeCheck(6, { status: 'in_progress', conclusion: null })]; await save(); await refresh();
  assert.equal(attempts().find(item => item.id === 6)?.status, 'in_progress');
  remote.checks = [codeCheck(6, { conclusion: 'failure' })]; await save(); await refresh();
  remote.checks = [codeCheck(6, { status: 'queued', conclusion: null })]; await save(); await refresh();
  assert.deepEqual(attempts().filter(item => [4, 5, 6].includes(item.id)).map(item => [item.id, item.conclusion]),
    [[6, 'failure'], [5, 'success'], [4, 'failure']]);
  assert.equal(work.detail('owner', id).work.delivery?.checks?.[0]?.id, 5);
  assert.equal(work.detail('owner', id).work.accepted?.commit, sha);
  const initialScope = { repository: development.repository, base: development.base, paths: development.paths };
  db.prepare("UPDATE workbench_ticket SET value=json_set(value,'$.developmentApproval',json(?),'$.approvalRequired',json('true')) WHERE id=?")
    .run(JSON.stringify({ actor: 'maker', agent: 'review', scope: digest(initialScope), at: new Date().toISOString(), version: 1 }), id);
  const continuation = { revision: output.revision, kind: 'continued' as const, reason: '仅补 320px 长词换行验收' };
  const savedRuns = work.detail('owner', id).runs.map(run => run.id);
  assert.deepEqual(work.revise('owner', id, continuation), { version: 2 });
  assert.deepEqual(work.revise('owner', id, continuation), { version: 2 });
  const offer = work.needsYou('maker').find(decision => decision.ticket === id && decision.kind === 'development');
  assert.ok(offer);
  assert.match(offer.title, /第 2 版/);
  assert.throws(() => work.approveDevelopment('owner', id, offer.id), { status: 403 });
  assert.throws(() => work.approveDevelopment('maker', id), { status: 409 });
  assert.throws(() => work.approveDevelopment('maker', id, ready.id), { status: 409 });
  await delay(150);
  const continued = work.detail('owner', id);
  assert.deepEqual(continued.runs.map(run => run.id), savedRuns);
  assert.equal(continued.work.developmentApproval, undefined);
  assert.equal(continued.work.deliveryPr?.url, remote.pull.html_url);
  assert.equal(continued.versions[0]?.acceptedSource?.delivery?.commit, sha);
});

test('仓库的多个必需检查全部通过才可验收，第三方同名检查与旧重跑不顶替', () => {
  const required = [{ name: 'lint', app: 'github-actions', appId: 15368 }, { name: 'unit', app: 'github-actions' }];
  const lint = check(10, { name: 'lint' });
  const unit = check(20, { name: 'unit' });
  assert.equal(pullChecks(sha, [lint], required).ci, 'pending');
  assert.equal(pullChecks(sha, [lint, unit], required).ci, 'passed');
  assert.equal(pullChecks(sha, [lint, unit, check(21, { name: 'unit', status: 'in_progress', conclusion: null })], required).ci, 'pending');
  assert.equal(pullChecks(sha, [lint, unit, check(22, { name: 'unit', conclusion: 'failure' })], required).ci, 'failed');
  assert.equal(pullChecks(sha, [unit, check(99, { name: 'lint', app: { id: 123, slug: 'github-actions' } })], required).ci, 'pending');
  assert.equal(pullChecks(sha, [lint, unit], []).ci, 'pending');
  assert.equal(pullChecks(sha, [lint, unit, check(100, { name: 'unit', head_sha: foreign, conclusion: 'failure' })], required).ci, 'passed');
  assert.deepEqual(pullChecks(sha, [lint, unit, check(22, { name: 'unit' })], required).attempts.map(c => c.id), [22, 20, 10]);
});
