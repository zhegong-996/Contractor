import {TeamMembers} from './members.ts';
import { feishuTrigger } from './upstream.ts';
import { createHash } from 'node:crypto';
import type { AgentServices } from './agent-services.ts';
import type { Workspaces } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';

// Uses Super-agent's actual event normalization and the existing event/outbox store.
// IM can resume a pre-bound task; it cannot choose sources, identities or permissions.
export class CollaborationIntake {
  constructor(readonly w: Workspaces, readonly assistant: WorkspaceAssistant, readonly services?: AgentServices) {}
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
    const pairing=/^\/member-pair\s+([a-f0-9]{32})$/.exec(trigger.text.trim());
    if(pairing){if(!trigger.meta.direct)throw new Error('请在机器人单聊中配对');return new TeamMembers(this.w).acceptPair(pairing[1]!,trigger.actor.id,String(trigger.meta.chatId));}
    const member=this.w.catalog?.().imMembers?.[trigger.actor.id];
    const memberActor=member&&member.chatId===trigger.meta.chatId?await new TeamMembers(this.w).resolve(member.userId):undefined;
    const serviceRequest = /^\/agent\s+([a-z][a-z0-9-]+)\s+([\s\S]+)$/.exec(trigger.text.trim());
    if (serviceRequest && this.services) {
      if (!memberActor&&(f.allowedSenders.length !== 1 || !f.allowedSenders.includes(trigger.actor.id) || !f.allowedChats.includes(String(trigger.meta.chatId)))) throw new Error('Unauthorized: personal Agent caller requires the configured owner binding');
      const seen = this.w.store.db.prepare('SELECT state,value FROM events WHERE id=?').get(trigger.id) as any;
      if (seen?.state === 'done') return { duplicate: true, ...JSON.parse(seen.value) };
      const profile = await this.services.profile(serviceRequest[1]!);
      const { serviceVersion } = await import('./agent-services.ts');
      const requestKey = createHash('sha256').update(trigger.id).digest('hex');
      const task = await this.services.start({serviceId:profile.id,expectedVersion:serviceVersion(profile),offer:profile.offers[0],title:serviceRequest[2]!.split('\n')[0]!.slice(0,120),goal:serviceRequest[2]!,requestKey}, {...memberActor,admin:true,userId:memberActor?.userId??'local-board'}, this.assistant,
        {messageId:String(trigger.meta.messageId),chatId:String(trigger.meta.chatId),senderId:trigger.actor.id});
      this.w.store.db.prepare('INSERT INTO events(id,state,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,value=excluded.value').run(trigger.id,'done',JSON.stringify({taskId:task.id}));
      this.w.store.notify('agent-service:'+trigger.id,task.id,`已交给${profile.name}：${task.identifier}。需要补充信息时会在这里问你。`);
      return {taskId:task.id,serviceId:profile.id};
    }

    let match: string[] | null = /^\/collab\s+(\S+)(?:\s+([\s\S]+))?$/.exec(trigger.text.trim());
    const followup = !match;
    if (followup && trigger.text.trim().startsWith('/')) return;
    if (!memberActor&&(!f.allowedSenders.includes(trigger.actor.id) || !f.allowedChats.includes(String(trigger.meta.chatId)))) throw new Error('Unauthorized: IM origin');
    if (!match) {
      const candidates = [];
      for (const t of this.w.store.list().filter(t => t.kind === 'collaboration' && t.phase !== 'accepted')) {
        const binding = (await this.w.state(t)).imBinding;
        if (binding?.senderId === trigger.actor.id && binding.chatId === trigger.meta.chatId) candidates.push(t);
      }
      if (candidates.length !== 1) return { routed: false, needsTaskReference: candidates.length > 1 };
      match = [trigger.text, candidates[0]!.id, trigger.text.trim()];
    }
    const task = this.w.store.get(match[1]!), state = await this.w.state(task), binding = state.imBinding;
    if(memberActor&&state.context?.requesterUserId&&state.context.requesterUserId!==memberActor.userId)throw new Error('Unauthorized: IM member ownership');
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
    if (!followup) this.w.store.notify('collab-intake:' + trigger.id, task.id, `${task.identifier} 已${detail === '暂停' ? '暂停自动处理' : '接续'}；沿用当前任务、来源和授权范围。\n${this.w.config.paperclipUrl}/SUI/knowledge-workspaces`);
    this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('done', trigger.id);
    return { taskId: task.id, resumed: detail !== '暂停' };
  }
}
