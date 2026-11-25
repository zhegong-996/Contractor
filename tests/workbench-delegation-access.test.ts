import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('受限子单单独授权，旧执行退出后接续，两项齐备才出现一项主单验收待办', { timeout: 24000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-delegation-access-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const script = path.join(state, 'worker.mjs');
  const events = ['rules', 'delivery'].map(fn => ({ id: fn, type: 'contractor.delegate', summary: '项目核对',
    detail: JSON.stringify({ function: fn, title: fn, request: '只读核对' }) }));
  const proposal = ['等待两项结果', '```agent-autoloop', JSON.stringify({ events }), '```'].join('\n');
  await writeFile(script, [
    "import { readFileSync } from 'node:fs';",
    "const events = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8')).events;",
    "const role = process.argv[2];",
    "if (role === 'summary') console.log(events.some(e => e.type === 'task.child-results') ? '三档通过，交付证据已核对。' : " + JSON.stringify(proposal) + ");",
    "if (role === 'rules') console.log('三档通过。');",
    "if (role === 'delivery') { if (events.filter(e => e.type === 'knowledge.source').length !== 1) process.exit(1); await new Promise(r => setTimeout(r, 1300)); console.log('交付证据已核对。'); }",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'fixture-password-only');
  await auth.createAccount('engineering', 'fixture-password-only', 'operator', 'product');
  const roles = ['summary', 'rules', 'delivery'];
  const cfg = settingsSchema.parse({
    workbenchPublicUrl: 'https://suite.example',
    feishu: { profile: 'fixture', appId: 'app', botId: 'ou_bot', decisionCards: true },
    projects: [{ id: 'store', title: '门店', members: ['product', 'engineering'], maintainers: ['product'] }],
    functions: roles.map(id => ({ id, title: id })),
    agents: roles.map(id => ({
      id, title: id, function: id, projects: ['store'], owner: id === 'delivery' ? 'engineering' : 'product',
      kind: 'specialist', engine: 'command', command: [process.execPath, script, id],
      execution: { kind: 'test', provider: 'fixture' }, active: true, capability: '只读核对', skill: '依据本工单资料',
    })),
  });
  const sent: string[] = [], updated: string[] = [];
  const work = await openCollaboration(cfg, auth, undefined, {
    async send(target, _key, body) {
      assert.ok('user' in target);
      sent.push(body);
      return { ref: 'om_inbox', chat: 'oc_inbox' };
    },
    async update(ref, body) { assert.equal(ref, 'om_inbox'); updated.push(body); },
  });
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const account = { provider: 'feishu' as const, namespace: 'app', id: 'ou_product', label: 'product' };
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, account));
  work.confirmAccount('product', 'feishu', account);
  const material = (title: string, visibility: 'project' | 'restricted') => work.addKnowledge('product', 'store',
    { title, visibility, kind: 'reference', body: '测试资料 ' + title, conditions: '联调' });
  const publicRules = material('公开规则', 'project');
  const privateDelivery = material('仅授权的交付证据', 'restricted');
  cfg.projects[0]!.delegations = [
    { from: 'summary', to: 'rules', maxChildren: 2, maxDepth: 1, scope: { title: '核对规则', request: '只看规则', material: [publicRules] } },
    { from: 'summary', to: 'delivery', maxChildren: 2, maxDepth: 1,
      scope: { title: '核对交付', request: '只看交付', allowRestricted: true, material: [privateDelivery] } },
  ];
  async function until<T>(fn: () => T | undefined | false) {
    for (let i = 0; i < 140; i++) { const result = fn(); if (result) return result; await delay(50); }
    assert.fail('等待工单状态超时');
  }
  const get = (id: string) => work.detail('product', id);
  const accept = (id: string, revision: string) => work.accept('product', id, revision, '仅本测试', '');
  const start = work.start('product', { project: 'store', agent: 'summary', title: '小屏联合核对', request: '两项齐备才汇总',
    priority: 'normal', nonce: randomUUID(), material: [publicRules, privateDelivery] });
  const parent = await until(() => work.resolveStart('product', start.trigger));
  const parentGrant = await until(() => get(parent).requests[0]);
  work.changeAccess('product', parent, parentGrant.id, 'granted');
  const intakes = await until(() => {
    const items = work.needsYou('product').filter(row => row.ticket === parent && row.kind === 'intake');
    return items.length === 2 && items;
  });
  const open = (agent: string) => work.resolveIntake('product',
    intakes.find(row => row.request?.function === agent)!.subject, { action: 'create', agent }).ticket!;
  const rules = open('rules'), delivery = open('delivery');
  assert.equal(open('delivery'), delivery);
  const grant = await until(() => get(delivery).requests[0]);
  assert.notEqual(grant.id, parentGrant.id);
  assert.equal(get(delivery).runs.length, 0);
  work.changeAccess('product', delivery, grant.id, 'granted');
  const running = await until(() => {
    const run = get(delivery).runs.find(row => row.state === 'claimed' && row.attribution);
    if (!run) return;
    try {
      return work.executionSnapshot('engineering', delivery, run.id).readable && run;
    } catch (error) {
      // AutoLoop claims the run before Contractor records its authorized context.
      if ((error as { status?: number }).status !== 404) throw error;
    }
  });
  work.changeAccess('product', delivery, grant.id, 'revoked');
  assert.equal(work.executionSnapshot('engineering', delivery, running.id).readable, false);
  await until(() => get(delivery).runs[0]?.state === 'cancelled');
  await accept(rules, (await until(() => get(rules).result)).revision);
  assert.equal(get(parent).result, undefined);
  assert.equal(get(parent).recovery?.kind, 'child-results-pending');
  await until(() => get(parent).requiredChildren.find(row => row.child === rules)?.ready);
  assert.equal(get(parent).requiredChildren.length, 2);
  assert.equal(get(parent).requiredChildren.find(row => row.child === delivery)?.ready, false);
  assert.equal(get(parent).runs.length, 1);
  assert.ok(!work.needsYou('product').some(row => row.ticket === parent && row.kind === 'acceptance'));
  const retry = { nonce: randomUUID(), reason: '重新申请原子单访问', version: 1 };
  for (let i = 0; i < 2; i++) assert.equal(work.resume('product', delivery, retry).waiting, 'execution-access');
  const renewal = get(delivery).requests.find(row => row.state === 'requested')!;
  assert.equal(renewal.generation, grant.generation + 1);
  assert.equal(get(delivery).requests.length, 2);
  work.changeAccess('product', delivery, renewal.id, 'granted');
  assert.throws(() => work.changeAccess('product', delivery, renewal.id, 'granted'), { status: 409 });
  const childResult = await until(() => get(delivery).result);
  assert.equal(childResult.version, 1);
  assert.deepEqual(get(delivery).runs.map(row => row.state), ['cancelled', 'done']);
  assert.equal(get(parent).runs.length, 1);
  await accept(delivery, childResult.revision);
  await accept(delivery, childResult.revision);
  const summary = await until(() => get(parent).result);
  assert.ok(get(parent).requiredChildren.every(row => row.ready));
  assert.equal(get(parent).runs.length, 2);
  const cardNeedle = '验收当前版本 · ' + parent.slice(0, 8);
  await until(() => updated.at(-1)?.includes(cardNeedle));
  assert.equal(sent.length, 1);
  assert.equal(updated.filter(body => body.includes(cardNeedle)).length, 1);
  work.changeAccess('product', delivery, renewal.id, 'revoked');
  assert.equal(get(parent).result, undefined);
  assert.equal(work.executionSnapshot('product', parent, summary.run).readable, false);
  await assert.rejects(accept(parent, summary.revision), { status: 409 });
  await until(() => !!updated.at(-1) && !updated.at(-1)!.includes(cardNeedle));
  assert.equal(sent.length, 1);
  assert.equal(get(parent).runs.length, 2);

  const recovery = { nonce: randomUUID(), reason: '恢复挂起的汇总', version: 1 };
  const unchanged = get(rules);
  assert.deepEqual(work.resume('product', parent, recovery), { version: 2, waiting: 'child-results' });
  assert.deepEqual(work.resume('product', parent, recovery), { version: 2, waiting: 'child-results' });
  assert.equal(get(parent).result, undefined);
  assert.equal(get(parent).runs.length, 2);
  assert.equal(get(delivery).runs.length, 2);
  const freshGrant = get(delivery).requests.find(row => row.state === 'requested')!;
  assert.equal(freshGrant.generation, renewal.generation + 1);
  work.changeAccess('product', delivery, freshGrant.id, 'granted');
  assert.throws(() => work.changeAccess('product', delivery, freshGrant.id, 'granted'), { status: 409 });
  const rechecked = await until(() => get(delivery).result);
  assert.equal(rechecked.version, 2);
  assert.equal(get(parent).result, undefined);
  assert.equal(get(parent).runs.length, 2, '子单重新交付后仍需等本版验收');
  assert.equal(work.executionSnapshot('product', parent, summary.run).readable, false);
  await assert.rejects(accept(parent, summary.revision), { status: 409 });
  await accept(delivery, rechecked.revision);
  await accept(delivery, rechecked.revision);
  const refreshed = await until(() => get(parent).result);
  assert.equal(refreshed.version, 2);
  assert.notEqual(refreshed.revision, summary.revision);
  await assert.rejects(accept(parent, summary.revision), { status: 409 });
  assert.equal(get(parent).runs.length, 3);
  assert.equal(get(delivery).runs.length, 3);
  assert.deepEqual(get(rules).work.accepted, unchanged.work.accepted);
  assert.deepEqual(get(rules).runs, unchanged.runs);
  const context = work.executionSnapshot('product', parent, refreshed.run).contents?.context;
  const combined = context?.events.filter(event => event.type === 'task.child-results');
  assert.equal(combined?.length, 1);
  const results = JSON.parse(combined![0]!.detail);
  assert.deepEqual(results.map(({ child, version }: { child: string; version: number }) => [child, version]), [[rules, 1], [delivery, 2]]);
  assert.ok(!context?.events.some(event => event.type === 'task.previous-output'));
  assert.equal(work.needsYou('product').filter(row => row.ticket === parent && row.kind === 'acceptance').length, 1);
  await until(() => updated.at(-1)?.includes(cardNeedle));
  assert.equal(sent.length, 1);
  assert.equal(updated.filter(body => body.includes(cardNeedle)).length, 2);
});
