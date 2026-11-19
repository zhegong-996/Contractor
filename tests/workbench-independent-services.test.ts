import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-feishu-inbox-'));
process.env.COLLAB_STATE_DIR = state;
const { openFeishuInbox, pullFeishuInbox } = await import('../src/workbench/feishu-inbox.ts');
after(() => rm(state, { recursive: true, force: true }));

test('超过三天的未处理卡片保留，重启后按原顺序处理，重放不重复入箱', () => {
  const at = Date.now(), later = at + 4 * 86400000;
  let inbox = openFeishuInbox('long-outage');
  try {
    assert.ok(inbox.claim('owner', at));
    inbox.put('owner', 'card', 'topic-a', 'first-click', at);
    inbox.put('owner', 'card', 'topic-a', 'second-click', at);
    assert.equal(inbox.prune(later), 0);
    assert.deepEqual(inbox.backlog(later), { pending: 2, overdue: 2, oldest: at });
    inbox.close(); inbox = openFeishuInbox('long-outage');
    const [first] = inbox.pending(later);
    assert.equal(first!.line, 'first-click');
    inbox.retry(first!, later);
    assert.equal(inbox.pending(later).length, 0);
    inbox.acknowledge(first!.id);
    assert.ok(inbox.claim('resumed', later));
    inbox.put('resumed', 'card', 'topic-a', 'first-click', later);
    const [second] = inbox.pending(later);
    assert.equal(second!.line, 'second-click');
    inbox.acknowledge(second!.id);
    assert.equal(inbox.pending(later).length, 0);
    assert.equal(inbox.prune(later), 2, 'only acknowledged tombstones expire');
    assert.equal(inbox.backlog(later).pending, 0);
  } finally { inbox.close(); }
});

test('the split Feishu inbox persists unconfirmed events across an ingress restart and preserves lane order', () => {
  const at = Date.now();
  let original: ReturnType<typeof openFeishuInbox> | undefined = openFeishuInbox('lab');
  const consume = openFeishuInbox('lab');
  let restarted: ReturnType<typeof openFeishuInbox> | undefined;
  try {
    assert.ok(original.claim('old', at));
    assert.ok(!consume.claim('parallel', at));
    original.put('old', 'message', 'thread-a', 'first', at);
    original.put('old', 'message', 'thread-a', 'first', at);
    original.put('old', 'message', 'thread-a', 'next', at);
    original.put('old', 'message', 'thread-b', 'unrelated', at);
    const [first, other] = consume.pending(at);
    assert.deepEqual([first!.line, other!.line], ['first', 'unrelated']);
    consume.retry(first!, at);
    consume.acknowledge(other!.id);
    assert.deepEqual(consume.pending(at + 999), []);
    original.release('old');
    original.close();
    original = undefined;

    restarted = openFeishuInbox('lab');
    assert.ok(restarted.claim('new', at + 1000));
    restarted.put('old', 'message', 'other', 'stale writer', at + 1000);
    const [recovered] = consume.pending(at + 1000);
    assert.deepEqual({ ...recovered }, { ...first, attempts: 1 });
    consume.acknowledge(recovered!.id);
    const [next] = consume.pending(at + 1000);
    assert.equal(next!.line, 'next');
    consume.acknowledge(next!.id);
    assert.deepEqual(consume.pending(at + 1000), []);
  } finally {
    restarted?.close();
    original?.close();
    consume.close();
  }
});

test('the workbench acknowledges delivery only after successful processing and requests history on ingress generation changes', async () => {
  const app = 'independent-history';
  const producer = openFeishuInbox(app);
  const now = Date.now();
  const messages = { state: 'ready' as const, attempt: 1, readyAt: now,
    disconnectedAt: undefined, checkedAt: now, busHealth: 'healthy' as const, lostEvents: 0 };
  let history = 0;
  let delivered = 0;
  let failures = 0;
  assert.ok(producer.claim('first', now));
  assert.ok(producer.pulse('first', now, { messages }));
  producer.put('first', 'message', 'topic', 'authorized callback', now);
  const pull = pullFeishuInbox(openFeishuInbox(app), {
    async message(line) {
      assert.equal(line, 'authorized callback');
      if (!failures) throw new Error('index restarting');
      delivered++;
    },
    async card() { assert.fail('received an unexpected card'); },
    ready() { history++; },
    retryable: () => true,
    log() { failures++; },
  });
  try {
    const until = Date.now() + 6000;
    while (!delivered && Date.now() < until) await delay(25);
    assert.equal(delivered, 1);
    assert.equal(failures, 1);
    assert.equal(history, 1);
    assert.deepEqual(producer.pending(Date.now()), []);
    producer.release('first');
    const at = Date.now();
    assert.ok(producer.claim('second', at));
    assert.ok(producer.pulse('second', at, { messages }));
    while (history < 2 && Date.now() < until) await delay(25);
    assert.equal(history, 2);
    assert.equal(delivered, 1);
  } finally {
    await pull.close();
    producer.close();
  }
});
