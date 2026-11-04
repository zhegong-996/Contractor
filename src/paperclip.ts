export class Paperclip {
  constructor(readonly url: string, readonly token?: string, readonly runId?: string) {}
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
    try { const existing = await this.get(`/issues/${issueId}/documents/${key}`); revision = existing.latestRevisionId ?? existing.currentRevisionId ?? existing.document?.latestRevisionId ?? existing.document?.currentRevisionId ?? null; }
    catch (error) { if (!String(error).includes(': 404 ')) throw error; }
    return this.request('PUT', `/issues/${issueId}/documents/${key}`, { title, format: 'markdown', body, baseRevisionId: revision });
  }
}
