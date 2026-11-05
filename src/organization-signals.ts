// v0.6 FR-21 / FR-03 — organisation state signal surface (G).
//
// Read-only, warning-only, NO ranking and NO individual performance scoring.
// The reference insight ("I was anxious and the whole team was anxious") is a
// founder's perception; to make it reproducible it must become visible signals
// with a closed loop: signal → cluster → task → fix → next-day retest.
import { z } from 'zod';
import type { SemanticObject } from './channels.ts';

export const signalMetricSchema = z.enum([
  'cross-function-dispatch-ratio', 'transfer-revocation-rate', 'cross-space-grant-ratio',
  'knowledge-reuse-rate', 'attention-cost', 'quality-cost', 'unaccepted-inference-citation',
  'counter-sign-veto-rate', 'rework-rate',
]);
export type SignalMetric = z.infer<typeof signalMetricSchema>;

export const signalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  at: z.string(),
  metric: signalMetricSchema,
  value: z.number(),
  threshold: z.number(),
  direction: z.enum(['above', 'below']),
  hint: z.string().min(1),
  /** Signals never block a task and never rank people. */
  blocking: z.literal(false).default(false),
  clusterId: z.string().optional(),
}).strict();
export type Signal = z.infer<typeof signalSchema>;

export const HINTS: Record<SignalMetric, string> = {
  'cross-function-dispatch-ratio': '跨职能派单常态化，提示主职能可能划错、该补人，或该同学本就该转岗',
  'transfer-revocation-rate': '授权撤销偏多，检查能力依据是否真实、授权范围是否过大',
  'cross-space-grant-ratio': '跨空间授权偏多，检查空间切分与默认隔离粒度',
  'knowledge-reuse-rate': '知识复用偏低，检查已验收制品是否回流为可复用边',
  'attention-cost': '人均被打断与注意力消耗偏高，考虑分层汇报或收紧主动巡检',
  'quality-cost': '单位任务成本上升但返工未下降，检查评审链路是否退化',
  'unaccepted-inference-citation': '出现未验收推断被当依据，检查写入门槛与 Context Pack 过滤',
  'counter-sign-veto-rate': '联签否决偏多，检查标准外置是否被执行',
  'rework-rate': '返工率偏高，检查开工前验收清单与反向追问质量',
};

const triggered = (s: Pick<Signal, 'value' | 'threshold' | 'direction'>) =>
  s.direction === 'above' ? s.value > s.threshold : s.value < s.threshold;

export function evaluateSignals(input: {
  at: string; readings: Partial<Record<SignalMetric, number>>;
  thresholds?: Partial<Record<SignalMetric, { value: number; direction: 'above' | 'below' }>>;
}): Signal[] {
  const defaults: Partial<Record<SignalMetric, { value: number; direction: 'above' | 'below' }>> = {
    'cross-function-dispatch-ratio': { value: 0.3, direction: 'above' },
    'transfer-revocation-rate': { value: 0.1, direction: 'above' },
    'cross-space-grant-ratio': { value: 0.3, direction: 'above' },
    'knowledge-reuse-rate': { value: 0.2, direction: 'below' },
    'attention-cost': { value: 8, direction: 'above' },
    'quality-cost': { value: 1, direction: 'above' },
    'unaccepted-inference-citation': { value: 0, direction: 'above' },
    'counter-sign-veto-rate': { value: 0.1, direction: 'above' },
    'rework-rate': { value: 0.2, direction: 'above' },
  };
  const thresholds = { ...defaults, ...(input.thresholds ?? {}) };
  const out: Signal[] = [];
  for (const [metric, value] of Object.entries(input.readings) as [SignalMetric, number][]) {
    const t = thresholds[metric];
    if (!t || !Number.isFinite(value)) continue;
    const candidate: Signal = signalSchema.parse({ schemaVersion: 1,
      id: `signal:${input.at}:${metric}`, at: input.at, metric, value,
      threshold: t.value, direction: t.direction, hint: HINTS[metric], blocking: false });
    if (triggered(candidate)) out.push(candidate);
  }
  return out;
}

/** Cluster by metric family so a fix addresses a cause, not a single blip. */
export function clusterSignals(signals: Signal[]): { clusterId: string; metrics: SignalMetric[]; signals: Signal[] }[] {
  const families: Record<string, SignalMetric[]> = {
    responsibility: ['cross-function-dispatch-ratio', 'transfer-revocation-rate', 'counter-sign-veto-rate'],
    context: ['cross-space-grant-ratio', 'knowledge-reuse-rate', 'unaccepted-inference-citation'],
    health: ['attention-cost', 'quality-cost', 'rework-rate'],
  };
  return Object.entries(families).map(([name, metrics]) => {
    const members = signals.filter(s => metrics.includes(s.metric)).map(s => ({ ...s, clusterId: `cluster:${name}` }));
    return { clusterId: `cluster:${name}`, metrics: metrics.filter(m => members.some(s => s.metric === m)), signals: members };
  }).filter(c => c.signals.length);
}

export interface FixLoop {
  signalId: string; clusterId?: string; taskId: string; createdAt: string;
  fix: string; retestAt: string; retestValue?: number; status: 'open' | 'fixed' | 'regressed';
}

/** The loop is a record, not an automated personnel action. */
export function openFixLoop(signal: Signal, taskId: string, fix: string, at = new Date().toISOString()): FixLoop {
  return { signalId: signal.id, clusterId: signal.clusterId, taskId, createdAt: at, fix,
    retestAt: new Date(Date.parse(at) + 24 * 3600_000).toISOString(), status: 'open' };
}

export function retest(loop: FixLoop, value: number, threshold: number, at = new Date().toISOString()): FixLoop {
  if (Date.parse(at) < Date.parse(loop.retestAt)) throw new Error('次日复测时间未到');
  return { ...loop, retestValue: value, status: value <= threshold ? 'fixed' : 'regressed' };
}

export function toSignalCard(s: Signal): SemanticObject {
  return { kind: 'organization-signal', metric: s.metric, value: String(s.value), hint: s.hint };
}
