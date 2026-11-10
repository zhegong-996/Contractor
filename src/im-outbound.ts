/**
 * 第三十六轮 · 钉钉 / 企业微信通道。
 *
 * 用户 2026-11-09 拍板：「钉钉/企微通道…这几个也都要做」。此前边界是
 * 「飞书是唯一会话通道」；本轮把钉钉与企微做成**补充送达通道**：
 *   - 出站（立即可用）：群自定义机器人的 webhook（HTTPS POST JSON），
 *     镜像「人类必须知晓」的通知（提问 / 验收 / 授权 / PR 请求），
 *     与飞书共享 v0.6 注意力预算——护栏判定不送达的通知同样不镜像，
 *     不给钉钉/企微开小灶。钉钉支持加签（secret + timestamp HMAC）。
 *   - 入站（需要公网回调，可选）：bridge 暴露 POST /im/dingtalk 与
 *     /im/wecom 端点，消息转成 NativeTrigger 走与飞书相同的 ingest 链，
 *     白名单按通道独立配置（allowedSenders，默认空 = 拒绝所有）。
 *     bridge 只绑 127.0.0.1，公网暴露需自行反代——如实边界。
 *     企微回调的加密模式（EncodingAESKey）本轮不实现，明文模式可用，
 *     端点对密文如实返回错误，不假装解密。
 *
 * 红线（不放宽）：钉钉/企微上的回答与飞书一样走 ingestTrigger 的
 * 绑定任务链路；验收 / 核可 / 放行不因为通道不同而放宽。
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.ts';

export const dingtalkConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** 群自定义机器人 webhook 地址的环境变量名（凭据绝不进 config / 仓库）。 */
  webhookEnv: z.string().min(1).default('DINGTALK_WEBHOOK_URL'),
  /** 加签密钥的环境变量名；机器人若未开加签可不设。 */
  secretEnv: z.string().min(1).default('DINGTALK_SECRET'),
  /** 入站白名单（钉钉 senderStaffId / userId）；空数组 = 拒绝所有入站消息。 */
  allowedSenders: z.array(z.string()).default([]),
}).strict();
export type DingtalkConfig = z.infer<typeof dingtalkConfigSchema>;
export function defaultDingtalkConfig(): DingtalkConfig { return dingtalkConfigSchema.parse({}); }

export const wecomConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhookEnv: z.string().min(1).default('WECOM_WEBHOOK_URL'),
  /** 回调验签用的 Token 的环境变量名（第七十一轮补：之前只有出站，入站无从验签）。 */
  tokenEnv: z.string().min(1).default('WECOM_CALLBACK_TOKEN'),
  /**
   * 是否允许「无签名明文入站」。企微明文模式不提供消息签名，因此这类入站天然无法验签；
   * 默认 false（拒收）。开启前请确认 allowedSenders 非空——那是唯一的兜底。
   */
  allowUnsignedPlaintext: z.boolean().default(false),
  allowedSenders: z.array(z.string()).default([]),
}).strict();
export type WecomConfig = z.infer<typeof wecomConfigSchema>;
export function defaultWecomConfig(): WecomConfig { return wecomConfigSchema.parse({}); }

export type ImSendResult = { channel: 'dingtalk' | 'wecom'; ok: boolean; error?: string };

/** 钉钉加签：sign = base64(hmacSHA256(secret, `${timestamp}\n${secret}`))，拼进 webhook URL。 */
export function dingtalkSignedUrl(webhook: string, secret: string, timestamp: number): string {
  const sign = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  return `${webhook}${webhook.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

async function postJson(fetchImpl: typeof globalThis.fetch, url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: { errcode?: number; errmsg?: string; error?: unknown } = {};
    try { parsed = JSON.parse(text) as typeof parsed; } catch { /* 非 JSON 响应 */ }
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    // 钉钉返回 {errcode:0}；企微群机器人返回 {errcode:0,errmsg:'ok'}。
    if (typeof parsed.errcode === 'number' && parsed.errcode !== 0) return { ok: false, error: `errcode ${parsed.errcode}: ${parsed.errmsg ?? ''}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

/** 出站：钉钉群机器人（markdown 消息；开加签的机器人自动带签名）。 */
export async function sendDingtalk(opts: {
  webhook: string; secret?: string; title: string; text: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<ImSendResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = opts.secret ? dingtalkSignedUrl(opts.webhook, opts.secret, Date.now()) : opts.webhook;
  const result = await postJson(fetchImpl, url, { msgtype: 'markdown', markdown: { title: opts.title.slice(0, 60), text: opts.text.slice(0, 1800) } });
  return { channel: 'dingtalk', ...result };
}

/** 出站：企业微信群机器人（markdown 消息）。 */
export async function sendWecom(opts: {
  webhook: string; title: string; text: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<ImSendResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const content = `**${opts.title.slice(0, 60)}**\n\n${opts.text}`.slice(0, 1800);
  const result = await postJson(fetchImpl, opts.webhook, { msgtype: 'markdown', markdown: { content } });
  return { channel: 'wecom', ...result };
}

export function dingtalkEndpoint(config: Config, env: Record<string, string | undefined> = process.env): { enabled: boolean; webhook?: string; secret?: string } {
  const cfg = config.dingtalk;
  if (!cfg?.enabled) return { enabled: false };
  const webhook = env[cfg.webhookEnv];
  if (!webhook) return { enabled: false };
  return { enabled: true, webhook, secret: env[cfg.secretEnv] };
}

export function wecomEndpoint(config: Config, env: Record<string, string | undefined> = process.env): { enabled: boolean; webhook?: string } {
  const cfg = config.wecom;
  if (!cfg?.enabled) return { enabled: false };
  const webhook = env[cfg.webhookEnv];
  return webhook ? { enabled: true, webhook } : { enabled: false };
}

/**
 * 入站：钉钉企业内部机器人回调（明文 JSON）。字段口径按钉钉文档：
 * conversationId / senderStaffId（企业内部）或 senderCorpId+senderUserId、
 * text.content、msgId、conversationType（'1' = 单聊）。
 */
export function dingtalkToTrigger(payload: Record<string, unknown>): { id: string; actorId: string; chatId: string; messageId: string; text: string; direct: boolean; source: string } | undefined {
  const content = (payload.text as Record<string, unknown> | undefined)?.content;
  const messageId = typeof payload.msgId === 'string' ? payload.msgId : undefined;
  const chatId = typeof payload.conversationId === 'string' ? payload.conversationId : undefined;
  const actorId = typeof payload.senderStaffId === 'string' ? payload.senderStaffId
    : typeof payload.senderUserId === 'string' ? `${String(payload.senderCorpId ?? 'corp')}/${payload.senderUserId}` : undefined;
  if (!messageId || !chatId || !actorId || typeof content !== 'string' || !content.trim()) return undefined;
  return { id: 'dingtalk:' + messageId, actorId, chatId, messageId, text: content.trim(),
    direct: payload.conversationType === '1', source: 'dingtalk' };
}

/** 企微明文 XML 的最小字段提取（ToUserName/FromUserName/MsgType/Content/MsgId）；不用正则跨行捕获以外的解析器。 */
export function wecomPlainXmlToTrigger(xml: string): { id: string; actorId: string; chatId: string; messageId: string; text: string; direct: boolean; source: string } | undefined {
  const field = (name: string) => { const m = xml.match(new RegExp(`<${name}><!\\[CDATA\\[(.*?)\\]\\]></${name}>`, 's')) ?? xml.match(new RegExp(`<${name}>(.*?)</${name}>`, 's')); return m?.[1]; };
  const msgType = field('MsgType'), content = field('Content'), from = field('FromUserName'), to = field('ToUserName'), msgId = field('MsgId');
  if (msgType !== 'text' || !content?.trim() || !from || !to || !msgId) return undefined;
  return { id: 'wecom:' + msgId, actorId: from, chatId: to, messageId: msgId, text: content.trim(), direct: false, source: 'wecom' };
}

/** 企微回调是否是加密模式（密文）：Encrypt 节点存在即视为加密。 */
export function wecomIsEncrypted(xml: string): boolean { return xml.includes('<Encrypt>'); }

// ---------------------------------------------------------------------------
// 第七十一轮 · 入站验签。
//
// 之前的缺口很实在：/im/dingtalk 与 /im/wecom 直接解析 body 就 ingest，
// 任何人 POST 一次就能造任务；而 /events/ 反而有签名校验。这里补齐，并且
// **fail-closed**：没配密钥一律拒收，与 event-inbox 的立场一致。

function equalStr(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 入站校验结果：ok=false 时 reason 直接回给调用方，便于配置排错。 */
export type ImVerifyResult = { ok: boolean; reason?: string };

/** 回调时间窗：超过 5 分钟视为重放。 */
const CALLBACK_WINDOW_MS = 5 * 60 * 1000;

/**
 * 钉钉回调验签：`sign = base64(HmacSHA256(timestamp + "\n" + secret, secret))`。
 *
 * 与出站加签（dingtalkSignedUrl）用同一个 secret，算法一致——所以配好一次即可。
 */
export function verifyDingtalkCallback(input: {
  secret: string; timestamp?: string; sign?: string; now?: number;
}): ImVerifyResult {
  if (!input.secret) return { ok: false, reason: '未配置回调加签密钥（DINGTALK_SECRET），入站一律拒收' };
  const timestamp = input.timestamp ?? '', sign = input.sign ?? '';
  if (!timestamp || !sign) return { ok: false, reason: '缺少 sign / timestamp 请求头' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp 不是数字' };
  if (Math.abs((input.now ?? Date.now()) - ts) > CALLBACK_WINDOW_MS) {
    return { ok: false, reason: 'timestamp 超出 5 分钟窗口，按重放拒收' };
  }
  const expected = createHmac('sha256', input.secret).update(`${timestamp}\n${input.secret}`).digest('base64');
  return equalStr(expected, sign) ? { ok: true } : { ok: false, reason: '签名不匹配' };
}

/**
 * 企业微信回调验签：`msg_signature = sha1(sort(token, timestamp, nonce, body))`。
 *
 * body 在 URL 验证时是 echostr；消息体在加密模式下是 <Encrypt> 的值。
 * 明文模式企微不提供消息签名——那种情况只能靠 allowedSenders 白名单兜底，
 * 本函数对"明文消息体"返回 ok:false 并说明原因，不假装验过。
 */
export function verifyWecomCallback(input: {
  token: string; timestamp?: string; nonce?: string; signature?: string;
  body: string; encrypted?: boolean; now?: number;
}): ImVerifyResult {
  if (!input.token) return { ok: false, reason: '未配置回调 Token（WECOM_CALLBACK_TOKEN），入站一律拒收' };
  const timestamp = input.timestamp ?? '', nonce = input.nonce ?? '', signature = input.signature ?? '';
  if (!timestamp || !nonce || !signature) return { ok: false, reason: '缺少 msg_signature / timestamp / nonce' };
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && Math.abs((input.now ?? Date.now()) - ts) > CALLBACK_WINDOW_MS) {
    return { ok: false, reason: 'timestamp 超出 5 分钟窗口，按重放拒收' };
  }
  if (input.encrypted === false) {
    return { ok: false, reason: '明文模式企微不提供消息签名，无法验签；请启用加密模式或仅依赖发送人白名单' };
  }
  const expected = createHash('sha1').update([input.token, timestamp, nonce, input.body].sort().join('')).digest('hex');
  return equalStr(expected, signature) ? { ok: true } : { ok: false, reason: '签名不匹配' };
}
