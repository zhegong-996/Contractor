// 第七十一轮 · 入站验签契约：
// 没配密钥一律拒收（fail-closed）；签名错拒收；超时窗按重放拒收；
// 明文企微默认拒收（它根本没法验签），要放行必须两道闸同时打开。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { verifyDingtalkCallback, verifyWecomCallback } from '../src/im-outbound.ts';

const DING_SECRET = 'ding-secret-abc';
const WECOM_TOKEN = 'wecom-token-xyz';
const NOW = Date.parse('2026-11-10T05:00:00.000Z');

const dingSign = (timestamp: string, secret = DING_SECRET) =>
  createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');

const wecomSign = (token: string, timestamp: string, nonce: string, body: string) =>
  createHash('sha1').update([token, timestamp, nonce, body].sort().join('')).digest('hex');

test('钉钉：没配密钥 → 一律拒收（fail-closed）', () => {
  const r = verifyDingtalkCallback({ secret: '', timestamp: '1', sign: 'x', now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /未配置回调加签密钥/);
});

test('钉钉：缺 sign / timestamp → 拒收', () => {
  assert.equal(verifyDingtalkCallback({ secret: DING_SECRET, now: NOW }).ok, false);
  assert.match(verifyDingtalkCallback({ secret: DING_SECRET, timestamp: '1', now: NOW }).reason!, /缺少 sign/);
});

test('钉钉：时间戳超 5 分钟 → 按重放拒收', () => {
  const old = String(NOW - 6 * 60 * 1000);
  const r = verifyDingtalkCallback({ secret: DING_SECRET, timestamp: old, sign: dingSign(old), now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /重放/);
});

test('钉钉：签名正确 → 通过；签名错误 → 拒收', () => {
  const ts = String(NOW);
  assert.equal(verifyDingtalkCallback({ secret: DING_SECRET, timestamp: ts, sign: dingSign(ts), now: NOW }).ok, true);
  assert.equal(verifyDingtalkCallback({ secret: DING_SECRET, timestamp: ts, sign: 'wrong', now: NOW }).ok, false);
  assert.match(verifyDingtalkCallback({ secret: DING_SECRET, timestamp: ts, sign: 'wrong', now: NOW }).reason!, /签名不匹配/);
});

test('钉钉：换了密钥，旧签名失效', () => {
  const ts = String(NOW);
  const r = verifyDingtalkCallback({ secret: 'another-secret', timestamp: ts, sign: dingSign(ts), now: NOW });
  assert.equal(r.ok, false);
});

test('企微：没配 Token → 一律拒收', () => {
  const r = verifyWecomCallback({ token: '', timestamp: '1', nonce: 'n', signature: 's', body: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /未配置回调 Token/);
});

test('企微：缺 msg_signature / timestamp / nonce → 拒收', () => {
  const r = verifyWecomCallback({ token: WECOM_TOKEN, body: 'x', encrypted: true });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /缺少 msg_signature/);
});

test('企微：URL 验证（echostr）签名正确 → 通过', () => {
  const ts = String(NOW), nonce = 'n1', echostr = 'echo-123';
  const r = verifyWecomCallback({ token: WECOM_TOKEN, timestamp: ts, nonce,
    signature: wecomSign(WECOM_TOKEN, ts, nonce, echostr), body: echostr, encrypted: true, now: NOW });
  assert.equal(r.ok, true);
});

test('企微：签名错误 → 拒收', () => {
  const ts = String(NOW);
  const r = verifyWecomCallback({ token: WECOM_TOKEN, timestamp: ts, nonce: 'n1',
    signature: 'deadbeef', body: 'echo', encrypted: true, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /签名不匹配/);
});

test('企微：明文消息体无法验签 → 默认拒收并说明原因', () => {
  const ts = String(NOW);
  const r = verifyWecomCallback({ token: WECOM_TOKEN, timestamp: ts, nonce: 'n1',
    signature: wecomSign(WECOM_TOKEN, ts, 'n1', 'body'), body: 'body', encrypted: false, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /明文模式企微不提供消息签名/);
});

test('企微：时间戳超窗 → 拒收', () => {
  const ts = String(NOW - 10 * 60 * 1000);
  const r = verifyWecomCallback({ token: WECOM_TOKEN, timestamp: ts, nonce: 'n1',
    signature: wecomSign(WECOM_TOKEN, ts, 'n1', 'b'), body: 'b', encrypted: true, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /重放/);
});
