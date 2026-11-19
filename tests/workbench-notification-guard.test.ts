import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationGuard } from '../src/workbench/notification-guard.ts';

test('维护期间外发保持失败可重试，不调用发送器或伪造成功回执', async () => {
  let sent = 0;
  const send = async () => { sent++; return 'message-id'; };
  const paused = notificationGuard(true);
  for (let i = 0; i < 3; i++) await assert.rejects(paused.deliver(send), /通知外发已暂停/);
  assert.equal(sent, 0);
  assert.equal(await notificationGuard(false).deliver(send), 'message-id');
  assert.equal(sent, 1);
});

test('联调期间仅允许指定钉钉机器人的单聊回传', async () => {
  const guard = notificationGuard(true, 'dingtalk-contractor-test');
  const address = { kind: 'dingtalk', connector: 'dingtalk-contractor-test', direct: true };
  const send = async () => 'test-receipt';
  assert.equal(await guard.deliver(send, address), 'test-receipt');
  for (const other of [undefined, { ...address, direct: false }, { ...address, connector: 'another' }, { ...address, kind: 'wecom' }]) {
    assert.equal(guard.permits(other), false);
    await assert.rejects(guard.deliver(send, other), /通知外发已暂停/);
  }
});
