import { useSyncExternalStore } from 'react';
import type { Overview, Project } from './api.ts';

export const titles = { inbox: '待我处理', work: '协作工单', knowledge: '知识与记忆', agents: 'Agent', project: '项目', accounts: '连接与账号' } as const;
export type View = keyof typeof titles;
export type Route = { project: string; view: View; item?: string; tab?: string; run?: number; attempt?: number };
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
export function runRoute(project: string, ticket: string, run: number, attempt: number) {
  return routeFor(project, 'work', ticket, 'context') + '&run=' + run + '&attempt=' + attempt;
}
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [pathname, search] = hash.slice(2).split('?');
  try {
    const [project = '', view = 'inbox', item] = (pathname ?? '').split('/').map(decodeURIComponent);
    const params = new URLSearchParams(search);
    const positive = (key: string) => {
      const value = Number(params.get(key));
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    };
    return { project, view: Object.hasOwn(titles, view) ? view as View : 'inbox', item, tab: params.get('tab') ?? undefined,
      run: positive('run'), attempt: positive('attempt') };
  } catch { return { project: '', view: 'inbox' }; }
}
