/**
 * P-5：控制台只读摘要视图的服务端分页与字段裁剪。
 *
 * 背景：原 `view` 会把整个工作区快照（每个任务的工作稿正文、授权明细、
 * 版本记录、宿主实时状态）一次性拼出来，真实浏览器实测 415KB / 10~12 秒。
 * 自研控制台只用得到任务索引、少量统计与连接标记，因此这里单独提供一份
 * 只含白名单字段、按页返回的摘要；原 `view` 逐字保留给插件工作台，可随时回退。
 *
 * 约束：
 * - 确定性纯函数，`modelCalls=0`，不读写文件、不发起网络请求；
 * - 身份过滤与 `Workspaces.view()` 完全一致（非管理员只看自己承接的任务）；
 * - 显式构造返回对象，绝不 spread 原始 Task，避免把 context / lease /
 *   delivery / runId 等内部字段带出去；
 * - 宿主标题只是 advisory 增强：缺一条就降级到本地任务索引，不改变任务列表；
 * - `taskCount` / `page.total` 是「当前身份可见的全量」计数，分页不谎报规模。
 */
import type { Task } from './store.ts';
import type { WorkspaceActor } from './workspaces.ts';

export const VIEW_SUMMARY_DEFAULT_LIMIT = 12;
export const VIEW_SUMMARY_MAX_LIMIT = 50;
export const VIEW_SUMMARY_MAX_OFFSET = 100000;
export const VIEW_SUMMARY_TITLE_LIMIT = 120;
export const VIEW_SUMMARY_GOAL_LIMIT = 160;

export const VIEW_SUMMARY_NOTE = '摘要只返回任务索引与计数，不含工作稿正文、授权明细与宿主实时详情；完整现场仍由原有只读快照提供。';

export type HostTitle = { title: string; goal: string };

export type SummaryTask = {
  id: string;
  identifier: string;
  title: string;
  goal: string;
  agent: string;
  phase: string;
  generation: number;
};

export type ViewSummary = {
  tasks: SummaryTask[];
  taskCount: number;
  spaceCount: number;
  sourceCount: number;
  page: { offset: number; limit: number; total: number; hasMore: boolean };
  feishuConnected: boolean;
  assistantAvailable: boolean;
  configurableAgents: number;
  titleSource: 'host' | 'partial' | 'local';
  fieldsClipped: true;
  note: string;
  generatedAt: string;
};

export type ViewSummaryInput = {
  tasks: readonly Task[];
  actor: WorkspaceActor;
  spaceCount: number;
  sourceCount: number;
  feishuConnected: boolean;
  assistantAvailable: boolean;
  configurableAgents: number;
  limit?: number;
  offset?: number;
  /** 宿主 issue 的标题与目标；缺失的条目自动降级，不阻断摘要。 */
  hostTitles?: Readonly<Record<string, HostTitle | undefined>>;
  /** 测试可注入固定时间，保证两次结果逐字节一致。 */
  generatedAt?: string;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** 浏览器可传分页参数，但一律夹在安全区间内，不接受「一次拿全量」。 */
export function parseViewSummaryPage(input: unknown): { limit: number; offset: number } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    limit: clampInteger(raw.limit, VIEW_SUMMARY_DEFAULT_LIMIT, 1, VIEW_SUMMARY_MAX_LIMIT),
    offset: clampInteger(raw.offset, 0, 0, VIEW_SUMMARY_MAX_OFFSET),
  };
}

/** 与 `Workspaces.view()` 的任务可见范围逐字对齐。 */
export function visibleTasksFor(actor: WorkspaceActor, tasks: readonly Task[]): Task[] {
  return tasks.filter(task => task.kind === 'collaboration'
    && (actor.admin === true || (Boolean(actor.agent) && task.agent === actor.agent)));
}

function clip(text: unknown, max: number): string {
  const value = String(text ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function localTitle(task: Task): string {
  const firstLine = String(task.context ?? '').split('\n')[0] ?? '';
  return clip(firstLine || task.identifier || '未命名任务', VIEW_SUMMARY_TITLE_LIMIT);
}

export function buildWorkspaceSummary(input: ViewSummaryInput): ViewSummary {
  const { limit, offset } = parseViewSummaryPage({ limit: input.limit, offset: input.offset });
  const visible = visibleTasksFor(input.actor, input.tasks);
  const pageTasks = visible.slice(offset, offset + limit);
  const hostTitles = input.hostTitles ?? {};
  let hostHits = 0;
  const tasks: SummaryTask[] = pageTasks.map(task => {
    const host = hostTitles[task.id];
    if (host && (host.title || host.goal)) hostHits += 1;
    // 显式白名单构造：不 spread task，内部字段一律不带出服务端。
    return {
      id: task.id,
      identifier: task.identifier,
      title: host && host.title ? clip(host.title, VIEW_SUMMARY_TITLE_LIMIT) : localTitle(task),
      goal: host ? clip(host.goal, VIEW_SUMMARY_GOAL_LIMIT) : '',
      agent: task.agent,
      phase: task.phase,
      generation: task.generation,
    };
  });
  const titleSource: ViewSummary['titleSource'] = hostHits === 0
    ? 'local' : hostHits === pageTasks.length ? 'host' : 'partial';
  return {
    tasks,
    taskCount: visible.length,
    spaceCount: input.spaceCount,
    sourceCount: input.sourceCount,
    page: { offset, limit, total: visible.length, hasMore: offset + pageTasks.length < visible.length },
    feishuConnected: input.feishuConnected === true,
    assistantAvailable: input.assistantAvailable === true,
    configurableAgents: input.configurableAgents,
    titleSource,
    fieldsClipped: true,
    note: VIEW_SUMMARY_NOTE,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
