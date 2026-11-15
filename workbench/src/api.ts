import { useQuery } from '@tanstack/react-query';
import type { Collaboration } from '../../src/workbench/collaboration.ts';

export type Overview = ReturnType<Collaboration['overview']>;
export type Project = Overview['projects'][number];
export type Agent = Overview['agents'][number];
export type TicketRow = Overview['tickets'][number];
export type Decision = Overview['needsYou'][number];
export type Ticket = ReturnType<Collaboration['detail']>;
export type Knowledge = ReturnType<Collaboration['browse']>[number];
export type ReadableKnowledge = Extract<Knowledge, { body: string }>;
export type Snapshot = ReturnType<Collaboration['executionSnapshot']>;
export type Usage = ReturnType<Collaboration['projectUsage']>;
export type Channels = ReturnType<Collaboration['channelView']>;
export type Discussion = ReturnType<Collaboration['discussionView']>;
export type Imported = Awaited<ReturnType<Collaboration['importKnowledge']>>;
export type StartResult = ReturnType<Collaboration['start']>;
export type Resource = Project['resources'][number];
export type DeviceRow = ReturnType<Collaboration['projectDevices']>[number];
export type BudgetRow = ReturnType<Collaboration['budgetPools']>[number];
export type MemoryRow = ReturnType<Collaboration['memoryHome']>[number];
export type MemoryUse = ReturnType<Collaboration['memoryUses']>[number];
export type RecallHit = ReturnType<Collaboration['recallMemory']>[number];

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T = { ok: boolean }>(route: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/' + route, {
    signal,
    ...(data === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && route !== 'login') window.dispatchEvent(new Event('suitme-session-expired'));
    throw new ApiError(payload.error || '暂时无法读取工作台，请重试。', response.status);
  }
  return payload as T;
}

export function useData<T>(route: string, interval?: number) {
  return useQuery({
    queryKey: [route],
    queryFn: ({ signal }) => api<T>(route, undefined, signal),
    enabled: !!route,
    gcTime: 0,
    retry: false,
    refetchInterval: interval,
  });
}

export function readable(entry: Knowledge): entry is ReadableKnowledge { return 'body' in entry; }
export const uid = () => crypto.randomUUID();
export const part = (value: string) => encodeURIComponent(value);
