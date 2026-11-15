import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';

test('平台整理的空窗口不产生预算待办，新反馈触及额度后仍可由下一窗口处理', { timeout: 20000 }, async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-platform-agent-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const fixture = path.join(dir, 'fixture.mjs');
  await writeFile(fixture, [
    "import { readFileSync } from 'node:fs';",
    "const input = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));",
    "const message = input.events.find(event => event.type === 'discussion.message');",
    "const events = [{ id: message.id, type: 'discussion.destination', detail: JSON.stringify({ message: message.id, action: 'topic', topic: 'reason', title: '推荐理由难懂', reason: '门店反馈' }) }];",
    "console.log('整理一条反馈\\n\\n```agent-autoloop\\n' + JSON.stringify({ events }) + '\\n```');",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }, { discussionInput }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
    import('../src/upstream.ts'), import('../src/workbench/discussion-intake.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'fixture-password-only');
  const config = settingsSchema.parse({
    projects: [{
      id: 'store', title: '门店推荐理由', members: ['product'], maintainers: ['product'],
      topics: [{ id: 'reason', title: '推荐理由' }],
      resources: [{ source: 'feishu', externalId: 'oc_store', state: 'bound', purpose: 'discussion', digest: true, topic: 'reason' }],
      discussion: { agent: 'digest', cron: '* * * * *' },
    }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{
      id: 'digest', title: '整理 Agent', kind: 'specialist', owner: 'product', projects: ['store'], function: 'review',
      engine: 'command', command: [process.execPath, fixture], execution: { kind: 'test', provider: 'fixture' },
      skill: '整理门店反馈', capability: '整理群消息', active: true,
    }],
    feishu: { profile: 'fixture', appId: 'cli_fixture', botId: 'ou_bot' },
    crossChannel: {},
  });
  const work = await openCollaboration(config, auth);
  const db = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'), { readOnly: true });
  t.after(async () => {
    db.close();
    await work.close();
    await rm(dir, { recursive: true, force: true });
  });
  const hub = await import('../upstream/autoloop/host/runtime.ts');
  const pool = { kind: 'platform', subject: 'platform' } as const;
  const platformUsage = () => work.budgetPools('product', 'store').find(row => row.kind === 'platform')!;
  const budgetWait = () => work.needsYou('product').some(decision => decision.kind === 'budget');
  async function runWindow(expected: string) {
    const slot = work.discussionView('product', 'store').next!;
    clock = slot;
    hub.tick();
    const state = db.prepare('SELECT state FROM workbench_discussion_run WHERE project=? AND slot=?');
    for (let attempt = 0; attempt < 80; attempt++) {
      if (state.get('store', slot)?.state === expected) return;
      await delay(60);
    }
    assert.equal(state.get('store', slot)?.state, expected);
  }

  hub.tick();
  work.setBudget('product', pool, 'day', 0);
  await runWindow('empty');
  assert.equal(budgetWait(), false);
  assert.equal(platformUsage().used, 0);

  clock++;
  const message = feishuTrigger({ message_id: 'om_feedback', chat_id: 'oc_store', chat_type: 'group', sender_id: 'ou_member',
    sender_type: 'user', create_time: String(Date.now()), content: '试点门店反馈，推荐理由的使用场景看不懂。' }, 'ou_bot', 'cli_fixture') as Trigger;
  work.rememberDiscussion(discussionInput(message, 'cli_fixture'));
  await runWindow('cancelled');
  assert.equal(budgetWait(), true);
  assert.equal(platformUsage().used, 0);

  work.setBudget('product', pool, 'day', 1);
  await runWindow('done');
  assert.equal(platformUsage().used, 1);
  assert.equal(platformUsage().pending, 0);
  assert.equal(work.discussionView('product', 'store').items[0]?.title, '推荐理由难懂');
  assert.equal(work.budgetPools('product', 'store').find(row => row.kind === 'execution')?.used, 0);
});
