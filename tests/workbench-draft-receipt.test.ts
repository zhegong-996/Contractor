import assert from 'node:assert/strict';
import test from 'node:test';
import { writeStoredValue } from '../workbench/src/drafts.ts';

test('回执只清理已发送的那份草稿，编辑、切换主题和退出后都不丢内容', () => {
  const first = { text: '第一条', nonce: '1' };
  const next = { text: '第二条', nonce: '2' };
  const blank = { text: '', nonce: '3' };
  const before = { topic: first, personal: next };
  assert.deepEqual(writeStoredValue(before, 'topic', blank, first), { topic: blank, personal: next });
  const edited = writeStoredValue(before, 'topic', next);
  assert.equal(writeStoredValue(edited, 'topic', blank, first), edited);
  const expired = {};
  assert.equal(writeStoredValue(expired, 'topic', blank, first), expired);
});
