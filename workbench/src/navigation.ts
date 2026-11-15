import { useSyncExternalStore } from 'react';
import type { Overview, Project } from './api.ts';

export const titles = { inbox: '待我处理', work: '协作工单', knowledge: '知识库', agents: 'Agent', project: '项目', accounts: '连接与账号' } as const;
export type View = keyof typeof titles;
export type Route = { project: string; view: View; item?: string; tab?: string };
export type TaskPreset = {
  agent?: string; parent?: string; topic?: string; material?: string[];
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
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [pathname, search] = hash.slice(2).split('?');
  try {
    const [project = '', view = 'inbox', item] = (pathname ?? '').split('/').map(decodeURIComponent);
    return { project, view: Object.hasOwn(titles, view) ? view as View : 'inbox', item, tab: new URLSearchParams(search).get('tab') ?? undefined };
  } catch { return { project: '', view: 'inbox' }; }
}
