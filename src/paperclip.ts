import { secrets } from './config.ts';

/** P0：主控制面的 board token 来源。local_trusted 下为空（loopback 免鉴权），
 *  切 authenticated 后从 secrets.json 读到，调用方无需逐处传。 */
function boardToken(): string | undefined {
  try { return secrets().boardToken || undefined; } catch { return undefined; }
}

export class Paperclip {
  constructor(readonly url: string, readonly token: string | undefined = boardToken() ?? process.env.COLLAB_PAPERCLIP_BOARD_TOKEN, readonly runId?: string) {}
  async request<T = any>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.url}/api${route}`, { method, signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.runId ? { 'X-Paperclip-Run-Id': this.runId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Paperclip ${method} ${route}: ${response.status} ${text.slice(0, 1200)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  get<T = any>(route: string) { return this.request<T>('GET', route); }
  post<T = any>(route: string, body: unknown) { return this.request<T>('POST', route, body); }
  patch<T = any>(route: string, body: unknown) { return this.request<T>('PATCH', route, body); }
  async document(issueId: string, key: string, title: string, body: string) {
    let revision: string | null = null;
    try { const existing = await this.get(`/issues/${issueId}/documents/${key}`); if (existing.body === body && existing.title === title) return existing; revision = existing.latestRevisionId ?? existing.currentRevisionId ?? existing.document?.latestRevisionId ?? existing.document?.currentRevisionId ?? null; }
    catch (error) { if (!String(error).includes(': 404 ')) throw error; }
    return this.request('PUT', `/issues/${issueId}/documents/${key}`, { title, format: 'markdown', body, baseRevisionId: revision });
  }
}
