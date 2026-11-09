// 第三十六轮 · 定时调度器 + 定时唤醒复查（src/scheduler.ts）。
// 红线：同槽幂等（重复 tick 不重复建任务）、验收不越权（delegate 指令写明
// 「不是新的人工需求」）、assistant 不可用如实降级并留审计。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { Scheduler, routineSlot, defaultSchedulerConfig, automationActor } from '../src/scheduler.ts';
import type { Config } from '../src/config.ts';

function fixture(routines: Config['scheduler']['routines'], now = () => new Date('2026-11-09T10:00:00+08:00')) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-scheduler-')), store = new Store(path.join(dir, 'state.sqlite'));
  const task: any = { id: 'task-one', identifier: 'SUI-1', triggerId: 't1', chatId: 'local', messageId: 'local', senderId: 'local-operator',
    agent: 'executor', generation: 1, phase: 'ready', kind: 'collaboration', context: '{}', workspace: '', branch: '' };
  store.save(task);
  const created: any[] = [], delegated: any[] = [];
  const w: any = {
    config: { feishu: { allowedSenders: [], allowedChats: [], botId: '', appId: '' } },
    store,
    manager: (a: any) => { if (!a.admin) throw new Error('Unauthorized'); },
    createTask: async (input: any, actor: any) => {
      const existing = store.list().find((t: any) => t.triggerId === 'workspace:' + input.requestKey);
      if (existing) return existing;
      const t = { ...task, id: 'task-' + (created.length + 2), identifier: 'SUI-' + (created.length + 2),
        triggerId: 'workspace:' + input.requestKey, context: JSON.stringify({ request: input.goal }) };
      created.push({ input, actor }); store.save(t); return t;
    },
  };
  const assistant: any = {
    delegate: async (taskId: string, enabled: boolean, mode: string, instruction: string, actor: any, nonce?: string) => {
      delegated.push({ taskId, enabled, mode, instruction, actor, nonce });
    },
  };
  const config = { ...({} as any as Config), defaultAgent: 'executor',
    scheduler: { ...defaultSchedulerConfig(), routines } } as Config;
  return { store, created, delegated, w, assistant, config, now,
    close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('an interval routine creates exactly one task per slot and survives repeated ticks', async () => {
  const f = fixture([{ id: 'daily-check', title: '核对交付看板', goal: '汇总当前交付状态并给出阻塞清单',
    schedule: { kind: 'interval', minutes: 30 }, enabled: true }]);
  try {
    const first = await new Scheduler(f.w, f.assistant, f.config, f.now).tick();
    assert.equal(first.routinesTriggered, 1);
    assert.equal(f.created.length, 1);
    assert.match(f.created[0]!.input.title, /^\[例行\] 核对交付看板$/);
    assert.match(f.created[0]!.input.goal, /不是新的人工需求/);
    assert.equal(f.created[0]!.actor.automation, 'scheduler');
    assert.equal(f.created[0]!.actor.admin, true);
    const again = await new Scheduler(f.w, f.assistant, f.config, f.now).tick();
    assert.equal(again.routinesTriggered, 0, '同一时间槽内重复 tick 不重复建任务');
    assert.equal(f.created.length, 1);
    const later = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T10:31:00+08:00')).tick();
    assert.equal(later.routinesTriggered, 1, '跨槽后再次触发');
    assert.equal(f.created.length, 2);
    assert.equal(f.delegated.length, 2);
    assert.match(f.delegated[0]!.instruction, /不要自行替人做验收结论/);
  } finally { f.close(); }
});

test('a daily routine fires once per local day and skips when disabled', async () => {
  const f = fixture([{ id: 'morning-brief', title: '晨报', goal: '汇总昨夜任务进展',
    schedule: { kind: 'daily', at: '09:30' }, enabled: true }]);
  try {
    const s = () => new Scheduler(f.w, f.assistant, f.config, f.now);
    assert.equal((await s().tick()).routinesTriggered, 1, '10:00 已过 09:30，当日应触发');
    assert.equal((await s().tick()).routinesTriggered, 0, '同日不重复');
    const nextDay = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-10T09:31:00+08:00')).tick();
    assert.equal(nextDay.routinesTriggered, 1, '次日至点触发');
    const off = fixture([{ id: 'off', title: '停用例程', goal: '不应触发', schedule: { kind: 'daily', at: '09:30' }, enabled: false }]);
    try { assert.equal((await new Scheduler(off.w, off.assistant, off.config, off.now).tick()).routinesTriggered, 0); }
    finally { off.close(); }
  } finally { f.close(); }
});

test('a daily routine does NOT fire before its local time-of-day (early boot must not pull the slot forward)', async () => {
  const f = fixture([{ id: 'morning-brief', title: '晨报', goal: '汇总昨夜任务进展',
    schedule: { kind: 'daily', at: '09:30' }, enabled: true }], () => new Date('2026-11-09T07:40:00+08:00'));
  try {
    const early = await new Scheduler(f.w, f.assistant, f.config, f.now).tick();
    assert.equal(early.routinesTriggered, 0, '07:40 未到 09:30，不得提前触发');
    assert.equal(f.created.length, 0);
    const onTime = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T09:30:00+08:00')).tick();
    assert.equal(onTime.routinesTriggered, 1, '到点后正常触发');
  } finally { f.close(); }
});

test('routine slot keys are stable per interval and per local day', () => {
  assert.equal(routineSlot({ kind: 'interval', minutes: 30 }, new Date('2026-11-09T10:00:00+08:00')),
    routineSlot({ kind: 'interval', minutes: 30 }, new Date('2026-11-09T10:29:00+08:00')));
  assert.notEqual(routineSlot({ kind: 'interval', minutes: 30 }, new Date('2026-11-09T10:00:00+08:00')),
    routineSlot({ kind: 'interval', minutes: 30 }, new Date('2026-11-09T10:31:00+08:00')));
  assert.equal(routineSlot({ kind: 'daily', at: '09:30' }, new Date('2026-11-09T23:59:00+08:00')), '2026-11-09T09:30');
});

test('a scheduled wake triggers a review delegation exactly once, and only after the due time', async () => {
  const f = fixture([]);
  try {
    const scheduler = new Scheduler(f.w, f.assistant, f.config, f.now);
    await assert.rejects(scheduler.scheduleWake({ taskId: 'task-one', at: '2026-11-08T00:00:00+08:00' }), /未来/);
    const booked = await scheduler.scheduleWake({ taskId: 'task-one', at: '2026-11-09T10:05:00+08:00', note: '复查审批结果' });
    assert.equal(booked.wakeId, 'wake:task-one:2026-11-09T10:05:00+08:00');
    assert.equal((await scheduler.tick()).wakesTriggered, 0, '未到点不触发');
    const due = new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T10:06:00+08:00'));
    assert.equal((await due.tick()).wakesTriggered, 1);
    assert.equal(f.delegated.length, 1);
    assert.match(f.delegated[0]!.instruction, /复查审批结果/);
    assert.match(f.delegated[0]!.instruction, /不是新需求/);
    assert.equal((await due.tick()).wakesTriggered, 0, '触发一次后不再重复');
    assert.equal(scheduler.listWakes().find(w => w.id === booked.wakeId)?.state, 'done');
  } finally { f.close(); }
});

test('cancelling wakes and accepted tasks are handled honestly', async () => {
  const f = fixture([]);
  try {
    const scheduler = new Scheduler(f.w, f.assistant, f.config, f.now);
    await scheduler.scheduleWake({ taskId: 'task-one', at: '2026-11-09T10:05:00+08:00' });
    const { cancelled } = await scheduler.cancelWakes('task-one');
    assert.equal(cancelled, 1);
    const due = new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T10:06:00+08:00'));
    assert.equal((await due.tick()).wakesTriggered, 0, '已取消的预约不触发');
    const accepted = f.store.get('task-one'); accepted.phase = 'accepted'; f.store.save(accepted);
    await assert.rejects(scheduler.scheduleWake({ taskId: 'task-one', at: '2026-11-09T11:00:00+08:00' }), /已完成/);
  } finally { f.close(); }
});

test('assistant unavailability degrades honestly: task is still created, audit records the failure', async () => {
  const f = fixture([{ id: 'r', title: 't', goal: 'g', schedule: { kind: 'interval', minutes: 30 }, enabled: true }]);
  f.assistant.delegate = async () => { throw new Error('协作 Agent 尚未配置'); };
  try {
    const report = await new Scheduler(f.w, f.assistant, f.config, f.now).tick();
    assert.equal(report.routinesTriggered, 1);
    assert.equal(report.skipped.filter(s => s.reason === 'assistant-unavailable').length, 1);
    assert.equal(f.created.length, 1, '任务照建（工作台可见）');
    const audits = f.store.db.prepare("SELECT action FROM audit WHERE action='routine.assistant-unavailable'").all() as { action: string }[];
    assert.equal(audits.length, 1);
  } finally { f.close(); }
});

test('scheduler disabled entirely: ticks are no-ops', async () => {
  const f = fixture([{ id: 'r', title: 't', goal: 'g', schedule: { kind: 'interval', minutes: 30 }, enabled: true }]);
  f.config.scheduler.enabled = false;
  try {
    const report = await new Scheduler(f.w, f.assistant, f.config, f.now).tick();
    assert.equal(report.routinesTriggered, 0); assert.equal(report.wakesTriggered, 0);
    assert.equal(f.created.length, 0);
  } finally { f.close(); }
});

test('automation actor is admin-scoped and carries the automation marker for audit trails', () => {
  const actor = automationActor('github-watch');
  assert.equal(actor.admin, true);
  assert.equal(actor.automation, 'github-watch');
  assert.equal(actor.userId, 'local-board');
});

test('a cron routine fires once per occurrence, not before its minute, and stays idempotent', async () => {
  const f = fixture([{ id: 'weekday-standup', title: '站会', goal: '汇总昨日进展', schedule: { kind: 'cron', expr: '30 9 * * *' }, enabled: true }]);
  try {
    const early = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T09:00:00+08:00')).tick();
    assert.equal(early.routinesTriggered, 0, '09:00 未到 09:30，不得触发');
    const onTime = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T09:30:10+08:00')).tick();
    assert.equal(onTime.routinesTriggered, 1, '09:30 触发');
    const again = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T09:31:00+08:00')).tick();
    assert.equal(again.routinesTriggered, 0, '同一分钟槽内不重复；30 分钟宽限内也不重复补跑已跑过的槽');
    assert.equal(f.created.length, 1);
    assert.match(f.created[0]!.input.requestKey, /^routine:weekday-standup:2026-11-09T09:30$/);
  } finally { f.close(); }
});

test('a weekly cron (Sunday 18:00) does not fire on other days', async () => {
  const f = fixture([{ id: 'weekly-housekeeping', title: '每周整理', goal: '健康检查',
    schedule: { kind: 'cron', expr: '0 18 * * 0' }, enabled: true }]);
  try {
    const monday = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-09T18:05:00+08:00')).tick();
    assert.equal(monday.routinesTriggered, 0, '周一不跑周日的班');
    const sunday = await new Scheduler(f.w, f.assistant, f.config, () => new Date('2026-11-08T18:05:00+08:00')).tick();
    assert.equal(sunday.routinesTriggered, 1, '周日 18:00 触发');
    assert.equal(f.created.length, 1);
  } finally { f.close(); }
});

test('an invalid cron expression is rejected at config parse time', async () => {
  const { schedulerConfigSchema } = await import('../src/scheduler.ts');
  assert.throws(() => schedulerConfigSchema.parse({ enabled: true, routines: [{ id: 'bad', title: 'bad', goal: 'g',
    schedule: { kind: 'cron', expr: '61 25 * * *' } }], wake: { enabled: true } }), /cron/);
  const ok = schedulerConfigSchema.parse({ enabled: true, routines: [{ id: 'ok', title: 'ok', goal: 'g',
    schedule: { kind: 'cron', expr: '0 9 * * 1-5' } }], wake: { enabled: true } });
  // 第三十八轮起 schedule 与 when 二选一，类型上是 optional；这里显式断言。
  assert.equal(ok.routines[0]!.schedule!.kind, 'cron');
});
