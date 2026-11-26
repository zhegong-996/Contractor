import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../workbench/src/api.ts';

test('未收到 JSON 回执时保留提交状态，不能视作成功或退出登录', async t => {
  let reply = '';
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(reply));
  await assert.rejects(api('project', { title: '门店推荐理由' }), { status: 502 });
  reply = '<html></html>';
  await assert.rejects(api('overview'), { status: 502 });
  reply = '{}';
  await assert.rejects(api('session'), { status: 502 });
  reply = '{"signedIn":false}';
  assert.deepEqual(await api('session'), { signedIn: false });
  assert.equal(fetch.mock.callCount(), 4);
});
