import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { freezeDeliveryTemplate } from '../src/workbench/delivery-template.ts';
import { formerName } from '../src/workbench/compatibility.ts';
import { inspectProductVerification } from '../src/workbench/github-product-verification.ts';
import { openProductVerification } from '../src/workbench/product-verification.ts';
import { resourceSchema } from '../src/workbench/project-resources.ts';
import type { DeliveryEvidence, Work } from '../src/workbench/work-types.ts';

test('产品验证只采信本次 Actions job 的固定工作流、提交、报告和全套检查', async () => {
  const folder = new URL('../integrations/github/store-small-screen/', import.meta.url);
  const execution = JSON.parse(await readFile(new URL('pilot-execution.json', folder), 'utf8'));
  const repository = 'test/store';
  const target = resourceSchema.parse({ source: 'github', externalId: repository, state: 'bound', execution });
  const template = freezeDeliveryTemplate(target)!;
  const spec = template.product!.browser!;
  for (const { path, blob } of spec.trustedFiles) {
    const bytes = await readFile(new URL(path, folder));
    assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), blob);
  }
  assert.throws(() => freezeDeliveryTemplate({ ...target, execution: { ...target.execution!, requiredChecks: [] } }), { status: 409 });
  const head = 'a'.repeat(40), old = 'b'.repeat(40);
  const check = { id: 32, name: spec.check.name, head_sha: head, status: 'completed', conclusion: 'success',
    app: { id: spec.check.appId, slug: spec.check.app }, html_url: 'https://github.com/test/store/actions/runs/100/job/32' };
  const delivery: DeliveryEvidence = { repository, repoId: 1, headRepoId: 1, pr: 18, url: 'https://github.com/test/store/pull/18',
    baseSha: old, headSha: head, ci: 'passed', checks: [check] };
  const between = '2026-11-18T10:02:00Z';
  const job = { id: 32, run_id: 100, run_attempt: 2, head_sha: head, name: spec.check.name, status: 'completed', conclusion: 'success',
    started_at: '2026-11-18T10:01:00Z', completed_at: '2026-11-18T10:03:00Z', check_run_url: 'https://api.github.com/repos/test/store/check-runs/32' };
  const run = { id: 100, run_attempt: 2, path: spec.workflow, event: 'push', head_sha: head, status: 'completed',
    repository: { id: 1 }, head_repository: { id: 1 } };
  const artifact = { id: 2, name: spec.artifact + '-' + head + '-attempt-2', expired: false, size_in_bytes: 200, created_at: between };
  const complete = spec.cases.map(({ id }) => ({ id, passed: true, detail: '本版实测记录' }));
  const report = { schema: 1, check: spec.check.name, sha: head, browser: 'Chromium', cases: complete };
  const pins = new Map(spec.trustedFiles.map(item => ['contents/' + item.path + '?ref=' + head, item.blob]));
  let downloaded = 0;
  let downloadedMember: string | undefined;
  const ports = {
    async api(repo: string, route: string) {
      assert.equal(repo, repository);
      if (route === 'actions/jobs/32') return job;
      if (route === 'actions/runs/100/attempts/2') return run;
      assert.ok(pins.has(route), route);
      return { type: 'file', sha: pins.get(route) };
    },
    async listArtifacts(repo: string, id: number, name: string) {
      assert.deepEqual([repo, id, name], [repository, 100, spec.artifact + '-' + head + '-attempt-2']);
      return [{ artifacts: [artifact] }];
    },
    async download(repo: string, id: number, member: string) {
      assert.deepEqual([repo, id], [repository, 2]);
      downloaded++;
      downloadedMember = member;
      return report;
    },
  };
  const inspect = (value = delivery) => inspectProductVerification(template, value, ports);
  assert.equal(await inspect({ ...delivery, headRepoId: 2 }), undefined);
  assert.equal(await inspect({ ...delivery, checks: [{ ...check, head_sha: old }] }), undefined);
  assert.equal(await inspect({ ...delivery, checks: [{ ...check, id: 40 }] }), undefined);
  artifact.name = spec.artifact + '-' + head + '-attempt-1';
  assert.equal(await inspect(), undefined);
  artifact.name = spec.artifact + '-' + head + '-attempt-2';
  run.event = 'pull_request_target';
  assert.equal(await inspect(), undefined);
  run.event = 'push';
  const pin = pins.get('contents/' + spec.workflow + '?ref=' + head)!;
  pins.set('contents/' + spec.workflow + '?ref=' + head, old);
  assert.equal(await inspect(), undefined);
  assert.equal(downloaded, 0);
  pins.set('contents/' + spec.workflow + '?ref=' + head, pin);
  report.sha = old;
  assert.equal(await inspect(), undefined);
  report.sha = head;
  report.cases = [complete[0]!, complete[0]!, complete[1]!];
  assert.equal(await inspect(), undefined);
  report.cases = complete;
  const proof = await inspect();
  assert.ok(proof);
  assert.equal(downloadedMember, 'contractor-verification.json');
  const previousWorkflow = formerName(spec.workflow);
  run.path = previousWorkflow;
  const previousSpec = { ...spec, workflow: previousWorkflow,
    trustedFiles: spec.trustedFiles.map(item => ({ ...item, path: formerName(item.path) })) };
  for (const item of previousSpec.trustedFiles) pins.set('contents/' + item.path + '?ref=' + head, item.blob);
  assert.ok(await inspectProductVerification({ ...template, product: { ...template.product!, browser: previousSpec } }, delivery, ports));
  assert.equal(downloadedMember, formerName('contractor-verification.json'));
  const db = new DatabaseSync(':memory:');
  try {
    const service = openProductVerification(db);
    const work = { deliveryTemplate: template } as Work;
    const revision = 'a'.repeat(64);
    service.recordBrowser('ticket-a', revision, proof);
    service.recordBrowser('ticket-a', revision, proof);
    const input = { case: spec.cases[0]!.id, revision, head, previous: 0, passed: true, note: '可读' };
    service.recordHuman('ticket-a', head, { ...input, case: 'copy-review' }, 'product');
    assert.equal(service.state('ticket-a', revision, work, delivery)?.ready, true);
    assert.equal(service.state('ticket-b', revision, work, delivery)?.ready, false);
    assert.equal(service.state('ticket-a', 'b'.repeat(64), work, delivery)?.ready, false);
    assert.equal(service.state('ticket-a', revision, work, { ...delivery, checks: [{ ...check, id: 40 }] })?.ready, false);
  } finally { db.close(); }
});

test('人工验收打回保留历史，采用的知识只回到同一项目主题，并随失效退出检索', { timeout: 35000 }, async t => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'contractor-product-cycle-'));
  process.env.COLLAB_STATE_DIR = workdir;
  await mkdir(path.join(workdir, 'console'));
  const agent = path.join(workdir, 'agent.mjs');
  await writeFile(agent, `import { readFileSync } from 'node:fs';
const { events } = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));
const cited = events.filter(event => event.type === 'knowledge.source').map(event => event.detail.match(/\\[记忆:[^\\]]+\\]/)?.[0]).join(' ');
console.log('核对门店推荐理由的 280px、320px、360px 验收条件。' + cited);
`);
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  const password = randomUUID();
  await auth.bootstrapOwner('product', password);
  await auth.createAccount('engineering', password, 'operator', 'product');
  await auth.createAccount('outsider', password, 'operator', 'product');
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'engineering'], maintainers: ['product'],
      topics: [{ id: 'small-screen', title: '小屏换行' }, { id: 'copy', title: '文案' }] }],
    functions: [{ id: 'review', title: '核对推荐卡' }],
    agents: [{ id: 'review', title: '核对 Agent', kind: 'personal', owner: 'engineering', projects: ['store'], active: true,
      function: 'review', execution: { kind: 'test', provider: 'fixture' }, engine: 'command',
      command: [process.execPath, agent], capability: '小屏核对', skill: '按本版范围处理。' }],
  });
  const work = await openCollaboration(config, auth);
  t.after(async () => { await work.close(); await rm(workdir, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined | null) {
    for (let index = 0; index < 140; index++) {
      const row = read();
      if (row) return row;
      await delay(100);
    }
    assert.fail('未收到 AutoLoop 本轮成果');
  }
  const cases = [{ title: '小屏长词可读', expectation: '三个视口连续长词可换行，页面和正文不横向溢出。' }];
  const start = (topic = 'small-screen', productCases?: typeof cases) => {
    const request = work.start('product', { project: 'store', topic, title: '门店推荐理由小屏验收',
      request: '核对门店推荐理由的 280px 320px 360px 长词', nonce: randomUUID(), agent: 'review',
      priority: 'normal', material: [], recall: true, productCases });
    return wait(() => work.resolveStart('product', request.trigger));
  };
  const id = await start('small-screen', cases);
  const detail = () => work.detail('product', id);
  const first = await wait(() => detail().result);
  const firstSnapshot = work.executionSnapshot('product', id, first.run, first.attempt);
  assert.equal(firstSnapshot.review?.receipt, 'done');
  assert.equal(firstSnapshot.review?.model.state, 'unverified');
  assert.equal(firstSnapshot.review?.delivery?.revision, first.revision);
  assert.equal(firstSnapshot.review?.delivery?.accepted, false);
  assert.equal(detail().actions.accept, false);
  assert.equal(detail().productVerification?.cases[0]?.state, 'pending');
  const review = { revision: first.revision, case: 'task-1', passed: false, previous: 0, note: '280px 可用正文太窄' };
  assert.throws(() => work.recordProductCheck('engineering', id, review), { status: 403 });
  assert.throws(() => work.recordProductCheck('outsider', id, review), { status: 404 });
  assert.deepEqual(work.recordProductCheck('product', id, review), work.recordProductCheck('product', id, review));
  assert.throws(() => work.recordProductCheck('product', id, { ...review, note: '迟到核对' }), { status: 409 });
  await assert.rejects(work.accept('product', id, first.revision, '', ''), { status: 409 });
  const reopen = { revision: first.revision, reason: '仅重做 280px 正文宽度核对' };
  assert.deepEqual(work.revise('product', id, reopen), { version: 2 });
  assert.deepEqual(work.revise('product', id, reopen), { version: 2 });
  const second = await wait(() => detail().result?.version === 2 ? detail().result : undefined);
  const baseline = { ticket: id, revision: first.revision }, challenger = { ticket: id, revision: second.revision };
  const definition = { title: '复查 280px 正文宽度', baseline, check: { kind: 'manual' as const, id: 'task-1' } };
  assert.throws(() => work.createRegressionCase('engineering', 'store', definition), { status: 403 });
  assert.throws(() => work.regressionList('outsider', 'store'), { status: 404 });
  const testcase = work.createRegressionCase('product', 'store', definition);
  assert.equal(testcase.baselineReview.status, 'failed');
  assert.deepEqual(work.createRegressionCase('product', 'store', definition), testcase);
  assert.throws(() => work.compareRegression('product', 'store', { case: testcase.id, candidate: baseline }), { status: 409 });
  const compare = () => work.compareRegression('product', 'store', { case: testcase.id, candidate: challenger });
  assert.equal(compare().candidate.status, 'unavailable');
  assert.equal(detail().versions.find(row => row.version === 1)?.reviews[0]?.product?.cases[0]?.state, 'failed');
  assert.throws(() => work.recordProductCheck('product', id, review), { status: 409 });
  assert.equal(detail().productVerification?.cases[0]?.state, 'pending');
  work.recordProductCheck('product', id, { ...review, revision: second.revision, passed: true, note: '三档均可读并换行' });
  const evaluation = compare();
  assert.equal(evaluation.candidate.status, 'passed');
  assert.deepEqual(compare(), evaluation);
  assert.equal(evaluation.candidate.provenance.agent, 'review');
  assert.equal(evaluation.candidate.provenance.prompt.length, 64);
  assert.equal(evaluation.candidate.provenance.reportedModel, undefined);
  assert.deepEqual(work.regressionList('engineering', 'store').comparisons.map(row => row.candidate.status), ['passed', 'unavailable']);
  await assert.rejects(work.accept('product', id, first.revision, '', ''), { status: 409 });
  await work.accept('product', id, second.revision, '仅用于门店推荐卡片', '门店推荐理由核验 280px、320px、360px 和长词换行。');
  await work.accept('product', id, second.revision, '', '');
  assert.equal(work.executionSnapshot('product', id, second.run, second.attempt).review?.delivery?.accepted, true);
  assert.deepEqual(compare(), evaluation, '接受后同一证据不重复登记对照');
  const candidate = work.browse('product', 'store', '').find(row => row.id === detail().candidate);
  assert.ok(candidate && 'revision' in candidate && candidate.revision);
  assert.equal(work.topicRules('engineering', 'store', 'small-screen').length, 0);
  await work.publish('product', candidate.id, candidate.revision);
  assert.equal(work.topicRules('engineering', 'store', 'small-screen')[0]?.source?.version, 2);
  assert.equal(work.topicRules('engineering', 'store', 'copy').length, 0);
  assert.throws(() => work.topicRules('outsider', 'store', 'small-screen'), { status: 404 });
  const next = await start();
  const nextDetail = () => work.detail('product', next);
  const nextResult = await wait(() => nextDetail().result);
  assert.equal(nextDetail().reusedAcceptance?.id, candidate.id);
  assert.equal(nextDetail().result?.citations[0]?.acceptedSource?.version, 2);
  const other = await start('copy');
  assert.equal(work.detail('product', other).reusedAcceptance, undefined);
  assert.ok(!work.detail('product', other).work.material.includes(candidate.id));
  const otherResult = await wait(() => work.detail('product', other).result);
  const answerCase = work.createRegressionCase('product', 'store', { title: '三档都要列出并附来源', baseline,
    check: { kind: 'answer', terms: ['280px', '320px', '360px'], citation: true } });
  assert.equal(answerCase.baselineReview.status, 'failed');
  assert.throws(() => work.compareRegression('product', 'store', { case: answerCase.id,
    candidate: { ticket: other, revision: otherResult.revision } }), { status: 409 });
  assert.equal(work.compareRegression('product', 'store', { case: answerCase.id,
    candidate: { ticket: next, revision: nextResult.revision } }).candidate.status, 'passed');

  const source = work.addKnowledge('product', 'store', { title: '门店受限样例', body: '仅供验收回归试点使用。',
    conditions: '本项目定向授权', kind: 'document', visibility: 'restricted' });
  const restricted = work.start('product', { project: 'store', topic: 'small-screen', title: '限制样例核对',
    request: '核对门店推荐理由的 280px 320px 360px 长词', agent: 'review', nonce: randomUUID(),
    priority: 'normal', material: [source] });
  const restrictedId = await wait(() => work.resolveStart('product', restricted.trigger));
  const restrictedAccess = await wait(() => work.detail('product', restrictedId).requests.find(row => row.entry === source));
  work.changeAccess('product', restrictedId, restrictedAccess.id, 'granted');
  const restrictedOutput = await wait(() => work.detail('product', restrictedId).result);
  const restrictedCandidate = { ticket: restrictedId, revision: restrictedOutput.revision };
  work.compareRegression('product', 'store', { case: answerCase.id, candidate: restrictedCandidate });
  assert.equal(work.regressionList('product', 'store').comparisons.some(row => row.candidate.ticket === restrictedId), true);
  work.changeAccess('product', restrictedId, restrictedAccess.id, 'revoked');
  assert.equal(work.regressionList('product', 'store').comparisons.some(row => row.candidate.ticket === restrictedId), false);
  assert.throws(() => work.compareRegression('product', 'store', { case: answerCase.id, candidate: restrictedCandidate }), { status: 404 });
  assert.equal(work.executionSnapshot('product', restrictedId, restrictedOutput.run, restrictedOutput.attempt).review, undefined);

  work.invalidateKnowledge('product', candidate.id, candidate.revision, '更换验收口径');
  assert.equal(work.regressionList('product', 'store').comparisons.some(row => row.candidate.ticket === next), true);
  assert.equal(nextDetail().reusedAcceptance, undefined);
  assert.equal(work.topicRules('product', 'store', 'small-screen').length, 0);
  assert.equal(detail().versions.find(row => row.version === 2)?.acceptedSource?.product?.cases.length, 1);
});
