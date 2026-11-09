// 第三十六轮 · 钉钉 / 企微通道（src/im-outbound.ts）。
// 红线：凭据只从环境变量读；出站与飞书共享注意力预算（预算判定在 server
// deliver() 层，本模块只负责「格式正确 + 如实报告成败」）；企微加密模式
// 如实报错，不假装解密。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  sendDingtalk, sendWecom, dingtalkSignedUrl, dingtalkEndpoint, wecomEndpoint,
  dingtalkToTrigger, wecomPlainXmlToTrigger, wecomIsEncrypted,
  defaultDingtalkConfig, defaultWecomConfig,
} from '../src/im-outbound.ts';
import type { Config } from '../src/config.ts';

function recordingFetch(log: unknown[] = []): { fetch: typeof globalThis.fetch; log: unknown[] } {
  return { log, fetch: (async (input: any, init: any) => {
    log.push({ url: String(input), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
  }) as any };
}

test('sendDingtalk posts markdown with a correct HMAC signature when a secret is configured', async () => {
  const { fetch, log } = recordingFetch();
  const result = await sendDingtalk({ webhook: 'https://oapi.dingtalk.com/robot/send?access_token=tok', secret: 'SEC123',
    title: '任务通知', text: '【任务进展】SUI-42 已交付待验收', fetchImpl: fetch });
  assert.equal(result.ok, true);
  const call = log[0] as { url: string; body: { msgtype: string; markdown: { title: string; text: string } } };
  assert.equal(call.body.msgtype, 'markdown');
  assert.equal(call.body.markdown.title, '任务通知');
  const url = new URL(call.url);
  assert.equal(url.searchParams.get('access_token'), 'tok');
  const timestamp = url.searchParams.get('timestamp')!;
  const expected = createHmac('sha256', 'SEC123').update(`${timestamp}\nSEC123`).digest('base64');
  assert.equal(url.searchParams.get('sign'), expected, '签名与钉钉文档口径一致（searchParams 已解码）');
  assert.ok(call.url.includes(encodeURIComponent(expected)), 'URL 里携带的是编码后的签名');
  const unsigned = recordingFetch();
  await sendDingtalk({ webhook: 'https://oapi.dingtalk.com/robot/send?access_token=tok', title: 't', text: 'x', fetchImpl: unsigned.fetch });
  assert.ok(!(new URL((unsigned.log[0] as { url: string }).url).searchParams.has('sign')), '未配置 secret 时不加签');
});

test('sendWecom posts markdown content and reports DingTalk-style error codes honestly', async () => {
  const { fetch, log } = recordingFetch();
  const result = await sendWecom({ webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', title: '验收提醒', text: '请确认 SUI-42', fetchImpl: fetch });
  assert.equal(result.ok, true);
  const call = log[0] as { body: { msgtype: string; markdown: { content: string } } };
  assert.equal(call.body.msgtype, 'markdown');
  assert.match(call.body.markdown.content, /\*\*验收提醒\*\*/);
  const failing: typeof globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 310000, errmsg: 'url not match' }), { status: 200 })) as any;
  const bad = await sendWecom({ webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', title: 't', text: 'x', fetchImpl: failing });
  assert.equal(bad.ok, false); assert.match(bad.error!, /310000/);
});

test('endpoints read credentials from environment variables only; nothing lands in config', () => {
  const config = { dingtalk: { ...defaultDingtalkConfig(), enabled: true }, wecom: { ...defaultWecomConfig(), enabled: true } } as any as Config;
  assert.deepEqual(dingtalkEndpoint(config, {}), { enabled: false }, '缺 webhook 环境变量时如实报未接通');
  assert.deepEqual(wecomEndpoint(config, {}), { enabled: false });
  const withEnv = dingtalkEndpoint(config, { DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=t', DINGTALK_SECRET: 'SEC' });
  assert.equal(withEnv.enabled, true); assert.equal(withEnv.secret, 'SEC');
  const off = { dingtalk: { ...defaultDingtalkConfig(), enabled: false } } as any as Config;
  assert.deepEqual(dingtalkEndpoint(off, { DINGTALK_WEBHOOK_URL: 'https://x' }), { enabled: false });
});

test('dingtalk inbound callbacks normalize into the shared trigger shape', () => {
  const trigger = dingtalkToTrigger({
    conversationId: 'cid001', conversationType: '2', senderStaffId: 'staff-9',
    msgId: 'msg-77', text: { content: ' /collab SUI-42 接续 ' },
  });
  assert.ok(trigger);
  assert.equal(trigger.id, 'dingtalk:msg-77');
  assert.equal(trigger.actorId, 'staff-9');
  assert.equal(trigger.chatId, 'cid001');
  assert.equal(trigger.text, '/collab SUI-42 接续');
  assert.equal(trigger.direct, false);
  assert.equal(trigger.source, 'dingtalk');
  assert.equal(dingtalkToTrigger({ conversationId: 'c', msgId: 'm', text: { content: '   ' } }), undefined, '空文本不路由');
  assert.equal(dingtalkToTrigger({ text: { content: 'hi' } }), undefined, '缺关键字段不路由');
  const corpUser = dingtalkToTrigger({ conversationId: 'c', msgId: 'm', senderCorpId: 'dingcorp', senderUserId: 'u1', text: { content: 'hi' } });
  assert.equal(corpUser?.actorId, 'dingcorp/u1');
});

test('wecom plain-text XML normalizes; encrypted payloads are detected and rejected upstream', () => {
  const xml = '<xml><ToUserName><![CDATA[toUser]]></ToUserName><FromUserName><![CDATA[fromUser]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[ /collab SUI-42 接续 ]]></Content><MsgId>1234567890123456</MsgId></xml>';
  const trigger = wecomPlainXmlToTrigger(xml);
  assert.ok(trigger);
  assert.equal(trigger.id, 'wecom:1234567890123456');
  assert.equal(trigger.actorId, 'fromUser');
  assert.equal(trigger.text, '/collab SUI-42 接续');
  assert.equal(trigger.source, 'wecom');
  assert.equal(wecomIsEncrypted(xml), false);
  assert.equal(wecomIsEncrypted('<xml><Encrypt><![CDATA[b64]]></Encrypt></xml>'), true, '密文被识别，端点会如实报「尚未支持」');
  assert.equal(wecomPlainXmlToTrigger('<xml><MsgType><![CDATA[image]]></MsgType></xml>'), undefined, '非文本消息不路由');
});

test('signed URL keeps query parameters intact for webhooks that already carry tokens', () => {
  const url = dingtalkSignedUrl('https://oapi.dingtalk.com/robot/send?access_token=t', 'SEC', 1731110400000);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('access_token'), 't');
  assert.equal(parsed.searchParams.get('timestamp'), '1731110400000');
  assert.ok(parsed.searchParams.get('sign')?.length);
});
