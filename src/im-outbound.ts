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
import { createHmac } from 'node:crypto';
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
