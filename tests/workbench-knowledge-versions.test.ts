import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { FeishuSources } from '../src/feishu-sources.ts';
import { knowledgeSource, readKnowledgeSource } from '../src/workbench/knowledge-sources.ts';
import { resourceSchema } from '../src/workbench/project-resources.ts';

test('GitHub Markdown follows the allowed branch tree and freezes the commit and file contents', async () => {
  const resource = resourceSchema.parse({ source: 'github', externalId: 'test/store', state: 'bound',
    knowledge: { format: 'github-markdown', owner: 'owner', conditions: 'only this store', branch: 'pilot/knowledge',
      files: ['docs/store.md'] } });
  assert.equal(knowledgeSource('store', resource, 'README.md'), undefined);
  assert.equal(knowledgeSource('store', { ...resource, state: 'observe' }, 'docs/store.md'), undefined);
  const connection = knowledgeSource('store', resource, 'docs/store.md')!;
  const commit = 'a'.repeat(40), root = 'b'.repeat(40), directory = 'c'.repeat(40);
  const body = '# 门店推荐理由\n\n先场景后事实。\n';
  const bytes = Buffer.from(body);
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  const calls: string[] = [];
  let mode = '100644';
  const github = async (repository: string, route: string) => {
    assert.equal(repository, 'test/store');
    calls.push(route);
    if (route === 'branches/pilot%2Fknowledge') return { commit: { sha: commit, commit: { tree: { sha: root } } } };
    if (route === 'git/trees/' + root) return { sha: root, truncated: false, tree: [
      { path: 'docs', type: 'tree', mode: '040000', sha: directory }] };
    if (route === 'git/trees/' + directory) return { sha: directory, truncated: false, tree: [
      { path: 'store.md', type: 'blob', mode, sha: blob, size: bytes.length }] };
    if (route === 'git/blobs/' + blob) return { sha: blob, size: bytes.length, content: bytes.toString('base64'), encoding: 'base64' };
    assert.fail('Unexpected GitHub request ' + route);
  };
  const feishu = new FeishuSources(async () => assert.fail('Wrong upstream source'));
  const read = await readKnowledgeSource(connection, feishu, github);
  assert.equal(read.body, body);
  assert.equal(read.source.revision, commit);
  assert.equal(read.source.url, 'https://github.com/test/store/blob/' + commit + '/docs/store.md');
  assert.equal(read.source.authority, connection.authority);
  assert.deepEqual(calls, ['branches/pilot%2Fknowledge', 'git/trees/' + root, 'git/trees/' + directory, 'git/blobs/' + blob]);
  mode = '120000';
  calls.length = 0;
  await assert.rejects(readKnowledgeSource(connection, feishu, github), /普通 Markdown/);
  assert.ok(!calls.some(route => route.startsWith('git/blobs/')));
});

test('替换与失效保留历史版本，撤回原资料的精确授权会隐藏多级派生知识', { timeout: 36000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-knowledge-versions-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const fixture = path.join(dir, 'agent.mjs');
  await writeFile(fixture, [
    "import {readFileSync} from 'node:fs';",
    "const ctx = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));",
    "const cited = ctx.events.filter(item => item.type === 'knowledge.source').map(item => {",
    "  const lines = item.detail.split('\\n');",
    "  const marker = lines.find(line => line.startsWith('记忆引用标识：'));",
    "  return [lines[0], marker?.slice('记忆引用标识：'.length)].filter(Boolean).join(' ');",
    "});",
    "console.log(cited.join('、'));",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'knowledge-test-only');
  for (const actor of ['product', 'engineering', 'observer']) await auth.createAccount(actor, 'knowledge-test-only', 'operator', 'owner');
  const config = settingsSchema.parse({ projects: [
    { id: 'store', title: '门店推荐理由', members: ['product', 'engineering', 'owner', 'observer'], maintainers: ['product'] },
    { id: 'other', title: '另一个项目', members: ['owner', 'product'], maintainers: ['owner'] },
  ], functions: [{ id: 'review', title: '核对' }], agents: [{
    id: 'reviewer', owner: 'engineering', title: '核对 Agent', projects: ['store'], kind: 'personal',
    function: 'review', engine: 'command', command: [process.execPath, fixture], model: 'fixture',
    execution: { kind: 'test', provider: 'fixture' }, capability: '核对门店口径', skill: '只读取分配的资料', active: true,
  }] });
  const work = await openCollaboration(config, auth);
  t.after(async () => { await work.close(); await rm(dir, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined) {
    for (let i = 0; i < 170; i++) {
      const value = read();
      if (value) return value;
      await delay(100);
    }
    assert.fail('等待真实 worker 回归状态超时');
  }
  const detail = (id: string) => work.detail('product', id);
  const open = (material: string[], project = 'store') => work.start('product', {
    project, material, title: '门店推荐理由', request: '核对事实和场景次序', agent: 'reviewer', nonce: randomUUID(), priority: 'normal',
  });
  const start = async (material: string[]) => {
    const { trigger } = open(material);
    return wait(() => work.resolveStart('product', trigger) ?? undefined);
  };
  const grant = async (actor: string, id: string, entry: string) => {
    const found = await wait(() => detail(id).requests.find(r => r.entry === entry && r.state === 'requested'));
    work.changeAccess(actor, id, found.id, 'granted');
    return found.id;
  };
  function entry(actor: string, id: string, historical = false) {
    const item = work.browse(actor, 'store', '', historical).find(e => e.id === id);
    assert.ok(item && 'revision' in item && item.revision);
    return { id, revision: item.revision };
  }
  const adopt = async (id: string) => {
    const result = await wait(() => detail(id).result);
    await work.accept('product', id, result.revision, '仅用于测试门店', result.text);
    const candidate = entry('product', detail(id).candidate!);
    await work.publish('product', candidate.id, candidate.revision);
    return { candidate, result };
  };

  const input = { title: '推荐理由表达规范', kind: 'reference', conditions: '仅用于测试门店', visibility: 'restricted' as const };
  const first = entry('owner', work.addKnowledge('owner', 'store', { ...input, body: 'STORE_POLICY_V1_JADE，先场景后事实' }));
  const original = await start([first.id]);
  const grant1 = await grant('owner', original, first.id);
  const v1 = await adopt(original);
  const downstream = await start([v1.candidate.id]);
  await grant('product', downstream, v1.candidate.id);
  const derived = await adopt(downstream);
  const snapshot = work.executionSnapshot('product', downstream, derived.result.run);
  assert.equal(snapshot.readable, true);
  const source = snapshot.materials?.[0]?.acceptedSource;
  assert.equal(source?.ticket, original);
  assert.equal(source?.revision, v1.result.revision);
  assert.equal(source?.version, 1);
  assert.deepEqual(derived.result.citations[0]?.acceptedSource, source);
  assert.ok(work.memoryUses('product', v1.candidate.id).some(item => item.ticket === downstream));

  const candidate = entry('owner', work.addKnowledge('owner', 'store', {
    ...input, body: 'STORE_POLICY_V2_AMBER，先事实后场景', replaces: first,
  }));
  const concurrent = entry('owner', work.addKnowledge('owner', 'store', { ...input, body: '另一份未采用的修订', replaces: first }));
  assert.throws(() => open([candidate.id]), { status: 409 });
  assert.throws(() => work.addKnowledge('owner', 'other', { ...input, body: '跨项目复制', replaces: first }), { status: 409 });
  assert.ok(!work.browse('owner', 'store', 'STORE_POLICY_V2_AMBER').some(e => e.id === candidate.id));
  assert.throws(() => work.publish('product', candidate.id, candidate.revision), { status: 403 });
  await work.publish('owner', candidate.id, candidate.revision);
  assert.throws(() => work.publish('owner', concurrent.id, concurrent.revision), { status: 409 });
  assert.throws(() => open([v1.candidate.id]), { status: 409 });
  assert.throws(() => open([derived.candidate.id]), { status: 409 });
  assert.ok(work.browse('product', 'store', '', true).some(e => e.id === derived.candidate.id));
  assert.equal(work.executionSnapshot('product', original, v1.result.run).materials?.[0]?.revision, first.revision);
  assert.equal(work.executionSnapshot('observer', original, v1.result.run).readable, false);

  work.revise('product', original, { kind: 'continued', revision: v1.result.revision,
    reason: '旧版受限口径备忘 STORE_POLICY_V1_JADE', material: [first.id, candidate.id] });
  assert.deepEqual(detail(original).work.material, [candidate.id]);
  work.changeAccess('owner', original, grant1, 'revoked');
  assert.equal(work.executionSnapshot('product', original, v1.result.run).contents, undefined);
  assert.equal(work.executionSnapshot('product', downstream, derived.result.run).contents, undefined);
  assert.throws(() => work.memoryUses('product', v1.candidate.id), { status: 403 });
  assert.ok(!work.browse('product', 'store', '', true).some(e => [v1.candidate.id, derived.candidate.id].includes(e.id)));
  const graphAfterRevocation = work.projectKnowledgeGraph('product', 'store');
  assert.ok(!graphAfterRevocation.nodes.some(node => node.kind === 'knowledge' && [v1.candidate.revision, derived.candidate.revision].includes(node.revision!)), '撤权后的派生知识不出现在图中');
  assert.equal(detail(original).versions[0]?.text, undefined);
  assert.equal(detail(original).versions[0]?.reviews[0]?.kind, 'accepted');
  const grant2 = await grant('owner', original, candidate.id);
  const v2 = await wait(() => detail(original).result);
  assert.equal(v2.version, 2);
  assert.match(v2.text, /STORE_POLICY_V2_AMBER/);
  assert.ok(!JSON.stringify(work.executionSnapshot('product', original, v2.run)).includes('STORE_POLICY_V1_JADE'));
  assert.equal(work.executionSnapshot('product', original, v1.result.run).readable, false);
  assert.throws(() => work.invalidateKnowledge('engineering', candidate.id, candidate.revision, '测试失效'), { status: 403 });
  work.invalidateKnowledge('owner', candidate.id, candidate.revision, '测试门店不再使用');
  assert.throws(() => open([first.id]), { status: 409 });
  assert.ok(!work.browse('owner', 'store', 'STORE_POLICY_V2_AMBER').some(e => e.id === candidate.id));
  assert.equal(work.executionSnapshot('product', original, v2.run).readable, true);
  work.changeAccess('owner', original, grant2, 'revoked');
  assert.equal(work.executionSnapshot('product', original, v2.run).readable, false);
});
