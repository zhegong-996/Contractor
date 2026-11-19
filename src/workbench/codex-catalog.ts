import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const modelPage = z.object({
  data: z.array(z.object({ model: z.string().min(1) })),
  nextCursor: z.string().nullish(),
});
const providerCache = z.object({
  models: z.array(z.object({ slug: z.string().min(1) })).min(1),
  fetched_at: z.iso.datetime({ offset: true }),
});

function listModels(command: string, args: string[], workspace: string) {
  return new Promise<Set<string>>((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    const lines = createInterface({ input: child.stdout });
    const models = new Set<string>(), cursors = new Set<string>();
    let id = 1, complete = false;
    const stop = () => {
      if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The probe has exited. */ }
    };
    const timeout = setTimeout(stop, 12_000);
    const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdin.on('error', stop);
    child.once('error', stop);
    child.once('close', () => {
      clearTimeout(timeout);
      lines.close();
      if (complete) resolve(models);
      else reject(new Error('无法核对当前成员的模型目录'));
    });
    lines.on('line', line => {
      let response;
      try { response = JSON.parse(line); }
      catch { return; } // The CLI may print non-protocol startup messages.
      if (complete || response?.id !== id) return;
      if (response.error || !response.result) return stop();
      let cursor: string | null | undefined;
      if (id === 1) send({ method: 'initialized' });
      else {
        const page = modelPage.safeParse(response.result);
        if (!page.success) return stop();
        for (const item of page.data.data) models.add(item.model);
        cursor = page.data.nextCursor;
        if (!cursor) {
          complete = true;
          child.stdin.end();
          return;
        }
        if (cursors.has(cursor) || cursors.size >= 19) return stop();
        cursors.add(cursor);
      }
      send({ id: ++id, method: 'model/list', params: { limit: 100, includeHidden: false,
        ...(cursor && { cursor }) } });
    });
    send({ id, method: 'initialize', params: { clientInfo: { name: 'contractor', version: '0.1.0' } } });
  });
}

export async function readCodexCatalog(command: string, args: string[], workspace: string, cacheFile: string) {
  async function probe() {
    const models = await listModels(command, args, workspace);
    const cache = providerCache.safeParse(await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => undefined));
    if (!cache.success) throw new Error('当前模型服务目录不可用');
    const verified = new Set(cache.data.models.map(row => row.slug).filter(model => models.has(model)));
    if (!verified.size) throw new Error('当前模型服务没有返回可用目录');
    return { models: verified, checkedAt: cache.data.fetched_at };
  }
  try { return await probe(); }
  catch {
    // Retry within the same claim. A fresh probe never trusts the CLI's bundled fallback.
    await delay(500);
    return probe();
  }
}
