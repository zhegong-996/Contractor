import { useSyncExternalStore } from 'react';
import type { Overview, Project } from './api.ts';

export const titles = { home: '工作台', chat: '会话', inbox: '待我处理', work: '任务中心', knowledge: '知识与记忆', agents: 'Agent', project: '项目', accounts: '连接与账号' } as const;
export type View = keyof typeof titles;
export type GlobalView = 'platform' | 'account';
type ConversationOrigin = { project: string; item?: string; tab?: string; reply?: string };
export type Route = { project: string; view: View; item?: string; tab?: string; run?: number; attempt?: number; revision?: string;
  reply?: string; participant?: string; global?: GlobalView; conversationOrigin?: ConversationOrigin;
  personalChat?: true; workTopic?: string; projectWork?: boolean; myWork?: boolean; inboxOrigin?: string; decision?: string; reviewRevision?: string; returnTo?: string;
  consultation?: { ticket: string; revision: string } };
export type TaskPreset = {
  request?: string;
  agent?: string; device?: string; parent?: string; topic?: string; material?: string[];
  personal?: boolean;
  lesson?: { id: string; title: string; ticket: string; metric: string; unit: string; baseline: number };
};
export type PageProps = {
  workspace: Overview; project: Project; route: Route;
  openTask: (preset?: TaskPreset) => void;
};
export function routeFor(project: string, view: View, item?: string, tab?: string): string {
  return '#/' + [project, view, ...(item ? [item] : [])].map(encodeURIComponent).join('/') +
    (tab ? '?tab=' + encodeURIComponent(tab) : '');
}
export function go(project: string, view: View, item?: string, tab?: string) {
  window.location.hash = routeFor(project, view, item, tab);
}
export function personalChatRoute(conversation?: string, project?: string) {
  return '#/personal-chat' + (conversation ? '/' + encodeURIComponent(conversation) : '')
    + (project ? '?' + new URLSearchParams({ project }) : '');
}
export function agentSettingsRoute(tab: 'agent' | 'workers' | 'router', project: string) {
  return settingsRoute(tab === 'router' ? 'platform' : 'account', tab, workspaceReturn(window.location.hash), project);
}
export function workspaceReturn(hash: string | null) {
  if (hash && hash.length <= 1000 && /^#\/(?:[\w-]+\/(?:inbox|work|knowledge|agents|project|accounts|chat)(?:\/[\w-]+)?|personal-chat(?:\/[a-f0-9]{32})?)(?:\?[^\s#]*)?$/.test(hash)) return hash;
}
export function settingsRoute(view: GlobalView, tab?: string, from?: string, project?: string) {
  const returnTo = workspaceReturn(from ?? null);
  const params = new URLSearchParams({ ...(tab && { tab }), ...(project && { project }), ...(returnTo && { returnTo }) });
  return '#/' + view + (params.size ? '?' + params : '');
}
export function projectWorkRoute(project: string, topic?: string) {
  return routeFor(project, 'work') + '?' + new URLSearchParams({ scope: 'project', ...(topic && { topic }) });
}
export function workFromInbox(href: string, project?: string, decision?: string, revision?: string) {
  if (!project) return href;
  return href + (href.includes('?') ? '&' : '?') + new URLSearchParams({ fromInbox: project,
    ...(decision && { decision }), ...(revision && { review: revision }) });
}
export function conversationRoute(origin: ConversationOrigin) {
  const href = routeFor(origin.project, 'chat', origin.item, !origin.item && origin.tab === 'project' ? 'project' : undefined);
  return origin.item && origin.reply ? href + '?reply=' + encodeURIComponent(origin.reply) : href;
}
export function withConversationOrigin(href: string, origin?: ConversationOrigin) {
  if (!origin) return href;
  return href + (href.includes('?') ? '&' : '?') + new URLSearchParams({ fromChat: conversationRoute(origin) });
}
export function runRoute(project: string, ticket: string, run: number, attempt?: number) {
  return routeFor(project, 'work', ticket, 'execution') + '&run=' + run + (attempt === undefined ? '' : '&attempt=' + attempt);
}
export function deliveryVersionRoute(project: string, ticket: string, revision: string) {
  return routeFor(project, 'work', ticket, 'delivery') + '&revision=' + encodeURIComponent(revision);
}
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [pathname, search] = hash.slice(2).split('?');
  try {
    const params = new URLSearchParams(search);
    if (!pathname) return { project: '', view: 'home' };
    const personal = /^personal-chat(?:\/([a-f0-9]{32}))?$/.exec(pathname ?? '');
    if (personal) return { project: params.get('project') ?? '', view: 'chat', personalChat: true, item: personal[1] };
    if (pathname === 'platform' || pathname === 'account')
      return { project: params.get('project') ?? '', view: 'inbox', global: pathname, tab: params.get('tab') ?? undefined,
        returnTo: workspaceReturn(params.get('returnTo')) };
    const [project = '', view = 'inbox', item] = (pathname ?? '').split('/').map(decodeURIComponent);
    const tab = params.get('tab') ?? undefined;
    const projectDiscussion = view === 'project' && tab === 'chat';
    const originMatch = view === 'work'
      ? /^#\/([\w-]+)\/chat(?:\/([\w-]+))?(?:\?(?:tab=(project)|reply=([a-f0-9]{32})))?$/.exec(params.get('fromChat') ?? '') : null;
    const conversationOrigin = originMatch ? { project: originMatch[1]!, item: originMatch[2], tab: originMatch[3], reply: originMatch[4] } : undefined;
    const consultation = /^([a-z0-9-]{1,80})\.([a-f0-9]{64})$/.exec(params.get('consultation') ?? '');
    const positive = (key: string) => {
      const value = Number(params.get(key));
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    };
    const token = (name: string, pattern: RegExp) => {
      const value = params.get(name);
      return value && pattern.test(value) ? value : undefined;
    };
    return { project, view: projectDiscussion ? 'chat' : Object.hasOwn(titles, view) ? view as View : 'inbox', item,
      tab: projectDiscussion ? (item ? undefined : 'project') : tab,
      run: positive('run'), attempt: positive('attempt'), revision: params.get('revision') ?? undefined,
      reply: params.get('reply') ?? undefined, participant: params.get('agent') ?? undefined, conversationOrigin,
      ...(view === 'work' && {
        workTopic: token('topic', /^[\w-]{1,80}$/), projectWork: params.get('scope') === 'project', myWork: params.get('scope') === 'mine',
        inboxOrigin: token('fromInbox', /^[\w-]{1,80}$/), decision: token('decision', /^[a-f0-9]{32}$/),
        reviewRevision: token('review', /^[a-f0-9]{64}$/),
      }),
      ...(consultation && { consultation: { ticket: consultation[1]!, revision: consultation[2]! } }) };
  } catch { return { project: '', view: 'inbox' }; }
}
