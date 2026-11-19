import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';

export const deviceRouteInput = z.object({
  agent: z.string().min(1).max(80),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  primary: z.uuid().nullable(),
  fallback: z.uuid().nullable(),
}).strict().refine(route => (!route.fallback || route.primary && route.primary !== route.fallback), '主执行端与备用执行端必须不同。');
type Route = Pick<z.infer<typeof deviceRouteInput>, 'primary' | 'fallback'>;
const emptyRoute: Route = { primary: null, fallback: null };

export function openDeviceRouting(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_device_route (
    project TEXT NOT NULL, agent TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(project,agent)
  )`);
  function current(project: string, agent: string): Route {
    const row = db.prepare('SELECT value FROM workbench_device_route WHERE project=? AND agent=?').get(project, agent);
    return row ? JSON.parse(String(row.value)) as Route : emptyRoute;
  }
  return {
    current,
    list(project: string) {
      return db.prepare('SELECT agent,value FROM workbench_device_route WHERE project=? ORDER BY agent').all(project).map(row => ({
        agent: String(row.agent), ...JSON.parse(String(row.value)) as Route,
      }));
    },
    update(project: string, agent: string, revision: string, route: Route) {
      if (digest(current(project, agent)) !== revision) throw new WorkbenchError('执行端路由已变化，请刷新。', 409);
      if (route.primary) db.prepare('INSERT OR REPLACE INTO workbench_device_route VALUES (?,?,?)').run(project, agent, JSON.stringify(route));
      else db.prepare('DELETE FROM workbench_device_route WHERE project=? AND agent=?').run(project, agent);
    },
  };
}

export function routedDevice<T>(route: Route, allowed: (id: string) => T | undefined, online: (device: T) => boolean) {
  const primary = route.primary ? allowed(route.primary) : undefined;
  const fallback = route.fallback ? allowed(route.fallback) : undefined;
  if (primary && online(primary)) return primary;
  return fallback && online(fallback) ? fallback : primary ?? fallback;
}
