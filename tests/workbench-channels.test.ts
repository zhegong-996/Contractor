import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ChannelRequest, PlatformActor } from '../src/workbench/channel-links.ts';
import { channelCommand, feishuCommandText } from '../src/workbench/channel-links.ts';

test('群命令只移除平台确认的机器人提及，明确引用单独解析', () => {
  const mention = { key: '@_user_1', name: '协作机器人' };
  const request = '/协作 review [https://github.com/team/example/issues/5] 门店推荐理由';
  const expected = { kind: 'work', agent: 'review', reference: 'https://github.com/team/example/issues/5', request: '门店推荐理由' };
  assert.deepEqual(channelCommand(feishuCommandText('@_user_1 ' + request, mention)), expected);
  assert.deepEqual(channelCommand(feishuCommandText('@协作机器人 ' + request, mention)), expected);
  assert.equal(channelCommand(feishuCommandText('@协作机器人 ' + request)), undefined);
  assert.equal(channelCommand('两家试点门店反馈看不懂推荐理由。'), undefined);
});

test('渠道身份绑定、同一引用去重和负责人确认共用原版工单事务', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'suitme-channels-'));
  await mkdir(path.join(directory, 'console'));
  process.env.COLLAB_STATE_DIR = directory;
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { key }, { messageRef }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'),
    import('../src/console-auth.ts'), import('../upstream/superagent/src/core/index.ts'), import('../src/workbench/channel-links.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('maintainer', 'only-for-unit-test');
  await auth.createAccount('maker', 'only-for-unit-test', 'operator', 'maintainer');
  await auth.createAccount('outside', 'only-for-unit-test', 'operator', 'maintainer');
  const config = settingsSchema.parse({
    projects: [
      { id: 'example', title: '门店推荐理由', members: ['maintainer', 'maker'], maintainers: ['maintainer'],
        topics: [{ id: 'reasons', title: '推荐理由' }], responsibilities: [{ member: 'maker', function: 'delivery' }],
        resources: [{ source: 'github', externalId: 'team/example', state: 'bound', contributors: ['maker'] }] },
      { id: 'private', title: '门店接入', parent: 'example', members: ['maintainer'], maintainers: ['maintainer'] },
    ],
    functions: [{ id: 'delivery', title: '交付' }],
    agents: [{ id: 'review', title: '评审', projects: ['example'], active: true, owner: 'maker', function: 'delivery',
      kind: 'personal', execution: { kind: 'test', provider: 'fixture' }, engine: 'command', command: ['/usr/bin/true'], capability: '评审文案', skill: '只读检查' }],
    crossChannel: {},
  });
  const work = await openCollaboration(config, auth);
  t.after(async () => { await work.close(); await rm(directory, { recursive: true, force: true }); });

  const github: PlatformActor = { provider: 'github', namespace: 'github.com', id: '91', label: 'maker-github' };
  const feishu: PlatformActor = { provider: 'feishu', namespace: 'app-example', id: 'ou_example', label: 'maker-feishu' };
  const proofFor = (member: string, actor: PlatformActor) => work.accountProof(member, actor.provider).command.split(' ')[1]!;
  for (const sender of [github, feishu]) {
    const code = proofFor('maker', sender);
    assert.equal(work.proveAccount(code, { ...sender, provider: sender === github ? 'feishu' : 'github' }), false);
    assert.equal(work.proveAccount(code, sender), true);
    assert.equal(work.proveAccount(code, { ...sender, id: 'other' }), false);
    assert.equal(work.channelMember(sender), undefined);
    work.confirmAccount('maker', sender.provider, sender);
    assert.equal(work.channelMember(sender), 'maker');
    assert.equal(work.proveAccount(code, sender), false);
  }
  assert.equal(work.proveAccount(proofFor('maintainer', github), github), true);
  assert.throws(() => work.confirmAccount('maintainer', 'github', github), { status: 409 });
  assert.equal(work.channelView('maker').accounts.length, 2);
  assert.equal(work.channelView('maintainer').accounts.length, 0);
  assert.equal(work.channelMember({ ...feishu, namespace: 'another-app' }), undefined);

  const shared = { key: 'github:100:7', label: 'example #7' };
  const topic = { key: 'feishu:app-example:group:topic', label: '飞书话题' };
  const input = (sender: PlatformActor, origin: typeof shared, name: string): ChannelRequest => ({
    sender, project: 'example', origin, agent: 'review', request: '修改门店推荐理由',
    trigger: { id: key('test-channels', name), source: sender.provider, actor: { source: sender.provider, id: sender.id },
      human: true, addressed: 'direct', at: new Date().toISOString(), threads: [{ source: sender.provider, id: origin.key }],
      text: '修改门店推荐理由', meta: {} },
  });
  const a = input(feishu, topic, 'feishu-first');
  const b = input(github, shared, 'github-concurrent');
  const results = await Promise.all([a, b].map(event => Promise.resolve().then(() => work.receiveChannel(event, shared))));
  assert.deepEqual(results.map(result => result.status).sort(), ['created', 'linked']);
  const all = work.overview('maker').tickets;
  assert.equal(all.length, 1);
  const ticket = all[0]!.id;
  assert.equal(work.detail('maker', ticket).work.requester, 'maker');
  assert.deepEqual(work.detail('maker', ticket).channelHistory.map(({ member }) => member), ['maker', 'maker']);
  assert.equal(work.receiveChannel(a, shared).status, 'duplicate');
  const note = input(github, shared, 'ordinary-comment');
  note.trigger.meta.repository = 'team/example';
  work.receiveNote(note);
  work.receiveNote(note);
  work.receiveNote(input(github, { key: 'github:100:8', label: '未绑定' }, 'unlinked-comment'));
  assert.equal(work.overview('maker').tickets.length, 1);
  assert.equal(work.detail('maker', ticket).channelHistory.at(-1)?.text, '在 GitHub 留下了讨论。');

  const { githubInputs, githubPullChange } = await import('../src/workbench/github-intake.ts');
  const repository = { id: '100', name: 'team/example' };
  const user = { id: 91, login: 'maker-github', type: 'User' };
  const now = new Date(Math.ceil(Date.now() / 1000) * 1000).toISOString();
  const original = { user, created_at: now, updated_at: now };
  const rawComment = { ...original, id: 671, body: '检查窄屏换行。',
    html_url: 'https://github.com/team/example/pull/7#discussion_r671',
    pull_request_url: 'https://api.github.com/repos/team/example/pulls/7',
    in_reply_to_id: 650, commit_id: '1'.repeat(40) };
  const [inline] = await githubInputs(repository, [rawComment], true, now);
  assert.ok(inline?.note);
  assert.equal(inline.origin.key, shared.key);
  assert.deepEqual(inline.trigger.meta.githubComment, { kind: 'inline', thread: 650, commit: '1'.repeat(40) });
  assert.deepEqual(await githubInputs(repository, [{ ...rawComment, ...Object.fromEntries(['created_at', 'updated_at']
    .map(field => [field, '2026-11-13T00:00:00Z'])) }], true, now), []);
  const editedAt = new Date(Date.parse(now) + 1000).toISOString();
  const [edited] = await githubInputs(repository, [{ ...rawComment, updated_at: editedAt, body: '/协作 review 这只是编辑后的内容' }], true, editedAt);
  assert.equal(edited?.trigger.id, inline.trigger.id);
  assert.equal(edited?.trigger.at, now);
  assert.equal(edited?.note, true);
  assert.equal(edited?.revision, editedAt);
  const issue = { ...original, id: 770, number: 8, html_url: 'https://github.com/team/example/issues/8',
    body: '另一张 Issue，尚无明确协作命令。', state: 'closed', state_reason: 'completed' };
  const [issueChange] = await githubInputs(repository, [issue], false, now);
  assert.equal(issueChange?.evidence, 'issue');
  assert.equal(issueChange?.trigger.human, false);
  assert.equal(issueChange?.origin.key, 'github:100:8');
  const pullChange = githubPullChange(repository, { ...issue, number: 7, html_url: inline.origin.url }, now);
  assert.equal(pullChange?.evidence, 'pull');
  assert.equal(pullChange?.origin.key, shared.key);
  assert.notEqual(pullChange?.trigger.id, inline.trigger.id);

  const c = input(feishu, { key: 'feishu:app-example:group:new-topic', label: '飞书新话题' }, 'missing-reference');
  assert.equal(work.receiveChannel(c).status, 'pending');
  assert.equal(work.channelView('maintainer').pending.length, 1);
  assert.equal(work.channelView('maker').pending.length, 0);
  assert.throws(() => work.resolveChannel('maker', c.trigger.id, { action: 'link', ticket }), { status: 403 });
  assert.deepEqual(work.resolveChannel('maintainer', c.trigger.id, { action: 'link', ticket }), { ticket });
  assert.equal(work.overview('maker').tickets.length, 1);
  assert.equal(work.detail('maker', ticket).channelHistory.length, 4);

  const anotherRef = { key: 'github:200:7', label: 'another-repo #7' };
  const d = work.receiveChannel(input(github, anotherRef, 'same-number-another-repo'), anotherRef);
  assert.equal(d.status, 'created');
  assert.notEqual(d.ticket, ticket);
  const conflict = input(feishu, topic, 'conflicting-references');
  assert.equal(work.receiveChannel(conflict, anotherRef).status, 'pending');
  assert.equal(work.overview('maker').tickets.length, 2);
  assert.equal(work.channelView('maintainer').pending[0]?.sourceTicket, ticket);
  assert.deepEqual(work.channelView('maintainer').pending[0]?.reference, anotherRef);
  assert.deepEqual(work.resolveChannel('maintainer', conflict.trigger.id, { action: 'link', ticket: d.ticket! }), { ticket: d.ticket });
  assert.equal(work.channelTicket(topic), ticket);
  assert.equal(work.channelTicket(messageRef(conflict.trigger.id)), d.ticket);
  assert.ok(work.detail('maker', d.ticket!).channelHistory.some(row => row.id === conflict.trigger.id));
  assert.ok(!work.detail('maker', ticket).channelHistory.some(row => row.id === conflict.trigger.id));
  const split = input(feishu, topic, 'confirmed-distinct-work');
  assert.equal(work.receiveChannel(split, anotherRef).status, 'pending');
  const separated = work.resolveChannel('maintainer', split.trigger.id, { action: 'create', agent: 'review' }).ticket;
  assert.ok(separated && separated !== ticket && separated !== d.ticket);
  assert.equal(work.channelTicket(topic), ticket);
  assert.equal(work.channelTicket(messageRef(split.trigger.id)), separated);
  assert.equal(work.receiveChannel(split, anotherRef).status, 'duplicate');
  assert.throws(() => work.resolveChannel('maintainer', split.trigger.id, { action: 'create', agent: 'review' }), { status: 409 });
  assert.equal(work.overview('maker').tickets.length, 3);
  for (const comment of [inline, edited!, inline, edited!]) work.receiveNote({
    project: 'example', origin: comment.origin, sender: comment.sender, trigger: comment.trigger, agent: '',
    request: comment.text, revision: comment.revision,
  });
  const notes = work.detail('maker', ticket).channelHistory.filter(row => row.id === inline.trigger.id);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0]?.revisions.map(revision => [revision.at, revision.text]), [[now, null], [editedAt, null]]);
  assert.equal(work.overview('maker').tickets.length, 3);
  work.setTopic('maintainer', ticket, 'reasons');
  work.setTopic('maker', d.ticket!, 'reasons');
  assert.throws(() => work.setTopic('maker', ticket, 'unknown'), { status: 400 });
  assert.equal(work.detail('maker', ticket).topicTitle, '推荐理由');
  assert.equal(work.detail('maker', d.ticket!).topicTitle, '推荐理由');
  assert.throws(() => work.createTopic('maker', 'example', { id: 'small-screen', title: '小屏展示', parent: 'reasons' }), { status: 403 });
  work.createTopic('maintainer', 'example', { id: 'small-screen', title: '小屏展示', parent: 'reasons' });
  assert.throws(() => work.createTopic('maintainer', 'example', { id: 'third-level', title: '多级', parent: 'small-screen' }), { status: 400 });
  work.setTopic('maker', d.ticket!, 'small-screen');
  assert.ok(work.overview('maker').projects[0]?.topics.some(topic => topic.id === 'small-screen' && topic.parent === 'reasons'));
  assert.equal(work.detail('maker', d.ticket!).topicTitle, '小屏展示');
  work.relateWork('maker', ticket, d.ticket!);
  assert.equal(work.detail('maker', ticket).related[0]?.id, d.ticket);
  assert.equal(work.detail('maker', d.ticket!).related[0]?.id, ticket);
  assert.throws(() => work.relateWork('outside', ticket, d.ticket!), { status: 404 });
  assert.deepEqual(work.overview('maker').projects.map(item => item.id), ['example']);
  assert.deepEqual(work.overview('maker').projects[0]?.members.find(item => item.name === 'maker')?.responsibilities, ['delivery']);
  assert.throws(() => work.addReference('maker', 'example', { source: 'figma', label: '设计', url: 'https://www.figma.com/design/Example?node-id=3-4' }), { status: 403 });
  const design = work.addReference('maintainer', 'example', { source: 'figma', label: '设计', url: 'https://www.figma.com/design/Example?node-id=3-4', revision: 'v1' });
  const privateDesign = work.addReference('maintainer', 'private', { source: 'figma', label: '参考设计', url: 'https://www.figma.com/design/Example?node-id=3%3A4', revision: 'v1' });
  assert.equal(design.externalId, privateDesign.externalId);
  assert.notEqual(design.ref, privateDesign.ref);
  assert.throws(() => work.start('maker', { project: 'example', title: '越权引用', request: '引用测试', nonce: 'test',
    material: [], resources: [privateDesign.ref], agent: 'review', priority: 'normal' }), { status: 400 });

  const e = input(feishu, { key: 'feishu:app-example:group:new', label: '待确认' }, 'revoke-pending');
  assert.equal(work.receiveChannel(e).status, 'pending');
  work.revokeAccount('maker', feishu.provider, feishu.namespace, feishu.id);
  assert.equal(work.receiveChannel(input(feishu, topic, 'revoked'), shared).status, 'unbound');
  assert.throws(() => work.resolveChannel('maintainer', e.trigger.id, { action: 'link', ticket }), { status: 409 });
  assert.equal(work.channelMember(github), 'maker');
  assert.equal(work.proveAccount(proofFor('maker', feishu), feishu), true);
  work.confirmAccount('maker', 'feishu', feishu);
  const earlier = input(feishu, topic, 'created-before-binding');
  earlier.trigger.at = '2026-11-13T00:00:00.000Z';
  assert.equal(work.receiveChannel(earlier, shared).status, 'unbound');
});

test('GitHub 首次读取区分 Issue 元数据更新与正文编辑，失败可重试', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-github-opening-'));
  const priorPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + priorPath;
  t.after(async () => { process.env.PATH = priorPath; await rm(dir, { recursive: true, force: true }); });
  const response = path.join(dir, 'response.json');
  const calls = path.join(dir, 'calls');
  await writeFile(path.join(dir, 'gh'), [
    '#!' + process.execPath,
    'const fs = require("node:fs");',
    'if (process.argv[2] !== "api" || process.argv[3] !== "graphql") process.exit(2);',
    'fs.appendFileSync(' + JSON.stringify(calls) + ', "checked\\n");',
    'process.stdout.write(fs.readFileSync(' + JSON.stringify(response) + ', "utf8"));',
  ].join('\n'), { mode: 0o700 });
  const { githubInputs } = await import('../src/workbench/github-intake.ts');
  const repository = { id: '100', name: 'team/example' };
  const since = '2026-11-15T12:00:00Z', changedAt = '2026-11-15T12:00:05Z';
  const issue = { id: 154, node_id: 'I_example', number: 17, user: { id: 91, login: 'product', type: 'User' },
    created_at: since, updated_at: changedAt, body: '/协作 review 门店推荐理由',
    html_url: 'https://github.com/team/example/issues/17', state: 'open' };
  const node = { __typename: 'Issue', number: 17, body: issue.body, createdAt: since, lastEditedAt: null,
    repository: { nameWithOwner: repository.name } };
  await writeFile(response, '{}');
  await assert.rejects(githubInputs(repository, [issue], false, since));
  await writeFile(response, JSON.stringify({ data: { node } }));
  const [, accepted] = await githubInputs(repository, [issue], false, since);
  assert.ok(accepted);
  const [, first] = await githubInputs(repository, [{ ...issue, updated_at: since }], false, since);
  assert.equal(accepted.trigger.id, first?.trigger.id);
  assert.deepEqual((await githubInputs(repository, [issue], false, since, ID => ID === accepted.trigger.id))
    .map(event => event.evidence), ['issue']);
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2, '已处理的 Issue 后续更新不再验证开单');
  await writeFile(response, JSON.stringify({ data: { node: { ...node, lastEditedAt: changedAt } } }));
  assert.deepEqual((await githubInputs(repository, [issue], false, since)).map(event => event.evidence), ['issue']);
  assert.deepEqual((await githubInputs(repository, [issue], false, changedAt)).map(event => event.evidence), ['issue']);
});
