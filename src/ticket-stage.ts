/**
 * 工单阶段（Ticket stage）+ 执行报告状态（对齐 dsh-superagent `003-execution.md`，MIT）。
 *
 * dsh 把一个工单的「现在等什么」推成一个阶段，而不是让外部去猜状态。
 * 报告是执行器回传的 6 态，阶段是工单侧据此 + 是否有待答问题推出来的。
 * 本模块只做「从事实推到阶段」的纯判定，不接管本仓已有的 task.phase。
 */

export const REPORT_STATUSES = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** 报告状态的语义（对齐 dsh 术语表）。 */
export const REPORT_LABELS: Record<ReportStatus, string> = {
  progress: '进展中', waiting: '等待触发', ready: '待评审', blocked: '受阻', failed: '失败', dropped: '无需处理',
};

export interface TicketStageInput {
  /** 最新报告状态；没有报告（还没跑过）就 undefined。 */
  report?: ReportStatus | null;
  /** 是否有待人工回答的问题（Attention）。 */
  hasAttention?: boolean;
  /** 输入投递是否失败（person / delivery）。 */
  deliveryFailed?: boolean;
  /** 是否有待启动或执行中的 Assignment。 */
  hasActiveAssignment?: boolean;
  /** 是否有挂起的 Assignment。 */
  hasPendingAssignment?: boolean;
  /** 收到报告后是否有新的真人消息进来（释放 blocked/failed）。 */
  hasPersonMessageSince?: boolean;
}

export type TicketStage =
  | 'person/delivery' | 'person/answer' | 'person/review' | 'person/blocked' | 'person/failed'
  | 'working/queued' | 'idle' | 'working';

/**
 * 阶段推导：从上到下第一个匹配的行胜出（对齐 dsh 的表）。
 * 返回的是「工单现在等什么」，不是执行器状态。
 */
export function deriveStage(input: TicketStageInput): TicketStage {
  if (input.deliveryFailed) return 'person/delivery';
  if (input.hasAttention) return 'person/answer';
  if (input.report === 'ready') return 'person/review';
  if (input.report === 'blocked' && !input.hasPersonMessageSince) return 'person/blocked';
  if (input.report === 'failed' && !input.hasPersonMessageSince) return 'person/failed';
  if (!input.hasActiveAssignment && (input.hasPendingAssignment || !input.report)) return 'working/queued';
  if (input.report === 'waiting' || (input.report === 'dropped')) return 'idle';
  return 'working';
}

/** 这个阶段是不是「没有人的输入就推不动」的 person 阶段。 */
export function isPersonStage(stage: TicketStage): boolean {
  return stage.startsWith('person/');
}

/** 报告是否意味着工单可以收尾（dropped 无需处理，ready 待评审不算收尾）。 */
export function isTerminalReport(status: ReportStatus): boolean {
  return status === 'dropped' || status === 'ready';
}

/** 报告状态 → 给控制台看的一句人话。 */
export function reportLabel(status: ReportStatus): string {
  return REPORT_LABELS[status];
}
