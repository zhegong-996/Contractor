import {TeamMembers} from './members.ts';
import { feishuTrigger, type NativeTrigger } from './upstream.ts';
import { mapFollowupToAnswer } from './collaboration-loop.ts';
import { createHash } from 'node:crypto';
import type { HitlSink } from './step-hitl.ts';
import { resolveHitlSink } from './step-hitl.ts';
import { persistHitlAnswer, routeAnswerToHitl } from './hitl-bridge.ts';
import { parseUserCommand } from './user-language.ts';
import { passThroughDecision } from './pass-through.ts';
import { assessAdmission, inferredAcknowledgement } from './admission.ts';
import { isReconcileRequest, reconcile } from './reconcile.ts';
import { addDiscussionComment, discussionDir } from './acceptance-discussion.ts';
import type { AgentServices } from './agent-services.ts';
import type { Workspaces } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';

// Uses Super-agent's actual event normalization and the existing event/outbox store.
// IM can resume a pre-bound task; it cannot choose sources, identities or permissions.
export class CollaborationIntake {
  constructor(readonly w: Workspaces, readonly assistant: WorkspaceAssistant, readonly services?: AgentServices,
    /** HITL 台账解析；默认走 resolveHitlSink，测试可注入内存台账。 */
    private readonly hitlSink: () => HitlSink = resolveHitlSink) {}
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
    return this.ingestTrigger(trigger);
  }

  /**
   * 第三十六轮拆分：飞书 / 钉钉 / 企微入站共用这条「已归一化触发」链路。
   * 白名单按 trigger.meta.source 分流：飞书维持 sender + chat 双白名单（行为
   * 逐字不变）；钉钉 / 企微只认各自通道的 allowedSenders（默认空 = 拒绝所有
   * 入站），会话不限（'*' 通配，回调会话 ID 无法预登记）。
   */
  private admissionFor(trigger: NativeTrigger): { senders: string[]; chats: string[]; label: string } {
    const source = typeof trigger.meta.source === 'string' ? trigger.meta.source : '';
    if (source === 'dingtalk') { const d = this.w.config.dingtalk; return { senders: d?.allowedSenders ?? [], chats: ['*'], label: 'dingtalk' }; }
    if (source === 'wecom') { const w = this.w.config.wecom; return { senders: w?.allowedSenders ?? [], chats: ['*'], label: 'wecom' }; }
    const f = this.w.config.feishu; return { senders: f.allowedSenders, chats: f.allowedChats, label: 'feishu' };
  }

  /**
   * 已释放订阅的任务 id：以审计事实为准。释放发生在验收回执落库的同一步
   * （controller 写 subscription.released），所以这里查得到就说明真的释放了；
   * 查不到不臆测，按 phase 兜底（仍不复活）。
   */
  private releasedSubscriptions(): Set<string> {
    try {
      const rows = this.w.store.db
        .prepare("SELECT DISTINCT issue_id FROM audit WHERE action='subscription.released' AND issue_id IS NOT NULL")
        .all() as { issue_id: string }[];
      return new Set(rows.map(row => row.issue_id));
    } catch { return new Set(); }
  }

  async ingestTrigger(trigger: NativeTrigger) {
    const origin = this.admissionFor(trigger);
    const pairing=/^\/member-pair\s+([a-f0-9]{32})$/.exec(trigger.text.trim());
    if(pairing){if(!trigger.meta.direct)throw new Error('请在机器人单聊中配对');return new TeamMembers(this.w).acceptPair(pairing[1]!,trigger.actor.id,String(trigger.meta.chatId));}
    const member=this.w.catalog?.().imMembers?.[trigger.actor.id];
    const paired=Boolean(member&&member.chatId===trigger.meta.chatId);
    let memberActor: Awaited<ReturnType<TeamMembers['resolve']>>|undefined,pairingValid=false;
    if(paired){try{memberActor=await new TeamMembers(this.w).resolve(member!.userId);pairingValid=true;}catch{memberActor=undefined;}}
    // 第四十一轮 · 准入强度三档（纯函数见 src/admission.ts）：
    // explicit 走原链路；inferred 只回一条说明 + 留待确认；not-admitted 拒绝且不回话。
    const admission=assessAdmission({channel:origin.label,senderId:trigger.actor.id,chatId:String(trigger.meta.chatId),
      paired,pairingValid,
      allowlisted:origin.senders.includes(trigger.actor.id)&&(origin.chats.includes('*')||origin.chats.includes(String(trigger.meta.chatId))),
      allowlistSize:origin.senders.length});
    if(admission.handling==='reject')throw new Error('Unauthorized: '+origin.label+' origin（'+admission.reason+'）');
    if(admission.handling==='acknowledge'){
      // 推断准入：不建单、不续跑、不读知识、不写业务状态，只留一条可被负责人看到的待确认。
      this.w.store.audit('admission.inferred','',{channel:origin.label,senderId:trigger.actor.id,chatId:String(trigger.meta.chatId),
        strength:admission.strength,reason:admission.reason,evidence:admission.evidence,eventId:trigger.id,textPreview:trigger.text.slice(0,80)});
      this.w.store.notify('admission-inferred:'+trigger.id,'',inferredAcknowledgement(origin.label));
      return {admitted:false,strength:admission.strength,handling:admission.handling,reason:admission.reason};
    }
    const serviceRequest = /^\/agent\s+([a-z][a-z0-9-]+)\s+([\s\S]+)$/.exec(trigger.text.trim());
    if (serviceRequest && this.services) {
      if (!memberActor) {
        if (origin.label === 'feishu') {
          if (origin.senders.length !== 1 || !origin.senders.includes(trigger.actor.id) || !origin.chats.includes(String(trigger.meta.chatId))) throw new Error('Unauthorized: personal Agent caller requires the configured owner binding');
        } else if (!origin.senders.includes(trigger.actor.id)) {
          throw new Error('Unauthorized: personal Agent caller is not in the ' + origin.label + ' allowlist');
        }
      }
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
    // 第二十九轮 P-11 修复：显式中文指令（建单 / 进度 / 验收 / 退回 / 转交）
    // 不能被当成绑定任务的「补充说明」记进笔记并唤醒执行——尤其「确认验收」
    // 必须走 Controller 的核可链。这里返回 undefined 让外层落回 Controller；
    // 「回答 <问题编号> <选项>」不是指令词表里的动作，仍由本 intake 路由。
    const explicit = parseUserCommand(trigger.text.replace(/@[^\s]+\s*/g, '').trim());
    if (explicit && ['task', 'status', 'accept', 'reject', 'handoff'].includes(explicit.action)) return;
    // 准入已在上方按三档判定：走到这里的只有 explicit（成员身份或单负责人白名单）。
    if (!match) {
      // 直通：同一会话的补充说明直接接续原任务，不建新单、不过 Router。
      // 判定收敛在 pass-through.ts 的纯函数里，边界可单测（绑定 / 已完成 / 多条 / 归属 / 越界）。
      // 第四十一轮 · 订阅生命周期：释放（验收后释放绑定）与越界交回（改授权面）
      // 都从直通里分出来，各自有名字、有审计，不再靠「执行端自己看着办」。
      const released = this.releasedSubscriptions();
      const candidates = [];
      for (const t of this.w.store.list().filter(t => t.kind === 'collaboration')) {
        const st = await this.w.state(t);
        candidates.push({ id: t.id, phase: t.phase, binding: st.imBinding,
          requesterUserId: st.context?.requesterUserId, released: released.has(t.id) });
      }
      const pass = passThroughDecision({
        explicitAction: null, candidates, text: trigger.text,
        actor: { id: trigger.actor.id, chatId: String(trigger.meta.chatId) },
        member: memberActor?.userId ? { userId: memberActor.userId } : null,
      });
      if (!pass.direct) {
        if (pass.deny) throw new Error(pass.reason);
        if (pass.kind === 'hand-back') {
          // 交回主链路：留痕 + 回执，然后 routed:false 让外层落回 Controller，
          // 由派活层与账号体系决定这件事该怎么办（本层不放行、也不替它决定）。
          this.w.store.audit('subscription.handed-back', pass.taskId ?? '', {
            eventId: trigger.id, actor: trigger.actor.id, reason: pass.reason,
            textPreview: trigger.text.slice(0, 120),
          });
          this.w.store.notify('subscription-handback:' + trigger.id, pass.taskId ?? '',
            `这条要求超出当前任务的授权范围，已交回主链路处理：${pass.reason}。原任务的授权与验收范围没有变化。`);
          return { routed: false, handBack: true, reason: pass.reason };
        }
        return { routed: false, reason: pass.reason, ...(pass.needsTaskReference ? { needsTaskReference: true } : {}) };
      }
      match = [trigger.text, pass.taskId!, trigger.text.trim()];
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
    // 上游协议耦合：飞书「补充说明」本来就会经 delegate 唤醒下一轮，这里补上
    // 「人 → 执行端」的下行应答留痕，使 IM 写回与执行端上行提问能对成回路。
    // 第二十八轮 P-10：显式格式「回答 <问题编号> <选项>」不再只留观察，而是
    // 路由进 Runner 成对 HITL 台账并产出 advisory 回流建议（参考 OpenMausBot
    // question 卡片的人侧回写）。路由成功时台账是这条回答的规范留痕，不再重复
    // 写 loop.downstream 观察，避免 loop-guard 双计；路由失败保持原有观察路径。
    // 第二十九轮 P-11：step 模式下按用户 2026-11-08 拍板自动排续跑闸（闸执行
    // 时重新验证台账回答）；回答仍不等于验收，核可只在原会话。
    try {
      const inbound = mapFollowupToAnswer(trigger.text, trigger.actor.id);
      if (inbound.accepted && detail !== '暂停') {
        let routedOk = false;
        if (inbound.questionId) {
          const sink = this.hitlSink();
          const routed = routeAnswerToHitl({ inbound, actor: trigger.actor.id,
            events: sink.read(), at: Date.now(), via: 'feishu-im' });
          if (routed.ok) {
            persistHitlAnswer(routed, sink);
            routedOk = true;
            // P-11：按用户 2026-11-08 拍板（AUTO_RESUME_MANDATE），step 模式下把
            // 续跑闸排回同一 run 的队列；闸执行时重新验证台账回答，回答不等于验收。
            // loop 模式本就由上面的 delegate 唤醒下一轮，无需重复排闸。
            let autoResumeNote = 'step 模式下将按 2026-11-08 授权自动排续跑闸';
            // execution 配置缺省（最小宿主 / 测试夹具）时视为非 step 模式，
            // 不能让可选链前的读取抛错打断后面的只读回执通知。
            if (this.w.config.execution?.mode === 'step' && process.env.COLLAB_AUTO_RESUME !== '0') {
              try {
                const { PgStepQueue } = await import('./step-execution.ts');
                const { autoResumeAfterAnswer, AUTO_RESUME_MANDATE } = await import('./auto-resume.ts');
                const queue = PgStepQueue.fromConfig(this.w.config);
                try {
                  const resumed = await autoResumeAfterAnswer({ routed,
                    question: sink.read().find(e => e.type === 'human_question' && e.id === inbound.questionId)!,
                    enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
                  this.w.store.audit(resumed.ok ? 'hitl.auto-resumed' : 'hitl.auto-resume-refused', task.id,
                    resumed.ok ? { questionId: resumed.questionId, responseId: resumed.responseId,
                      runId: resumed.runId, enqueued: resumed.enqueued, mandate: resumed.mandate, via: 'feishu-im' }
                      : { questionId: inbound.questionId, reason: resumed.reason, via: 'feishu-im' });
                  autoResumeNote = resumed.ok
                    ? `续跑闸已排回队列（run ${resumed.runId}），闸执行时会重新验证回答`
                    : `自动续跑未排：${resumed.reason}`;
                } finally { await queue.close(); }
              } catch (error) {
                this.w.store.audit('hitl.auto-resume-refused', task.id, { questionId: inbound.questionId,
                  reason: String(error instanceof Error ? error.message : error).slice(0, 200), via: 'feishu-im' });
                autoResumeNote = `自动续跑失败：${String(error instanceof Error ? error.message : error).slice(0, 120)}`;
              }
            }
            this.w.store.notify('hitl-answer:' + trigger.id, task.id,
              `已记录对问题 ${inbound.questionId} 的回答并生成回流建议。${autoResumeNote}。回答不等于验收，最终核可仍在原会话。`);
          }
        }
        if (!routedOk) this.w.store.audit('loop.downstream', task.id, {
          eventId: trigger.id, actor: trigger.actor.id,
          kind: inbound.questionId ? 'answer' : 'supplement',
          questionId: inbound.questionId, choice: inbound.choice, acceptance: false,
          ...(inbound.questionId ? { inReplyTo: inbound.questionId } : {}),
        });
      }
    } catch { /* observation only */ }
    // 「表更新过了，和待办对一下」：群里这句话触发一次对账，结果进讨论并回一张卡片。
    // 只报不改 —— 不改判定、不补建待办、不动 readiness。
    const reconciled = isReconcileRequest(trigger.text) ? await this.reconcileCard(task.id) : null;
    if (reconciled?.card) this.w.store.notify('reconcile:' + trigger.id, task.id, reconciled.card);
    if (!followup) this.w.store.notify('collab-intake:' + trigger.id, task.id, `${task.identifier} 已${detail === '暂停' ? '暂停自动处理' : '接续'}；沿用当前任务、来源和授权范围。\n${this.w.config.paperclipUrl}/SUI/knowledge-workspaces`);
    this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('done', trigger.id);
    return { taskId: task.id, resumed: detail !== '暂停',
      ...(reconciled ? { reconcile: { comparable: reconciled.comparable,
        counts: reconciled.counts, conclusion: reconciled.conclusion } } : {}) };
  }

  /**
   * 拿锁定清单和本轮逐项判定比一遍，把差异写进讨论（advisory）并回一张卡片。
   * 没有清单或没有判定时如实说「没得比」，不拿「暂无差异」冒充核对通过。
   */
  private async reconcileCard(taskId: string) {
    try {
      const [{ readPlan }, { readRound }] = await Promise.all([
        import('./acceptance-plan.ts'), import('./acceptance-round.ts'),
      ]);
      const pc = (this.w as unknown as { pc?: any }).pc;
      if (!pc) return null;
      const sealed = await readPlan(pc, taskId).catch(() => null);
      const round = await readRound(pc, taskId).catch(() => null);
      const declared = (sealed?.plan?.items ?? []).map((item: any) => ({
        id: String(item.id), name: String(item.name ?? item.id), required: item.required !== false,
      }));
      const produced = round?.judgements?.length
        ? round.judgements.map((judgement: any) => ({
          id: String(judgement.itemId), name: String(judgement.name ?? judgement.itemId), status: judgement.status,
        })) : null;
      const result = reconcile({ declared, produced,
        artifact: round ? { ref: `任务 ${taskId} 评审第 ${round.round} 轮`,
          revision: round.planRevision, at: round.createdAt } : null });
      if (result.card) addDiscussionComment(discussionDir(),
        { taskId, author: 'workspace-assistant', target: 'report', body: result.card });
      return result;
    } catch { return null; }
  }
}
