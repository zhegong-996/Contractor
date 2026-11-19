import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import adapter from '../src/workbench/octop-adapter.ts';
import { consultationReplyType } from '../src/workbench/channel-links.ts';

test('Octop 咨询保留完整正文，截断回执仅记录用量', () => {
  const session = randomUUID();
  const usage = { input: 100, output: 160, cached: 0 };
  const text = '验收规则\n\n' + '连续长词可换行。'.repeat(100) + '\n\n正文容器无横向溢出。';
  const receipt = { session, usage, text, consultation: true };
  for (const stopReason of ['max_tokens', 'length', null]) {
    const partial = adapter.read(JSON.stringify({ ...receipt, stopReason }), 0);
    assert.match(partial.error!, /未正常结束/);
    assert.deepEqual(partial.usage, usage);
    assert.equal(partial.text, undefined);
  }
  const completed = adapter.read(JSON.stringify({ ...receipt, stopReason: 'end_turn' }), 0);
  assert.equal(completed.finished, true);
  const detail = JSON.parse(completed.text!.split('\n')[3]!).events[0];
  assert.equal(detail.type, consultationReplyType);
  assert.equal(detail.detail, text);
});
