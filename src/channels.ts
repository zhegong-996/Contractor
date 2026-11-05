// Channel adapter layer — v0.6 P0.
//
// Product shape (KEEP, do not replace): an IM conversation is where work
// starts and where notifications arrive; the Paperclip plugin workbench is
// where records, grants and approvals live. Every new v0.6 semantic object
// must therefore render into BOTH:
//   (a) a plain-text message + workbench link for the current Feishu channel;
//   (b) a structured payload for richer channels added later.
// Degradation must never drop semantic fields — a Transfer card sent as text
// still states who authorized it, its scope, who wrote the standard, etc.
//
// Honest boundary: today the ONLY wired conversational channel is Feishu.
// CLI / MCP / A2A / workspace are execution or delegation endpoints, not IM
// channels. They are listed here so adding a second IM never rewrites the
// business objects.
import { feishuTrigger, feishuThreadId } from './upstream.ts';

export type ChannelId = 'feishu' | 'cli' | 'mcp' | 'a2a' | 'workspace';

export interface ChannelContext { botId: string; appId: string; workbenchUrl: string }

export interface ChannelEnvelope {
  channel: ChannelId;
  triggerId: string;
  actorId: string;
  chatId: string;
  messageId: string;
  text: string;
  human: boolean;
  addressed: boolean;
  direct: boolean;
  threadId?: string;
  meta: Record<string, unknown>;
}

export interface ChannelCapabilities {
  cards: boolean;
  threads: boolean;
  reactions: boolean;
  richText: boolean;
}

export interface ChannelAdapter {
  id: ChannelId;
  capabilities: ChannelCapabilities;
  /** Return undefined when this is not an event for this channel. Must not throw. */
  normalize(input: unknown, ctx: ChannelContext): ChannelEnvelope | undefined;
}

export const PLAIN_TEXT: ChannelCapabilities = { cards: false, threads: false, reactions: false, richText: false };

/** Capabilities of the non-IM endpoints, for future adapters. Not registered as conversation sources. */
export const endpointCapabilities = {
  cli: PLAIN_TEXT,
  mcp: { cards: true, threads: false, reactions: false, richText: true },
  a2a: { cards: true, threads: true, reactions: false, richText: true },
  workspace: { cards: true, threads: true, reactions: false, richText: true },
} satisfies Record<Exclude<ChannelId, 'feishu'>, ChannelCapabilities>;

export const feishuAdapter: ChannelAdapter = {
  id: 'feishu',
  // Outbound messages today are plain text only; no interactive card is built.
  capabilities: { cards: false, threads: true, reactions: false, richText: false },
  normalize(input, ctx) {
    // Upstream validates with Zod and THROWS on a non-Feishu payload. A registry
    // probe must stay silent instead of breaking the whole ingest chain.
    let t: ReturnType<typeof feishuTrigger>;
    try { t = feishuTrigger(input, ctx.botId, ctx.appId); } catch { return undefined; }
    if (!t) return undefined;
    const chatId = String(t.meta.chatId ?? '');
    const messageId = String(t.meta.messageId ?? '');
    const rootId = typeof t.meta.rootId === 'string' ? t.meta.rootId : undefined;
    let threadId: string | undefined;
    try { threadId = chatId && messageId ? feishuThreadId(chatId, rootId, messageId) : undefined; } catch { threadId = undefined; }
    return {
      channel: 'feishu', triggerId: t.id, actorId: t.actor.id, chatId, messageId,
      text: t.text, human: t.human === true, addressed: Boolean(t.addressed),
      direct: t.meta.direct === true, ...(threadId ? { threadId } : {}), meta: t.meta,
    };
  },
};

/** The local workbench/API entry is a structured call, not an IM event, so it gets a factory rather than a normalizer. */
export function workspaceEnvelope(input: { requestKey: string; text: string; actorId?: string }): ChannelEnvelope {
  return {
    channel: 'workspace', triggerId: input.requestKey, actorId: input.actorId ?? 'local-operator',
    chatId: 'local-workspace', messageId: 'local-workspace', text: input.text,
    human: true, addressed: true, direct: true, meta: { source: 'workspace' },
  };
}

/** The v0.6 objects that need to reach a human in the conversation. */
export type SemanticObject =
  | { kind: 'transfer-card'; taskId: string; identifier?: string; grantor: string; grantee: string;
      capability: string; scope: string; standardOwner: string; counterSigner?: string; expiresAt?: string }
  | { kind: 'acceptance-report'; taskId: string; identifier?: string; round: number; level: string;
      reviewer: string; passed: number; failed: string[] }
  | { kind: 'context-grant'; taskId: string; space: string; granularity: string;
      approver: string; readonly: boolean; expiresAt?: string }
  | { kind: 'organization-signal'; metric: string; value: string; hint: string }
  | { kind: 'task-notice'; taskId: string; identifier?: string; text: string };

export interface RenderedMessage {
  text: string;
  link: string;
  card?: Record<string, unknown>;
  degraded: boolean;
}

function fields(obj: SemanticObject): { title: string; rows: string[] } {
  switch (obj.kind) {
    case 'transfer-card': return { title: '跨职能授权（Transfer）', rows: [
      `任务：${obj.identifier ?? obj.taskId}`,
      `授权人：${obj.grantor}`,
      `承接人：${obj.grantee}`,
      `能力依据：${obj.capability}`,
      `授权范围：${obj.scope}（默认仅本 Task）`,
      `验收标准起草方：${obj.standardOwner}（承接人不得自定标准）`,
      `联签人：${obj.counterSigner ?? '高风险动作时追加'}`,
      `有效期：${obj.expiresAt ?? '本 Task 结束即失效'}`,
    ] };
    case 'acceptance-report': return { title: '逐项验收报告', rows: [
      `任务：${obj.identifier ?? obj.taskId}`,
      `轮次：第 ${obj.round} 轮　验证等级：${obj.level}`,
      `独立评审者：${obj.reviewer}（不得是产出模型）`,
      `通过：${obj.passed} 项`,
      `未通过（只退这些项）：${obj.failed.length ? obj.failed.join('、') : '无'}`,
      '本报告的签字人仍是任务发起人，报告只是核可依据。',
    ] };
    case 'context-grant': return { title: '跨空间资料授权', rows: [
      `任务：${obj.taskId}　目标空间：${obj.space}`,
      `最小可见粒度：${obj.granularity}`,
      `审批人：${obj.approver}（目标空间 owner）`,
      `权限：${obj.readonly ? '只读' : '按授权范围'}`,
      `有效期：${obj.expiresAt ?? '有期限，可撤销'}`,
    ] };
    case 'organization-signal': return { title: '组织状态提示', rows: [
      `指标：${obj.metric}　当前值：${obj.value}`,
      `建议：${obj.hint}`,
      '仅提示，不拦截任务、不做人员排名与考核。',
    ] };
    case 'task-notice': return { title: '任务进展', rows: [
      `任务：${obj.identifier ?? obj.taskId}`, obj.text,
    ] };
  }
}

/** One renderer for every channel; capability decides presentation, never content. */
export function renderForChannel(obj: SemanticObject, opts: {
  capabilities: ChannelCapabilities; workbenchUrl: string;
}): RenderedMessage {
  const { title, rows } = fields(obj);
  // The existing plugin workbench entry. No new route, no new frontend app.
  const link = opts.workbenchUrl.replace(/\/$/, '') + '/SUI/knowledge-workspaces';
  const text = [`【${title}】`, ...rows, '', `工作台（完整记录与签字）：${link}`].join('\n');
  const card = opts.capabilities.cards
    ? { type: 'semantic-object', kind: obj.kind, title, fields: rows, data: obj, workbenchUrl: link }
    : undefined;
  return { text, link, ...(card ? { card } : {}), degraded: !opts.capabilities.cards };
}

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();
  register(adapter: ChannelAdapter): this { this.adapters.set(adapter.id, adapter); return this; }
  capabilities(id: ChannelId): ChannelCapabilities { return this.adapters.get(id)?.capabilities ?? PLAIN_TEXT; }
  /** Probe adapters in order. A malformed event for one channel must not stop the others. */
  normalize(input: unknown, ctx: ChannelContext): { envelope: ChannelEnvelope; adapter: ChannelAdapter } | undefined {
    for (const adapter of this.adapters.values()) {
      try {
        const envelope = adapter.normalize(input, ctx);
        if (envelope) return { envelope, adapter };
      } catch { /* keep probing */ }
    }
    return undefined;
  }
  render(obj: SemanticObject, channelId: ChannelId, workbenchUrl: string): RenderedMessage {
    return renderForChannel(obj, { capabilities: this.capabilities(channelId), workbenchUrl });
  }
  list(): { id: ChannelId; capabilities: ChannelCapabilities }[] {
    return [...this.adapters.values()].map(a => ({ id: a.id, capabilities: a.capabilities }));
  }
}

export function defaultRegistry(): ChannelRegistry { return new ChannelRegistry().register(feishuAdapter); }
