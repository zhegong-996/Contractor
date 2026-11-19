import { useSyncExternalStore } from 'react';
import type { Overview, Project } from './api.ts';

export const titles = { chat: '会话', inbox: '待我处理', work: '任务中心', knowledge: '知识与记忆', agents: 'Agent', project: '项目', accounts: '连接与账号' } as const;
export type View = keyof typeof titles;
export type GlobalView = 'platform' | 'account';
export type Route = { project: string; view: View; item?: string; tab?: string; run?: number; attempt?: number; revision?: string;
  reply?: string; participant?: string; global?: GlobalView; consultation?: { ticket: string; revision: string } };
export type TaskPreset = {
  request?: string;
  agent?: string; parent?: string; topic?: string; material?: string[];
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
    if (pathname === 'platform' || pathname === 'account')
      return { project: '', view: 'inbox', global: pathname, tab: new URLSearchParams(search).get('tab') ?? undefined };
    const [project = '', view = 'inbox', item] = (pathname ?? '').split('/').map(decodeURIComponent);
    const params = new URLSearchParams(search);
    const consultation = /^([a-z0-9-]{1,80})\.([a-f0-9]{64})$/.exec(params.get('consultation') ?? '');
    const positive = (key: string) => {
      const value = Number(params.get(key));
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    };
    return { project, view: Object.hasOwn(titles, view) ? view as View : 'inbox', item, tab: params.get('tab') ?? undefined,
      run: positive('run'), attempt: positive('attempt'), revision: params.get('revision') ?? undefined,
      reply: params.get('reply') ?? undefined, participant: params.get('agent') ?? undefined,
      ...(consultation && { consultation: { ticket: consultation[1]!, revision: consultation[2]! } }) };
  } catch { return { project: '', view: 'inbox' }; }
}
