/**
 * 第三十六轮 · 定时调度器 + 定时唤醒复查。
 *
 * 用户 2026-11-09 拍板（睡前指令的次日清晨收口）：
 *   「定时调度器（飞书唯一入口红线）、GitHub 监听（换本机 Git）、钉钉/企微
 *    通道、定时唤醒复查，这几个也都要做」
 * 这放宽了此前「飞书是唯一发起入口」的产品边界：定时器与外部事件源现在可以
 * 直接把任务投进协作环，但**不放宽**的红线是：
 *   - 自动发起的任务一律以 automation actor 留痕（审计可回溯到哪条 routine /
 *     哪个 wake），任务卡片上写明「由例行计划自动发起，不是新的人工需求」；
 *   - 任务的验收 / 核可 / 放行仍然只在原会话由原发起人确认，定时器只负责
 *     「发起」与「复查」，永远不代替人做结论；
 *   - 例行触发与唤醒复查都走 events 表幂等占位（routine-tick:{id}:{slot} /
 *     wake:{taskId}:{at}），重复 tick 不重复建任务；
 *   - assistant 不可用时如实降级：任务照建（backlog 可见），只委托失败会写
 *     审计 routine.assistant-unavailable，不假装已经跑起来。
 *
 * 设计：一个 tick 两个职责——
 *   1) routines：到点的例行任务 → createTask（requestKey 幂等）→ delegate；
 *   2) wakes：到点的复查预约 → 对该任务 delegate 一轮「到点复查」。
 * tick 由 server.ts 的主循环调用（默认 15s 一次），本模块不持有跨步状态，
 * 崩溃后下一次 tick 从 events 表继续，符合 step 模式「状态外置」的底座纪律。
 */
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';
import type { NativeTrigger } from './upstream.ts';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 第三十七轮 · cron 调度：直接复用上游 Autoloop 的 `kernel/cron.ts`（零依赖、
 * MIT，@ ba8cf6d8cf24），不自己写解析器。上游规则用五字段 cron 表达「工作日
 * 09:00 / 每周日 18:00」这类真实排班，此前的 interval/daily 只能逼近，写不出
 * 「每周一、三、五」或「每月 1 日」。
 */
const cronModule = await import(pathToFileURL(path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'upstream/autoloop/kernel/cron.ts')).href) as {
  parseCron(text: string): unknown | null;
  nextRun(parsed: unknown, after: number, zone: string): number | null;
  describeCron(text: string): string;
};
/** 本地时区（与「每日 09:30」同口径）；Intl 取不到时退回北京时间。 */
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
/**
 * cron 的补跑窗口：进程在到点后 30 分钟内启动仍补跑一次（与 daily「当天
 * 已过点即触发」同语义）；超过窗口不追，避免把昨天的班次在清晨补出来。
 */
const CRON_GRACE_MS = 30 * 60_000;

/** 例行任务的调度形态：固定间隔 / 每日固定时刻 / 五字段 cron（本地时区）。 */
export const routineScheduleSchema = z.union([
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(60 * 24 * 30) }).strict(),
  z.object({ kind: z.literal('daily'), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '每日时刻必须是 HH:MM（24 小时制）') }).strict(),
  z.object({
    kind: z.literal('cron'),
    /** 分 时 日 月 周；0 与 7 都是周日，支持 * / 步长 / 区间 / 逗号枚举。 */
    expr: z.string().trim().min(9).max(120).refine(value => cronModule.parseCron(value) !== null,
      '需要合法的 5 字段 cron 表达式（分 时 日 月 周）'),
  }).strict(),
]);
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;

export const routineSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9._-]*$/, '例行任务标识只允许小写字母、数字、点、下划线与连字符'),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(5000),
  /** 承接 Agent；缺省用 defaultAgent。 */
  agent: z.string().optional(),
  schedule: routineScheduleSchema,
  enabled: z.boolean().default(true),
}).strict();
export type Routine = z.infer<typeof routineSchema>;

export const schedulerConfigSchema = z.object({
  /** 总开关；关闭后 tick 直接返回，已建的 wake 预约保留但不触发。 */
  enabled: z.boolean().default(true),
  routines: z.array(routineSchema).default([]),
  /** 定时唤醒复查（wakes）独立开关，便于只开其一。 */
  wake: z.object({ enabled: z.boolean().default(true) }).default(() => ({ enabled: true as const })),
}).strict();
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>;
export function defaultSchedulerConfig(): SchedulerConfig {
  return schedulerConfigSchema.parse({ enabled: true, routines: [], wake: { enabled: true } });
}

/** 每日例程的「下一次」：今天的时刻已过就顺延到明天（状态展示用）。 */
function nextDailySlot(at: string, now: Date): string {
  const [hour, minute] = at.split(':').map(Number);
  const due = new Date(now); due.setHours(hour!, minute!, 0, 0);
  const target = now.getTime() >= due.getTime() ? new Date(due.getTime() + 86_400_000) : due;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${at}`;
}

/** 自动化触发者：admin 是本机操作者身份，automation 留痕到审计与历史。 */
export function automationActor(automation: string): WorkspaceActor {
  return { userId: 'local-board', admin: true, automation };
}

/** 本地分钟键：`YYYY-MM-DDTHH:MM`，作为 cron 的幂等槽。 */
function minuteKey(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** cron 在补跑窗口内最近一次应触发时刻；窗口内没有则 null（= 不该触发）。 */
export function cronOccurrence(expr: string, now: Date, graceMs = CRON_GRACE_MS): Date | null {
  const parsed = cronModule.parseCron(expr);
  if (!parsed) return null;
  const nowMs = now.getTime();
  let at = cronModule.nextRun(parsed, nowMs - graceMs - 60_000, LOCAL_ZONE);
  let last: number | null = null;
  while (at !== null && at <= nowMs) { last = at; at = cronModule.nextRun(parsed, at, LOCAL_ZONE); }
  return last === null ? null : new Date(last);
}

/** cron 下一次应触发时刻（状态展示用）。 */
export function cronNext(expr: string, now: Date): Date | null {
  const parsed = cronModule.parseCron(expr);
  if (!parsed) return null;
  const at = cronModule.nextRun(parsed, now.getTime(), LOCAL_ZONE);
  return at === null ? null : new Date(at);
}

/** 排班的人话说明（上游 describeCron：每天 18:00 / 每周日 06:00 / 工作日 09:00）。 */
export function describeSchedule(schedule: RoutineSchedule): string {
  if (schedule.kind === 'interval') return `每 ${schedule.minutes} 分钟`;
  if (schedule.kind === 'daily') return `每天 ${schedule.at}`;
  return cronModule.describeCron(schedule.expr);
}

/** interval / daily / cron 的时间槽键：同槽只触发一次；cron 不在窗口内返回 ''。 */
export function routineSlot(schedule: RoutineSchedule, now: Date): string {
  if (schedule.kind === 'interval') return String(Math.floor(now.getTime() / (schedule.minutes * 60_000)));
  if (schedule.kind === 'cron') { const at = cronOccurrence(schedule.expr, now); return at ? minuteKey(at) : ''; }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${schedule.at}`;
}

export type WakeRecord = { taskId: string; at: string; note?: string };

export type SchedulerTick = {
  at: string;
  routinesTriggered: number;
  wakesTriggered: number;
  skipped: { reason: string; routineId?: string; wakeId?: string }[];
  errors: { routineId?: string; wakeId?: string; error: string }[];
};

export class Scheduler {
  constructor(
    readonly w: Workspaces,
    private readonly assistant: WorkspaceAssistant,
    private readonly config: Config,
    /** 测试可注入时钟；生产恒用系统时间。 */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** events 表幂等占位：不存在才插入，返回是否首次（true = 本 tick 有权处理）。 */
  private claim(id: string, value: unknown): boolean {
    const result = this.w.store.db.prepare('INSERT OR IGNORE INTO events(id,state,value) VALUES(?,?,?)')
      .run(id, 'running', JSON.stringify(value));
    return result.changes === 1;
  }
  private settle(id: string, state: string): void {
    this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run(state, id);
  }

  async tick(): Promise<SchedulerTick> {
    const report: SchedulerTick = { at: this.now().toISOString(), routinesTriggered: 0, wakesTriggered: 0, skipped: [], errors: [] };
    if (!this.config.scheduler?.enabled) return report;
    for (const routine of this.config.scheduler.routines) {
      if (!routine.enabled) { report.skipped.push({ reason: 'disabled', routineId: routine.id }); continue; }
      const now = this.now();
      if (routine.schedule.kind === 'daily') {
        // 槽键是「今天的 at」，但只有真的过了 at 时刻才触发；否则服务在凌晨
        // 启动会把当天 09:30 的例程提前跑掉（第三十六轮真实发现并修复）。
        const [hour, minute] = routine.schedule.at.split(':').map(Number);
        const due = new Date(now); due.setHours(hour!, minute!, 0, 0);
        if (now.getTime() < due.getTime()) continue;
      }
      const slot = routineSlot(routine.schedule, now);
      // cron 未落在补跑窗口内就不该触发；空槽不是错误，只是「今天这班还没到」。
      if (!slot) { report.skipped.push({ reason: 'cron-not-due', routineId: routine.id }); continue; }
      const tickId = `routine-tick:${routine.id}:${slot}`;
      if (!this.claim(tickId, { routineId: routine.id, slot })) continue;
      try {
        const actor = automationActor('scheduler');
        const task = await this.w.createTask({
          title: `[例行] ${routine.title}`,
          goal: `${routine.goal}\n\n——本任务由例行计划「${routine.id}」在 ${slot} 槽自动发起，不是新的人工需求；验收仍由任务发起人在原会话确认。`,
          agent: routine.agent ?? this.config.defaultAgent,
          sources: [], requestKey: `routine:${routine.id}:${slot}`, autoDiscover: true,
        }, actor);
        this.w.store.audit('routine.triggered', task.id, { routineId: routine.id, slot, taskId: task.id, automation: 'scheduler' });
        try {
          await this.assistant.delegate(task.id, true, 'advance',
            '例行任务按计划自动发起。按目标推进；需要人拍板的问题走提问链路，不要自行替人做验收结论。', actor, 'routine:' + slot);
        } catch (error) {
          // 如实降级：任务已建（工作台可见），只是没有自动委托出去。
          this.w.store.audit('routine.assistant-unavailable', task.id, {
            routineId: routine.id, slot, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
          report.skipped.push({ reason: 'assistant-unavailable', routineId: routine.id });
        }
        this.settle(tickId, 'done');
        report.routinesTriggered += 1;
      } catch (error) {
        this.settle(tickId, 'failed');
        const message = String(error instanceof Error ? error.message : error).slice(0, 300);
        this.w.store.audit('routine.failed', null, { routineId: routine.id, slot, error: message });
        report.errors.push({ routineId: routine.id, error: message });
      }
    }
    if (this.config.scheduler.wake.enabled) report.wakesTriggered = await this.tickWakes(report);
    return report;
  }

  /** 预约一次到点复查。at 必须是未来的 ISO 时间；任务不能已完成。 */
  async scheduleWake(input: unknown): Promise<{ wakeId: string; at: string; taskId: string }> {
    const data = z.object({
      taskId: z.string().min(1), at: z.string().datetime({ offset: true }),
      note: z.string().trim().max(500).optional(),
    }).strict().parse(input);
    const task = this.w.store.get(data.taskId);
    if (task.phase === 'accepted') throw new Error('任务已完成，不需要复查预约');
    const at = Date.parse(data.at);
    if (!Number.isFinite(at)) throw new Error('无效的复查时间');
    if (at <= Date.parse(this.now().toISOString())) throw new Error('复查时间必须在未来');
    const wakeId = `wake:${data.taskId}:${data.at}`;
    const record: WakeRecord = { taskId: data.taskId, at: data.at, ...(data.note ? { note: data.note } : {}) };
    this.w.store.db.prepare('INSERT OR REPLACE INTO events(id,state,value) VALUES(?,?,?)')
      .run(wakeId, 'scheduled', JSON.stringify(record));
    this.w.store.audit('wake.scheduled', data.taskId, { wakeId, at: data.at, note: data.note ?? null, automation: 'scheduler' });
    return { wakeId, at: data.at, taskId: data.taskId };
  }

  async cancelWakes(taskId: string): Promise<{ cancelled: number }> {
    const rows = this.listWakes().filter(w => w.taskId === taskId && w.state === 'scheduled');
    for (const row of rows) this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('cancelled', row.id);
    if (rows.length) this.w.store.audit('wake.cancelled', taskId, { count: rows.length, automation: 'scheduler' });
    return { cancelled: rows.length };
  }

  listWakes(): (WakeRecord & { id: string; state: string })[] {
    const rows = this.w.store.db.prepare("SELECT id,state,value FROM events WHERE id LIKE 'wake:%'").all() as { id: string; state: string; value: string }[];
    return rows.map(row => ({ ...JSON.parse(row.value) as WakeRecord, id: row.id, state: row.state }));
  }

  private async tickWakes(report: SchedulerTick): Promise<number> {
    const now = Date.parse(this.now().toISOString());
    let triggered = 0;
    for (const wake of this.listWakes().filter(w => w.state === 'scheduled' && Date.parse(w.at) <= now)) {
      try {
        const task = this.w.store.get(wake.taskId);
        if (task.phase === 'accepted') { this.settle(wake.id, 'skipped-accepted'); report.skipped.push({ reason: 'task-accepted', wakeId: wake.id }); continue; }
        const actor = automationActor('scheduler');
        await this.assistant.delegate(task.id, true, 'advance',
          `到点复查（预约于 ${wake.at}）：${wake.note ?? '按约定复查任务进展；已完成的部分如实小结，阻塞的部分明确列出需要人拍板的点'}。本条由定时唤醒触发，不是新需求；验收结论仍由原发起人确认。`,
          actor, wake.id);
        this.settle(wake.id, 'done');
        this.w.store.audit('wake.review-triggered', task.id, { wakeId: wake.id, at: wake.at, taskId: task.id, automation: 'scheduler' });
        triggered += 1;
      } catch (error) {
        this.settle(wake.id, 'failed');
        const message = String(error instanceof Error ? error.message : error).slice(0, 300);
        this.w.store.audit('wake.failed', wake.taskId, { wakeId: wake.id, error: message });
        report.errors.push({ wakeId: wake.id, error: message });
      }
    }
    return triggered;
  }

  status(): { enabled: boolean; routines: (Routine & { nextSlot?: string; summary: string })[]; wakes: (WakeRecord & { id: string; state: string })[] } {
    const cfg = this.config.scheduler;
    const now = this.now();
    return {
      enabled: cfg?.enabled === true,
      routines: (cfg?.routines ?? []).map(r => ({
        ...r,
        summary: describeSchedule(r.schedule),
        nextSlot: r.schedule.kind === 'cron'
          ? (cronNext(r.schedule.expr, now) ? minuteKey(cronNext(r.schedule.expr, now)!) : undefined)
          : r.schedule.kind === 'daily' ? nextDailySlot(r.schedule.at, now) : routineSlot(r.schedule, now),
      })),
      wakes: this.listWakes(),
    };
  }
}

/**
 * 定时器/唤醒入站会话触发时构造的 NativeTrigger 形状（与飞书事件同构，
 * CollaborationIntake.ingestTrigger 直接消费）。meta.source 标明来源通道，
 * 白名单校验按通道分流。
 */
export function automationTrigger(input: { id: string; actorId: string; chatId: string; messageId: string; text: string; direct?: boolean; source: string }): NativeTrigger {
  return {
    id: input.id, human: true, addressed: 'automation', actor: { id: input.actorId }, text: input.text,
    meta: { chatId: input.chatId, messageId: input.messageId, direct: input.direct === true, source: input.source },
  };
}
