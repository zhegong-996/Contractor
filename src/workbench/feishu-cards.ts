import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { command } from '../commands.ts';

const messageId = z.string().regex(/^om_[a-zA-Z0-9_-]+$/);
const chatId = z.string().regex(/^oc_[a-zA-Z0-9_-]+$/);
export type CardReference = { ref: string; chat: string };
type InboxReference = CardReference & { digest: string };
export type DecisionCard = { id: number; decision: string; title: string; text: string; options: string[];
  revision?: string; commit?: string; ref?: string; chat?: string; group?: boolean; reviewUrl?: string; chosen?: number; outcome?: string;
  consultation?: { project: string; topic: string; actor: string; request: string; trigger: Trigger; agents: string[] } };
export type CardTransport = {
  available?(): boolean;
  send(target: { user: string } | { message: string }, key: string, content: string): Promise<CardReference>;
  update(ref: string, content: string): Promise<void>;
};

export function cardContent(card: DecisionCard) {
  const chosen = card.chosen !== undefined;
  const closed = !!card.outcome;
  const title = card.reviewUrl && (chosen || card.outcome === '已验收') ? '已验收' : card.title;
  const options = !chosen && !closed ? card.options.map((label, index) => ({
    tag: 'interactive_container', width: 'fill', has_border: true, border_color: 'grey', corner_radius: '8px',
    padding: '8px 12px 8px 12px',
    behaviors: [{ type: 'callback', value: { card: card.id, choice: index, ...(card.consultation && { kind: 'consultation' }) } }],
    elements: [plainText(label)],
  })) : [];
  const selection = card.chosen === undefined ? undefined : card.options[card.chosen];
  const outcome = card.consultation && selection ? '已交给 ' + selection
    : selection ? '你选了「' + selection + '」。已执行。'
      : closed ? '不用决定了：' + card.outcome : undefined;
  return JSON.stringify({ schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: { tag: 'plain_text', content: title }, template: closed || card.consultation && chosen ? 'grey' : chosen ? 'green' : 'blue' },
    body: { elements: [
      ...(card.reviewUrl && !closed ? [openLink('在工作台查看汇总', card.reviewUrl)] : []),
      ...(card.text ? [card.consultation ? plainText(card.text) : { tag: 'markdown', content: card.text }] : []),
      ...options,
      ...(outcome ? [plainText(outcome)] : []),
    ] } });
}

const plainText = (content: string) => ({ tag: 'div', text: { tag: 'plain_text', content } });
const openLink = (label: string, url: string, primary = false) => ({ tag: 'button', width: 'fill',
  type: primary ? 'primary_filled' : 'default', text: { tag: 'plain_text', content: label },
  behaviors: [{ type: 'open_url', default_url: url }] });

export function feishuInboxCard(items: { scope: string; group: string; title: string; link: string; action?: DecisionCard;
  work?: { label: string; url: string; ref: string } }[]) {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.scope) ?? [];
    if (!groups.has(item.scope)) groups.set(item.scope, list);
    list.push(item);
  }
  const elements: unknown[] = [plainText(items.length ? items.length + ' 项待处理' : '暂无待处理事项')];
  let shown = 0, actions = 0;
  for (const rows of groups.values()) {
    if (shown >= 12) break;
    elements.push({ tag: 'hr' }, plainText(rows[0]!.group));
    const links = new Set<string>();
    for (const row of rows) {
      if (shown >= 12) break;
      shown++;
      if (row.action && actions++ < 3) {
        const ref = row.work?.ref;
        const action = ref && row.action.revision
          ? { ...row.action, options: row.action.options.map(option => option + ' · ' + ref) }
          : row.action;
        const rendered = JSON.parse(cardContent(action)).body.elements as { tag: string }[];
        elements.push(plainText(row.title), ...rendered.filter(element => ['interactive_container', 'div', 'markdown'].includes(element.tag)));
      } else elements.push(plainText(row.title));
      if (row.work && !links.has(row.work.url)) {
        links.add(row.work.url);
        elements.push(openLink('打开' + row.work.label, row.work.url));
      }
    }
    elements.push(openLink('打开项目待办', rows[0]!.link));
  }
  if (shown < items.length) elements.push(plainText('另有 ' + (items.length - shown) + ' 项，请在工作台查看。'));
  return JSON.stringify({ schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: { tag: 'plain_text', content: 'Contractor · 待处理' }, template: 'blue' }, body: { elements } });
}

export type SharedConsultation = { agent: string; summary: string; source: string;
  delivery?: { pr: number; url: string; checks: { url?: string; name: string }[] } };
export function consultationResultCard(link?: string, shared?: SharedConsultation) {
  const check = shared?.delivery?.checks.find(item => item.url);
  return JSON.stringify({ schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: { tag: 'plain_text', content: shared ? shared.agent + ' · 只读咨询' : '咨询已处理' }, template: 'blue' },
    body: { elements: [
      ...(shared ? [plainText(shared.summary), plainText(shared.source)] : []),
      ...(link ? [openLink('查看工作台完整回复', link, true)] : [plainText('请在工作台查看处理结果。')]),
      ...(shared?.delivery ? [openLink('PR #' + shared.delivery.pr, shared.delivery.url)] : []),
      ...(check?.url ? [openLink('CI · ' + check.name.slice(0, 80), check.url)] : []),
    ] } });
}

export function feishuCardTransport(profile: string): CardTransport {
  const lark = async (args: string[], input?: string) => {
    const result = JSON.parse(await command('lark-cli', ['--profile', profile, ...args, '--as', 'bot'], undefined, input));
    if (result.ok === false || result.error || result.code && result.code !== 0) throw new Error('飞书卡片操作失败');
    return result;
  };
  return {
    async send(target, key, content) {
      const args = 'message' in target ? ['+messages-reply', '--message-id', target.message, '--reply-in-thread']
        : ['+messages-send', '--user-id', target.user];
      // Older lark-cli versions accept stdin for raw API data but not the reply shortcut's --content.
      const { data } = await lark(['im', ...args, '--msg-type', 'interactive', '--idempotency-key', key, '--content', content]);
      return { ref: messageId.parse(data?.message_id), chat: chatId.parse(data?.chat_id) };
    },
    async update(ref, content) {
      await lark(['api', 'PATCH', '/open-apis/im/v1/messages/' + messageId.parse(ref), '--data', '-'], JSON.stringify({ content }));
    },
  };
}

export function readCardClick(line: string) {
  const event = z.object({ type: z.literal('card.action.trigger').optional(), event_id: z.string().min(1).max(200),
    operator_id: z.string().regex(/^ou_[a-zA-Z0-9_-]+$/), message_id: messageId, chat_id: chatId,
    action_value: z.string().max(1024) }).parse(JSON.parse(line));
  const action = z.object({ card: z.number().int().positive(), choice: z.number().int().nonnegative(),
    kind: z.literal('consultation').optional() }).strict().parse(JSON.parse(event.action_value));
  return { ...action, nonce: event.event_id, operator: event.operator_id, ref: event.message_id, chat: event.chat_id };
}

export class FeishuDecisionCards {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_feishu_decision_card (
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL UNIQUE, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_feishu_inbox (
        account TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }

  get(id: number | string): DecisionCard | undefined {
    const row = this.db.prepare(typeof id === 'number' ? 'SELECT id,value FROM workbench_feishu_decision_card WHERE id=?'
      : 'SELECT id,value FROM workbench_feishu_decision_card WHERE decision=?').get(id);
    return row && { ...JSON.parse(String(row.value)), id: Number(row.id) };
  }

  register(card: Omit<DecisionCard, 'id'>) {
    this.db.prepare('INSERT OR IGNORE INTO workbench_feishu_decision_card(decision,value) VALUES (?,?)')
      .run(card.decision, JSON.stringify(card));
    return this.get(card.decision)!;
  }

  save(card: DecisionCard) {
    this.db.prepare('UPDATE workbench_feishu_decision_card SET value=? WHERE id=?').run(JSON.stringify(card), card.id);
  }

  inbox(account: string): InboxReference | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_feishu_inbox WHERE account=?').get(account);
    return row && JSON.parse(String(row.value));
  }

  saveInbox(account: string, value: InboxReference) {
    this.db.prepare('INSERT OR REPLACE INTO workbench_feishu_inbox VALUES (?,?)').run(account, JSON.stringify(value));
  }

  pendingConsultations(actor: string): DecisionCard[] {
    return this.db.prepare(`SELECT id,value FROM workbench_feishu_decision_card
      WHERE json_extract(value,'$.consultation.actor')=? AND json_extract(value,'$.chosen') IS NULL
      ORDER BY id DESC`).all(actor).map(row => ({ ...JSON.parse(String(row.value)), id: Number(row.id) }));
  }
}
