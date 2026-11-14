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
  const config = settingsSchema.parse({
    projects: [{ id: 'example', title: '门店推荐理由', members: ['maintainer', 'maker'], maintainers: ['maintainer'] }],
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

  const c = input(feishu, { key: 'feishu:app-example:group:new-topic', label: '飞书新话题' }, 'missing-reference');
  assert.equal(work.receiveChannel(c).status, 'pending');
  assert.equal(work.channelView('maintainer').pending.length, 1);
  assert.equal(work.channelView('maker').pending.length, 0);
  assert.throws(() => work.resolveChannel('maker', c.trigger.id, { action: 'link', ticket }), { status: 403 });
  assert.deepEqual(work.resolveChannel('maintainer', c.trigger.id, { action: 'link', ticket }), { ticket });
  assert.equal(work.overview('maker').tickets.length, 1);
  assert.equal(work.detail('maker', ticket).channelHistory.length, 3);

  const anotherRef = { key: 'github:200:7', label: 'another-repo #7' };
  const d = work.receiveChannel(input(github, anotherRef, 'same-number-another-repo'), anotherRef);
  assert.equal(d.status, 'created');
  assert.notEqual(d.ticket, ticket);
  assert.equal(work.receiveChannel(input(feishu, topic, 'conflicting-references'), anotherRef).status, 'pending');
  assert.equal(work.overview('maker').tickets.length, 2);

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
