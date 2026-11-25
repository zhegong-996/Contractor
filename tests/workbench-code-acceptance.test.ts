import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { checkRunLabel } from '../workbench/src/check-run-label.ts';
import type { PullCheck } from '../src/workbench/github-delivery.ts';
import { digest } from '../src/workbench/knowledge.ts';
import type { OutboundMessage } from '../upstream/superagent/src/core/index.ts';
import { deliveryTemplates } from '../src/workbench/delivery-template.ts';
import type { DeliveryEvidence } from '../src/workbench/work-types.ts';

const directory = await mkdtemp(path.join(os.tmpdir(), 'contractor-code-acceptance-'));
process.env.COLLAB_STATE_DIR = directory;
const { pullChecks } = await import('../src/workbench/github-delivery.ts');

const sha = 'a'.repeat(40), base = 'b'.repeat(40), foreign = 'c'.repeat(40);
const check = (id: number, change: Partial<PullCheck> = {}): PullCheck => ({ id, name: 'collab-pilot',
  head_sha: sha, status: 'completed', conclusion: 'success', app: { id: 15368, slug: 'github-actions' }, ...change });

test('检查的原始结论与本版 CI 门禁分别呈现', () => {
  for (const [conclusion, label] of [['cancelled', '已取消'], ['timed_out', '超时'], ['skipped', '已跳过'],
    ['action_required', '需要人工处理'], ['neutral', '中性结果'], ['failure', '失败']]) {
    assert.equal(checkRunLabel('completed', conclusion), label);
    assert.equal(pullChecks(sha, [check(1), check(2, { conclusion })]).ci, 'failed');
  }
  assert.equal(checkRunLabel('in_progress', null), '运行中');
  assert.equal(checkRunLabel('completed', null), '已结束，结论待核对');
});

test('版本 CI 只采信当前 SHA 的原生 Actions 最新检查，缺少或进行中均不可验收', () => {
  assert.equal(pullChecks(sha, []).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1, { head_sha: foreign })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1, { app: { id: 1, slug: 'untrusted-app' } })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1), check(2, { status: 'in_progress', conclusion: null })]).ci, 'pending');
  assert.equal(pullChecks(sha, [check(1), check(2, { conclusion: 'failure' })]).ci, 'failed');
  assert.equal(pullChecks(sha, [check(1), check(2, { conclusion: 'cancelled' })]).ci, 'failed');
  assert.deepEqual(pullChecks(sha, [check(1), check(2)]).checks.map(item => item.id), [2]);
});

test('交付检查按版本冻结，失败只重核相应证据；独立审查、CI、部署与权限均核对后才验收', { timeout: 35000 }, async t => {
  // Local admission regression: real native lifecycle, trusted ledger fixtures, mocked GitHub transport.
  // Live Codex, Git and GitHub evidence is collected separately by the integration journey.
  const oldPath = process.env.PATH;
  process.env.COLLAB_STATE_DIR = directory;
  process.env.PATH = directory + path.delimiter + oldPath;
  await mkdir(path.join(directory, 'console'));
  const remoteFile = path.join(directory, 'remote.json');
  const statusRead = path.join(directory, 'status-read');
  const readPaused = path.join(directory, 'acceptance-check-paused');
  const readReleased = path.join(directory, 'acceptance-check-released');
  const reportPath = path.join(directory, 'contractor-verification.json');
  const archive = path.join(directory, 'product-proof.zip');
  const github = path.join(directory, 'gh');
  await writeFile(github, '#!' + process.execPath + '\n'
    + 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(' + JSON.stringify(remoteFile) + ', "utf8"));\n'
    + 'const route = process.argv[3]; let result;\n'
    + 'if (/\\/actions\\/artifacts\\/\\d+\\/zip$/.test(route)) {process.stdout.write(fs.readFileSync('
    + JSON.stringify(archive) + ')); process.exit(0);}\n'
    + 'if (Object.hasOwn(data.github,route)) result = data.github[route];\n'
    + 'else if (route.includes("/check-runs?")) result = [{check_runs:data.checks}];\n'
    + 'else if (route.includes("/commits?")) result = [data.commits];\n'
    + 'else if (route.includes("/reviews?")) result = [data.reviews || []];\n'
    + 'else if (route.includes("/activity?")) result = [];\n'
    + 'else if (route.includes("/deployments?")) result = data.deployments;\n'
    + 'else if (route.includes("/statuses?")) {\n'
    + '  const marker = ' + JSON.stringify(statusRead) + ';\n'
    + '  result = data.statusDuringRead && fs.existsSync(marker) ? [data.statusDuringRead] : data.deploymentStatuses;\n'
    + '  if (data.statusDuringRead) fs.writeFileSync(marker, "");\n'
    + '}\n'
    + 'else if (/\\/pulls\\/\\d+$/.test(route)) {\n'
    + '  if (data.pausePullRead) { const pause = ' + JSON.stringify(readPaused) + ', release = ' + JSON.stringify(readReleased) + ';\n'
    + '    fs.writeFileSync(pause, ""); const until = Date.now() + 5000;\n'
    + '    while (!fs.existsSync(release) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);\n'
    + '  } result = data.pull;\n'
    + '}\n'
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
  await auth.createAccount('auditor', 'only-for-unit-test', 'operator', 'owner');
  const requiredName = 'store-mobile-layout';
  const codeCheck = (id: number, change: Partial<PullCheck> = {}) => check(id, { name: requiredName, ...change });
  const config = settingsSchema.parse({
    feishu: { appId: 'app', botId: 'bot', profile: 'test' },
    projects: [{ id: 'store', title: '门店推荐理由', members: ['owner', 'maker', 'auditor'], maintainers: ['owner'],
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
  for (const [member, native] of [['maker', '1'], ['auditor', '2'], ['maker', '3']] as const) {
    const account = { provider: 'github' as const, namespace: 'github.com', id: native, label: member + native };
    work.proveAccount(work.accountProof(member, 'github').command.split(' ')[1]!, account);
    work.confirmAccount(member, 'github', account);
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
    branch: 'contractor/' + id, baseSha: base, commit: sha };
  db.prepare('UPDATE workbench_ticket SET value=? WHERE id=?').run(JSON.stringify({ ...original,
    development: { repository: development.repository, base: development.base, paths: development.paths } }), id);
  const manifest = JSON.parse(String(db.prepare('SELECT value FROM workbench_manifest WHERE run=?').get(output.run)!.value));
  db.prepare('UPDATE workbench_manifest SET value=? WHERE run=?').run(JSON.stringify({ ...manifest, development }), output.run);
  const identity = { id: 1, login: 'maker', type: 'User' };
  const repository = { id: 100, full_name: 'team/test' };
  const remote = {
    pull: { number: 1, html_url: 'https://github.com/team/test/pull/1', body: 'Contractor-Work: ' + id,
      base: { sha: base, ref: 'main', repo: repository }, head: { sha, ref: development.branch, repo: repository },
      user: identity, state: 'open', draft: false, merged: false, created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z', merged_at: null, requested_reviewers: [], assignees: [], labels: [] },
    commits: [{ sha, author: identity, committer: identity }], checks: [codeCheck(1)], reviews: [] as NonNullable<DeliveryEvidence['reviews']>,
    deployments: [] as { id: number; sha: string; environment: string }[],
    deploymentStatuses: [] as { id: number; state: string; environment: string; created_at: string }[],
    statusDuringRead: undefined as { id: number; state: string; environment: string; created_at: string } | undefined,
    pausePullRead: false,
    github: {} as Record<string, unknown>,
  };
  const save = () => writeFile(remoteFile, JSON.stringify(remote));
  const accept = (commit?: string, deployed?: { id: number; statusId: number }) => work.accept('owner', id, output.revision, '本轮范围', '', commit, deployed);
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
  remote.pull.head.ref = 'contractor/another-ticket'; await save();
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
  const pendingVersion = work.detail('owner', id);
  assert.equal(pendingVersion.deliveryStatus?.state, 'ci-pending');
  assert.equal(pendingVersion.responsibility.deliveryLead, 'maker');
  assert.equal(pendingVersion.currentEvidence, true);
  assert.equal(pendingVersion.mayReadChanges, true);
  assert.equal(work.detail('auditor', id).mayReadChanges, false);
  await assert.rejects(work.ticketChanges('auditor', id), { status: 403 });
  await assert.rejects(work.ticketChanges('owner', id, { head: foreign }), { status: 409 });
  assert.equal(pending('owner', 'acceptance'), undefined);
  assert.equal(pending('maker', 'delivery'), undefined);
  await assert.rejects(accept(), /代码工单必须/);
  await assert.rejects(work.accept('maker', id, output.revision, '', '', sha), /当前版本的验收人/);
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
  assert.equal(work.detail('owner', id).lastGreen, sha);
  assert.equal(work.detail('owner', id).actions.accept, false);
  assert.equal(pending('owner', 'acceptance'), undefined);
  remote.checks = [codeCheck(5)]; await save(); await refresh();
  assert.equal(pending('owner', 'acceptance')?.id, ready.id);
  assert.equal(messages.filter(message => message.channel.address.decision === ready.id).length, 1);
  const attempts = () => work.detail('owner', id).ciAttempts.filter(item => item.head_sha === sha);
  assert.deepEqual(attempts().filter(item => [4, 5].includes(item.id)).map(item => [item.id, item.conclusion]),
    [[5, 'success'], [4, 'failure']]);

  const target = config.projects[0]!.resources[0]!;
  const execution = target.execution!;
  const frozen = deliveryTemplates(db);
  const initialChecks = execution.requiredChecks!;
  execution.requiredChecks = [...initialChecks, { name: 'asset-lint', app: 'github-actions' }];
  execution.deliveryTemplate = { id: 'store-layout', version: 1, reviewerIds: [1, 2, 3] };
  const versionOne = frozen('store', target)!;
  db.prepare("UPDATE workbench_ticket SET value=json_set(value,'$.deliveryTemplate',json(?)) WHERE id=?").run(JSON.stringify(versionOne), id);
  execution.requiredChecks = [{ ...initialChecks[0]!, name: 'store-mobile-layout-v2' }];
  assert.throws(() => frozen('store', target), { status: 409 });
  execution.deliveryTemplate.version = 2;
  assert.equal(frozen('store', target)?.checks[0]?.name, 'store-mobile-layout-v2');
  const review = (id: number, actor: number, commit = sha, state = 'APPROVED') => ({ id, state, commit_id: commit,
    user: { id: actor, login: 'reviewer' + actor, type: 'User' }, html_url: remote.pull.html_url + '#pullrequestreview-' + id,
    submitted_at: '2026-11-02T00:00:00Z' });
  const recheck = (head = sha, revision = output.revision) => work.recheckDelivery('owner', id, { head, revision });
  const runsBefore = work.detail('owner', id).runs.map(run => run.id);
  await assert.rejects(recheck(foreign), { status: 409 });
  await assert.rejects(recheck(sha, '0'.repeat(64)), { status: 409 });
  remote.checks = [codeCheck(8, { conclusion: 'failure' }), codeCheck(9, { head_sha: foreign }),
    codeCheck(10, { name: 'store-mobile-layout-v2' }), codeCheck(7, { name: 'asset-lint' })];
  remote.reviews = [review(1, 2, foreign), review(2, 1), review(3, 3)];
  await save();
  assert.equal((await recheck()).deliveryStatus?.state, 'ci-failed');
  assert.equal(pending('owner', 'acceptance'), undefined);
  assert.deepEqual(work.detail('owner', id).deliveryVerification?.checks.map(c => [c.name, c.id, c.state]),
    [[requiredName, 8, 'failed'], ['asset-lint', 7, 'passed']]);
  remote.checks.push(codeCheck(11));
  await save();
  const tested = await recheck();
  assert.equal(tested.deliveryStatus?.state, 'review-pending');
  assert.deepEqual(tested.deliveryVerification?.checks.map(c => [c.name, c.id, c.state]),
    [[requiredName, 11, 'passed'], ['asset-lint', 7, 'passed']]);
  await assert.rejects(accept(sha), /尚未通过独立审查/);
  remote.reviews.push(review(4, 2, sha, 'CHANGES_REQUESTED'));
  await save();
  assert.equal((await recheck()).deliveryStatus?.state, 'review-failed');
  remote.reviews.push(review(5, 2));
  await save();
  const approved = await recheck();
  assert.equal(approved.deliveryStatus?.state, 'ready');
  assert.equal(approved.deliveryVerification?.version, 1);
  assert.equal(approved.deliveryVerification?.review?.id, 5);
  assert.equal(approved.deliveryVerification?.mayRecheck, true);
  assert.equal(work.detail('maker', id).deliveryVerification?.mayRecheck, true);
  assert.equal(work.detail('auditor', id).deliveryVerification?.mayRecheck, false);
  await assert.rejects(work.recheckDelivery('auditor', id, { head: sha, revision: output.revision }), { status: 403 });
  work.setProjectMemberRole('owner', 'store', 'auditor', 'reader');
  await assert.rejects(accept(sha), /尚未通过独立审查/);
  work.setProjectMemberRole('owner', 'store', 'auditor', 'collaborator');
  await recheck();
  assert.deepEqual(work.detail('owner', id).runs.map(run => run.id), runsBefore);
  assert.equal(messages.filter(message => message.channel.address.decision === ready.id).length, 1);
  db.prepare("UPDATE workbench_ticket SET value=json_remove(value,'$.deliveryTemplate') WHERE id=?").run(id);
  execution.requiredChecks = initialChecks;
  execution.deliveryTemplate = undefined;
  remote.checks = [codeCheck(5)];
  remote.reviews = [];
  // A separately served preview artifact proves what is available at the test endpoint.
  // The GitHub REST record remains controlled so this test cannot publish an application.
  const environment = 'store-preview';
  let served = foreign;
  const preview = createServer((_req, res) => res.writeHead(200, { 'x-build-sha': served }).end('门店推荐理由 · ' + served));
  preview.listen(0, '127.0.0.1');
  await once(preview, 'listening');
  t.after(() => preview.close());
  const address = preview.address();
  assert.ok(address && typeof address !== 'string');
  const servedVersion = async () => {
    const response = await fetch('http://127.0.0.1:' + address.port);
    assert.match(await response.text(), /门店推荐理由/);
    return response.headers.get('x-build-sha');
  };
  config.projects[0]!.resources[0]!.execution!.requiredDeployment = { environment };
  const status = (id: number, state: string, target = environment) => ({ id, state, environment: target, created_at: '2026-11-01T00:00:00Z' });
  await refresh();
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'deployment-pending');
  assert.deepEqual(work.detail('owner', id).deploymentGate, { environment, selection: undefined });
  assert.equal(pending('owner', 'acceptance'), undefined);
  await assert.rejects(accept(sha), /部署环境、版本或状态/);
  assert.equal(await servedVersion(), foreign);
  remote.deployments = [{ id: 12, sha: foreign, environment }]; remote.deploymentStatuses = [status(22, 'success')];
  await save(); await refresh();
  await assert.rejects(accept(sha, { id: 12, statusId: 22 }), /部署环境、版本或状态/);
  served = sha;
  assert.equal(await servedVersion(), sha);
  remote.deployments = [{ id: 14, sha, environment: 'other-preview' }]; remote.deploymentStatuses = [status(23, 'success', 'other-preview')];
  await save(); await refresh();
  await assert.rejects(accept(sha), /部署环境、版本或状态/);
  remote.deployments = [{ id: 15, sha, environment }]; remote.deploymentStatuses = [status(25, 'failure')];
  await save(); await refresh();
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'deployment-failed');
  await assert.rejects(accept(sha, { id: 15, statusId: 25 }), /部署环境、版本或状态/);
  remote.deploymentStatuses = [status(26, 'success')]; await save(); await refresh();
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'ready');
  assert.equal(pending('owner', 'acceptance')?.id, ready.id);
  await assert.rejects(accept(sha), /部署环境、版本或状态/);
  remote.statusDuringRead = status(27, 'inactive'); await save();
  await assert.rejects(accept(sha, { id: 15, statusId: 26 }), { status: 409, message: /部署状态正在更新/ });
  remote.statusDuringRead = undefined;
  remote.deploymentStatuses = [status(27, 'inactive')]; await save();
  await assert.rejects(accept(sha, { id: 15, statusId: 26 }), /部署环境、版本或状态/);
  // Even for the same SHA, a new deployment must be refreshed before signing.
  remote.deployments = [{ id: 16, sha, environment }]; remote.deploymentStatuses = [status(28, 'success')];
  await save();
  await assert.rejects(accept(sha, { id: 15, statusId: 26 }), /部署环境、版本或状态/);
  await refresh();
  assert.equal(messages.filter(message => message.channel.address.decision === ready.id).length, 1);
  await assert.rejects(accept(sha, { id: 15, statusId: 26 }), /部署环境、版本或状态/);
  const gate = work.detail('owner', id).deploymentGate;
  assert.deepEqual(gate, { environment, selection: { id: 16, statusId: 28 } });
  // A requester moved to read-only while GitHub is being read cannot sign or create knowledge.
  work.transferProjectMaintainer('owner', 'store', 'maker');
  remote.pausePullRead = true;
  await save();
  const deniedDuringRead = assert.rejects(accept(sha, gate?.selection), { status: 403, message: /当前版本的验收人/ });
  try {
    await wait(() => existsSync(readPaused) || undefined);
    work.setProjectMemberRole('maker', 'store', 'owner', 'reader');
  } finally {
    await writeFile(readReleased, '');
  }
  await deniedDuringRead;
  assert.equal(work.detail('owner', id).work.accepted, undefined);
  assert.equal(work.detail('owner', id).candidate, undefined);
  work.setProjectMemberRole('maker', 'store', 'owner', 'collaborator');
  work.transferProjectMaintainer('maker', 'store', 'owner');
  remote.pausePullRead = false;
  const productCheck = { name: 'store-browser-verification', app: 'github-actions' as const, appId: 15368 };
  const workflow = '.github/workflows/store-browser.yml';
  const spec = { id: 'viewport-280', title: '280px 长词', expectation: '正文无溢出，且至少 244px' };
  execution.requiredChecks = [...initialChecks, productCheck];
  execution.deliveryTemplate = { id: 'store-layout', version: 3, product: {
    browser: { workflow, check: productCheck, trustedFiles: [{ path: workflow, blob: base }], artifact: 'store-layout', cases: [spec] },
    manual: [{ id: 'audience-copy', title: '现场可读', expectation: '确认原文案清晰可读' }],
  } };
  db.prepare("UPDATE workbench_ticket SET value=json_set(value,'$.deliveryTemplate',json(?)) WHERE id=?")
    .run(JSON.stringify(frozen('store', target)), id);
  await writeFile(reportPath, JSON.stringify({ schema: 1, sha, check: productCheck.name, browser: 'Chromium',
    cases: [{ id: spec.id, passed: true, detail: '正文 244px，连续长词可换行' }] }));
  execFileSync('zip', ['-q', '-j', archive, reportPath]);
  const ciBrowser = (job: number, attempt: number) => {
    remote.checks.push(codeCheck(job, { name: productCheck.name, html_url: 'https://github.com/team/test/actions/runs/77/job/' + job }));
    remote.github['repos/team/test/actions/jobs/' + job] = { id: job, run_id: 77, run_attempt: attempt, head_sha: sha,
      name: productCheck.name, status: 'completed', conclusion: 'success', started_at: '2026-11-01T00:00:00Z',
      completed_at: '2026-11-01T00:10:00Z', check_run_url: 'https://api.github.com/repos/team/test/check-runs/' + job };
    remote.github['repos/team/test/actions/runs/77/attempts/' + attempt] = { id: 77, run_attempt: attempt, path: workflow, event: 'push',
      head_sha: sha, status: 'completed', repository, head_repository: repository };
    remote.github['repos/team/test/contents/' + workflow + '?ref=' + sha] = { type: 'file', sha: base };
    const name = 'store-layout-' + sha + '-attempt-' + attempt;
    const artifactRoute = 'repos/team/test/actions/runs/77/artifacts?per_page=100&name=' + name;
    remote.github[artifactRoute] = [{ artifacts: [] }];
    return () => { remote.github[artifactRoute] = [{ artifacts: [{ id: job + 100, name, created_at: '2026-11-01T00:05:00Z',
      expired: false, size_in_bytes: 485 }] }]; };
  };
  const firstProof = ciBrowser(100, 1);
  await save(); await refresh();
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'verification-missing');
  await assert.rejects(accept(sha, gate?.selection), /先核对本版产品验收/);
  firstProof();
  await save(); await recheck();
  assert.equal(work.detail('owner', id).productVerification?.cases[0]?.state, 'passed');
  assert.equal(work.detail('owner', id).productVerification?.execution?.proof?.attempt, 1);
  await assert.rejects(accept(sha, gate?.selection), /先核对本版产品验收/);
  const human = { revision: output.revision, case: 'audience-copy', previous: 0, passed: true, note: '已核对原文案和小屏可读性', head: sha };
  assert.throws(() => work.recordProductCheck('maker', id, human), { status: 403 });
  assert.throws(() => work.recordProductCheck('owner', id, { ...human, head: foreign }), { status: 409 });
  work.recordProductCheck('owner', id, human);
  const secondProof = ciBrowser(101, 2);
  await save();
  await assert.rejects(accept(sha, gate?.selection), /需求验收证据已变化/);
  await recheck();
  assert.equal(work.detail('owner', id).deliveryStatus?.state, 'verification-missing');
  secondProof();
  await save(); await recheck(); await recheck();
  assert.equal(work.detail('owner', id).productVerification?.execution?.proof?.attempt, 2);
  assert.equal(Number(db.prepare('SELECT count(*) AS rows FROM workbench_product_browser WHERE ticket=?').get(id)?.rows), 2);
  await save();
  await accept(sha, gate?.selection);
  await accept(sha, { id: 16, statusId: 28 });
  await assert.rejects(accept(foreign, { id: 16, statusId: 28 }), { status: 409, message: /提交与本版验收记录/ });
  await assert.rejects(accept(sha, { id: 15, statusId: 26 }), /已验收的部署/);
  const accepted = work.detail('owner', id).work;
  assert.equal(accepted.accepted?.commit, sha);
  assert.equal(accepted.delivery?.commits?.find(item => item.sha === sha)?.run?.ticket, id);
  assert.equal(accepted.delivery?.checks?.[0]?.id, 5);
  assert.equal(accepted.delivery?.checks?.[0]?.head_sha, sha);
  assert.deepEqual([accepted.delivery?.deployed?.id, accepted.delivery?.deployed?.sha, accepted.delivery?.deployed?.status?.id], [16, sha, 28]);
  assert.equal(work.detail('owner', id).versions[0]?.acceptedSource?.delivery?.deployment?.id, 16);
  assert.equal(work.detail('owner', id).versions[0]?.acceptedSource?.product?.execution?.attempt, 2);
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
