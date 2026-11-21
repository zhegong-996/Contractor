import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import type { TicketListFilters } from '../../src/workbench/ticket-list-state.ts';
import type { permissionAdmin } from '../../src/workbench/permission-admin.ts';
import type { IMLogin } from '../../src/workbench/im-login.ts';

export type Overview = ReturnType<Collaboration['overview']>;
export type Project = Overview['projects'][number];
export type Agent = Overview['agents'][number];
export type AgentResources = ReturnType<Collaboration['octopCatalog']>;
export type KnowledgeGraph = ReturnType<Collaboration['projectKnowledgeGraph']>;
export type TicketRow = Overview['tickets'][number];
export type Decision = Overview['needsYou'][number];
export type Ticket = ReturnType<Collaboration['detail']>;
export type ConversationMessage = ReturnType<Collaboration['conversation']>[number];
export type ConversationList = ReturnType<Collaboration['conversationIndex']>;
export type Regression = ReturnType<Collaboration['regressionList']>;
export type TicketTopicContext = ReturnType<Collaboration['ticketTopicContext']>;
export type Knowledge = ReturnType<Collaboration['browse']>[number];
export type ReadableKnowledge = Extract<Knowledge, { body: string }>;
export type Snapshot = ReturnType<Collaboration['executionSnapshot']>;
export type Usage = ReturnType<Collaboration['projectUsage']>;
export type Channels = ReturnType<Collaboration['channelView']>;
export type Discussion = ReturnType<Collaboration['discussionView']>;
export type Imported = Awaited<ReturnType<Collaboration['importKnowledge']>>;
export type StartResult = ReturnType<Collaboration['start']>;
export type DispatchReadiness = Awaited<ReturnType<Collaboration['dispatchReadiness']>>;
export type ProjectDeliverySetup = Awaited<ReturnType<Collaboration['projectDeliverySetup']>>;
export type ProjectPlansView = Awaited<ReturnType<Collaboration['projectPlansView']>>;
export type ProjectTemplate = ReturnType<Collaboration['exportProjectTemplate']>;
export type Resource = Project['resources'][number];
export type DeviceRow = ReturnType<Collaboration['projectDevices']>[number];
export type DeviceRoute = ReturnType<Collaboration['projectDeviceRoutes']>[number];
export type TopicRule = ReturnType<Collaboration['topicRules']>[number];
export type BudgetRow = ReturnType<Collaboration['budgetPools']>[number];
export type PointPool = ReturnType<Collaboration['projectPointBudgets']>[number];
export type PointPolicy = ReturnType<Collaboration['pointPolicy']>;
export type ProjectAccess = ReturnType<Collaboration['projectAccess']>;
export type ProjectRouting = ReturnType<Collaboration['projectRouting']>;
export type ModelService = Awaited<ReturnType<Collaboration['modelServices']>>[number];
export type FigmaSourceStatus = ReturnType<Collaboration['figmaSourceStatus']>[number];
export type ProjectChannels = { feishuReady: boolean;
  im: (ReturnType<Collaboration['projectChannels']>[number] & { ready: boolean })[];
  feishuHistory: ReturnType<Collaboration['feishuSourceStatus']>;
  feishuTopics: ReturnType<Collaboration['projectFeishuTopics']>; feishuReply: boolean; imTopics: ReturnType<Collaboration['projectIMTopics']> };
export type TopicContacts = ReturnType<Collaboration['topicContacts']>;
export type ProjectKnowledgeAccess = ReturnType<Collaboration['projectKnowledgeAccess']>;
export type PlatformMembers = ReturnType<ReturnType<typeof permissionAdmin>['list']>;
export type PlatformAudit = ReturnType<ReturnType<typeof permissionAdmin>['changes']>;
export type PersonalProfile = ReturnType<Collaboration['profiles']['own']>;
export type LoginPolicy = ReturnType<IMLogin['view']>;
export type Session = { signedIn: boolean; recoveryUrl?: string; imLogin?: ReturnType<IMLogin['browser']>;
  org?: { id: string; name: string } | null };
export type { GitHubConnection } from '../../src/workbench/github-intake.ts';
export type MemoryRow = ReturnType<Collaboration['memoryHome']>[number];
export type MemoryUse = ReturnType<Collaboration['memoryUses']>[number];
export type RecallHit = Awaited<ReturnType<Collaboration['recallMemory']>>[number];

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const mayKeepStale = (error: Error | null) => error instanceof ApiError ? error.status >= 500 : error instanceof TypeError;

export async function api<T = { ok: boolean }>(route: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/' + route, {
    signal,
    ...(data === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && route !== 'login') window.dispatchEvent(new Event('contractor-session-expired'));
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

export function useTickets(filters: Omit<TicketListFilters, 'after'>, enabled = true, interval?: number) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value === true ? '1' : String(value));
  const route = 'tickets?' + params.toString();
  const query = useInfiniteQuery({ queryKey: [route], initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => api<ReturnType<Collaboration['ticketPage']>>(route + (pageParam ? '&after=' + part(pageParam) : ''), undefined, signal),
    getNextPageParam: page => page.next, enabled, retry: false, refetchInterval: interval });
  const rows = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status) ? []
    : [...new Map(query.data?.pages.flatMap(page => page.rows.map(row => [row.id, row] as const))).values()];
  return { ...query, rows };
}

export function useMessages(route: string) {
  const paged = route + (route.includes('?') ? '&' : '?') + 'paged=1';
  const query = useInfiniteQuery({ queryKey: [paged], initialPageParam: undefined as number | undefined,
    queryFn: ({ signal, pageParam }) => api<ReturnType<Collaboration['conversationPage']>>(paged + (pageParam ? '&before=' + pageParam : ''), undefined, signal),
    getNextPageParam: page => page.next, retry: false, refetchInterval: 4000 });
  const rows = query.data && [...new Map(query.data.pages.slice().reverse().flatMap(page => page.rows.map(row => [row.id, row] as const))).values()];
  return { ...query, rows };
}

export function useConversations(filters: { project?: string; q?: string; archived: boolean }) {
  const params = new URLSearchParams();
  if (filters.project) params.set('project', filters.project);
  if (filters.q) params.set('q', filters.q);
  if (filters.archived) params.set('archived', '1');
  const route = 'conversations?' + params.toString();
  const query = useInfiniteQuery({ queryKey: [route], initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => api<ConversationList>(route + (pageParam ? (params.size ? '&' : '') + 'after=' + part(pageParam) : ''), undefined, signal),
    getNextPageParam: page => page.next, retry: false, refetchInterval: 8000 });
  const rows = query.error ? [] : [...new Map(query.data?.pages.flatMap(page =>
    page.rows.map(row => [row.project + ':' + row.scope, row] as const))).values()];
  return { ...query, rows };
}

export function readable(entry: Knowledge): entry is ReadableKnowledge { return 'body' in entry; }
export const uid = () => crypto.randomUUID();
export const part = (value: string) => encodeURIComponent(value);
