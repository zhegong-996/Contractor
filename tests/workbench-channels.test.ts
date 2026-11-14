import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { key }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'),
    import('../src/console-auth.ts'), import('../upstream/superagent/src/core/index.ts'),
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
      kind: 'personal', engine: 'command', command: ['/usr/bin/true'], capability: '评审文案', skill: '只读检查' }],
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
  const [inline] = githubInputs(repository, [rawComment], true, now);
  assert.ok(inline?.note);
  assert.equal(inline.origin.key, shared.key);
  assert.deepEqual(inline.trigger.meta.githubComment, { kind: 'inline', thread: 650, commit: '1'.repeat(40) });
  assert.deepEqual(githubInputs(repository, [{ ...rawComment, created_at: '2026-11-13T00:00:00Z' }], true, now), []);
  const issue = { ...original, id: 770, number: 8, html_url: 'https://github.com/team/example/issues/8',
    body: '另一张 Issue，尚无明确协作命令。', state: 'closed', state_reason: 'completed' };
  const [issueChange] = githubInputs(repository, [issue], false, now);
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
  assert.equal(work.receiveChannel(input(feishu, topic, 'conflicting-references'), anotherRef).status, 'pending');
  assert.equal(work.overview('maker').tickets.length, 2);
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
