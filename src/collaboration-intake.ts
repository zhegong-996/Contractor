import { feishuTrigger } from './upstream.ts';
import type { Workspaces } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';

// Uses Super-agent's actual event normalization and the existing event/outbox store.
// IM can resume a pre-bound task; it cannot choose sources, identities or permissions.
export class CollaborationIntake {
  constructor(readonly w: Workspaces, readonly assistant: WorkspaceAssistant) {}
  async enable(taskId: string, actor: { admin: boolean }) {
    this.w.manager(actor); const f = this.w.config.feishu;
    if (f.allowedSenders.length !== 1 || f.allowedChats.length !== 1) throw new Error('先为本任务配置唯一的飞书发起人和会话');
    const task = this.w.store.get(taskId), state = await this.w.state(task);
    if (task.phase === 'accepted') throw new Error('已完成任务不能重新绑定IM');
    state.imBinding = { senderId: f.allowedSenders[0]!, chatId: f.allowedChats[0]! };
    await this.w.save(task, state, 'im-enabled', { scope: '已配置的唯一飞书发起人和会话' }); return { identifier: task.identifier, command: '/collab ' + task.identifier + ' 接续' };
  }
  async ingest(input: unknown) {
    const f = this.w.config.feishu, trigger = feishuTrigger(input, f.botId, f.appId);
    if (!trigger?.human || !trigger.addressed) return;
    const match = /^\/collab\s+(\S+)(?:\s+([\s\S]+))?$/.exec(trigger.text.trim()); if (!match) return;
    if (!f.allowedSenders.includes(trigger.actor.id) || !f.allowedChats.includes(String(trigger.meta.chatId))) throw new Error('Unauthorized: IM origin');
    const task = this.w.store.get(match[1]!), state = await this.w.state(task), binding = state.imBinding;
    if (!binding || binding.senderId !== trigger.actor.id || binding.chatId !== trigger.meta.chatId) throw new Error('Unauthorized: task IM binding');
    if (task.phase === 'accepted') throw new Error('任务已完成');
    const seen = this.w.store.db.prepare('SELECT state FROM events WHERE id=?').get(trigger.id) as any;
    if (seen?.state === 'done') return { duplicate: true, taskId: task.id };
    this.w.store.db.prepare('INSERT OR IGNORE INTO events(id,state,value) VALUES(?,?,?)').run(trigger.id, 'pending', JSON.stringify({ taskId: task.id, messageId: trigger.meta.messageId }));
    task.chatId = binding.chatId; task.senderId = binding.senderId;
    if (!task.messageId.startsWith('om_')) task.messageId = String(trigger.meta.messageId);
    await this.w.save(task, state, 'im-resumed', { messageId: trigger.meta.messageId, eventId: trigger.id });
    const detail = match[2]?.trim() ?? '接续';
    if (!['接续', '暂停'].includes(detail)) await this.assistant.taskContext.note(task.id, detail, { admin: true });
    await this.assistant.delegate(task.id, detail !== '暂停', state.delegation?.mode ?? 'advance', state.delegation?.instruction ?? '', { admin: true }, trigger.id);
    this.w.store.notify('collab-intake:' + trigger.id, task.id, `${task.identifier} 已${detail === '暂停' ? '暂停自动处理' : '接续'}；沿用当前任务、来源和授权范围。\n${this.w.config.paperclipUrl}/SUI/knowledge-workspaces`);
    this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('done', trigger.id);
    return { taskId: task.id, resumed: detail !== '暂停' };
  }
}
