import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { render } from '../../upstream/autoloop/plugins/feishu/channel.ts';
import { command } from '../commands.ts';

const messageId = z.string().regex(/^om_[a-zA-Z0-9_-]+$/);
const chatId = z.string().regex(/^oc_[a-zA-Z0-9_-]+$/);
export type CardReference = { ref: string; chat: string };
export type DecisionCard = { id: number; decision: string; title: string; text: string; options: string[];
  revision?: string; commit?: string; ref?: string; chat?: string; group?: boolean; chosen?: number; outcome?: string;
  consultation?: { project: string; topic: string; actor: string; request: string; trigger: Trigger; agents: string[] } };
export type CardTransport = {
  available?(): boolean;
  send(target: { user: string } | { message: string }, key: string, content: string): Promise<CardReference>;
  update(ref: string, content: string): Promise<void>;
};

export function cardContent(card: DecisionCard) {
  if (card.consultation) {
    const model = render({ id: card.id, title: card.title, text: '', options: card.options,
      version: 1, ref: card.ref ?? null, kind: card.chosen !== undefined ? 'notice' : 'ask',
      state: card.chosen === undefined ? 'open' : 'closed', recommend: null, choice: null, answer: null,
      result: card.chosen === undefined ? null : '已交给 ' + card.options[card.chosen], link: null });
    return JSON.stringify({ ...model, body: { elements: [plainText(card.text), ...model.body.elements.map(element => {
      if (element.tag !== 'interactive_container' || !('behaviors' in element)) return element;
      return { ...element, behaviors: element.behaviors!.map(behavior => ({ ...behavior, value: { ...behavior.value, kind: 'consultation' } })) };
    })] } });
  }
  return JSON.stringify(render({ id: card.id, title: card.title, text: card.text, options: card.options,
    version: 1, ref: card.ref ?? null, kind: 'ask', state: card.chosen !== undefined ? 'done' : card.outcome ? 'closed' : 'open',
    recommend: null, choice: card.chosen ?? null, answer: null, result: card.chosen === undefined ? card.outcome ?? null : null, link: null }));
}

const plainText = (content: string) => ({ tag: 'div', text: { tag: 'plain_text', content } });
const openLink = (label: string, url: string, primary = false) => ({ tag: 'button', width: 'fill',
  type: primary ? 'primary_filled' : 'default', text: { tag: 'plain_text', content: label },
  behaviors: [{ type: 'open_url', default_url: url }] });

export function consultationResultCard(input: { agent: string; summary: string; source: string; link?: string;
  delivery?: { pr: number; url: string; checks: { url?: string; name: string }[] } }) {
  const check = input.delivery?.checks.find(item => item.url);
  return JSON.stringify({ schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: { tag: 'plain_text', content: input.agent + ' · 只读咨询' }, template: 'blue' },
    body: { elements: [plainText(input.summary), plainText(input.source),
      ...(input.link ? [openLink('查看工作台完整回复', input.link, true)] : [plainText('完整回复可在工作台的项目主题中查看。')]),
      ...(input.delivery ? [openLink('PR #' + input.delivery.pr, input.delivery.url)] : []),
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
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL UNIQUE, value TEXT NOT NULL)`);
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
}
