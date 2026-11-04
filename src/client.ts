import { loadConfig, secrets } from './config.ts';
export async function api<T = any>(route: string, data?: unknown, agent?: string): Promise<T> {
  const config = loadConfig(); const all = secrets();
  const token = agent ? all.agentTokens[agent] : all.adminToken;
  if (!token) throw new Error('Unknown local identity');
  const response = await fetch(`http://127.0.0.1:${config.bridgePort}${route}`, {
    method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }); const body = await response.json() as any; if (!response.ok) throw new Error(body.error); return body;
}
