import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { loadConfig, runtime, secrets } from './config.ts';
import { Store } from './store.ts';
import { Controller } from './controller.ts';
import { command } from './commands.ts';
import { sendFeishu } from './upstream.ts';
import { KnowledgeService } from './knowledge.ts';
import { Paperclip } from './paperclip.ts';
import { Workspaces } from './workspaces.ts';

const config = loadConfig(); const credentials = secrets();
const store = new Store(runtime('bridge.sqlite')); const control = new Controller(config, store);
const knowledge = new KnowledgeService(config, store, control.pc, credentials.jwtSecret);
const workspaces = new Workspaces(config, store);
let feishuState = config.feishu.enabled ? 'connecting' : 'disabled';
let tail: Promise<unknown> = Promise.resolve();
const serialize = <T>(job: () => Promise<T>): Promise<T> => { const next = tail.then(job, job); tail = next.catch(() => {}); return next; };
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function identity(req: IncomingMessage): { admin: boolean; agent?: string } {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  if (equal(token, credentials.adminToken)) return { admin: true };
  const agent = Object.entries(credentials.agentTokens).find(([, value]) => equal(token, value))?.[0];
  if (!agent || !config.agents[agent]?.enabled) throw new Error('Unauthorized'); return { admin: false, agent };
}
async function body(req: IncomingMessage): Promise<any> { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 512000) throw new Error('Request too large'); } return data ? JSON.parse(data) : {}; }
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.bridgePort}`);
    if (url.pathname === '/health') { res.end(JSON.stringify({ status: 'ok', paperclip: config.paperclipUrl, feishu: feishuState, agents: Object.entries(config.agents).filter(([, a]) => a.enabled).map(([key, a]) => ({ key, mode: a.mode })) })); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/preview/')) {
      const match = /^\/preview\/([a-f0-9-]+)\/([a-f0-9]{40})\/(index\.html|version\.json)$/.exec(url.pathname);
      if (!match) throw new Error('Invalid preview path');
      const task = store.get(match[1]!);
      if (task.delivery?.deployedSha !== match[2]) throw new Error('Preview is not the current verified delivery');
      const file = path.join(runtime('previews'), match[1]!, match[2]!, match[3]!);
      res.setHeader('Content-Type', match[3] === 'index.html' ? 'text/html; charset=utf-8' : 'application/json');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'");
      res.end(await readFile(file)); return;
    }
    if (req.headers.origin) throw new Error('Browser mutations are not accepted by this local bridge');
    if (req.method === 'POST' && url.pathname.startsWith('/workspace/')) {
      const data = await body(req), token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      let workspaceActor;
      if (credentials.workspacePluginToken && equal(token, credentials.workspacePluginToken)) {
        const host = data.hostActor;
        if (host?.companyId !== config.companyId) throw new Error('Unauthorized: company boundary');
        if (host.type === 'user' && host.userId === 'local-board') workspaceActor = { admin: true };
        else if (host.type === 'agent') {
          const key = Object.entries(config.agents).find(([, value]) => value.enabled && value.paperclipId === host.agentId)?.[0];
          if (!key) throw new Error('Unauthorized'); workspaceActor = { admin: false, agent: key };
        } else throw new Error('Unauthorized: this installation has no multi-user operator binding');
      } else workspaceActor = identity(req);
      const payload = data.payload ?? data;
      res.end(JSON.stringify(await serialize(() => workspaces.dispatch(url.pathname.slice('/workspace/'.length), payload, workspaceActor)))); return;
    }
    const actor = identity(req);
    const reader = actor.agent ? new Paperclip(config.paperclipUrl, credentials.paperclipTokens?.[actor.agent] ?? 'unconfigured-identity') : control.pc;
    if (url.pathname === '/knowledge') {
      if (!actor.admin || req.method !== 'GET') throw new Error('Unauthorized');
      res.end(JSON.stringify(await serialize(() => knowledge.list()))); return;
    }
    if (req.method === 'GET' && url.pathname === '/tasks') {
      const tasks = store.list().filter(t => actor.admin || t.agent === actor.agent).map(({ lease, context, ...t }) => t);
      res.end(JSON.stringify(tasks)); return;
    }
    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (!actor.admin) throw new Error('Unauthorized'); const data = await body(req);
      res.end(JSON.stringify(await serialize(() => control.ingest(data)))); return;
    }
    const match = /^\/tasks\/([^/]+)(?:\/(claim|receipt|publish|sync|preview|accept|handoff|reply|reconcile|knowledge-propose|knowledge-review|knowledge-attach))?$/.exec(url.pathname);
    if (!match) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); return; }
    const task = store.get(match[1]!);
    if (!actor.admin && task.agent !== actor.agent) throw new Error('Task belongs to another agent');
    if (req.method === 'GET' && !match[2]) { const { lease, ...safe } = task; res.end(JSON.stringify({ ...safe, knowledge: await knowledge.resolve(task, reader) })); return; }
    if (req.method !== 'POST') throw new Error('Method not allowed');
    const data = await body(req); const action = match[2];
    const result = await serialize(async () => {
      if (action === 'knowledge-propose') return task.kind === 'collaboration' ? workspaces.propose(task.id, data, actor) : knowledge.propose(store.get(task.id), data, actor.agent ?? 'local-operator', reader);
      if (action === 'knowledge-review' || action === 'knowledge-attach') {
        if (task.kind === 'collaboration') throw new Error('请通过知识协作入口处理来源依赖与确认');
        if (!actor.admin) throw new Error('Unauthorized');
        if (action === 'knowledge-attach') return knowledge.attach(store.get(task.id), data.refs);
        if (!['confirmed', 'withdrawn'].includes(data.state)) throw new Error('Invalid review state');
        return knowledge.review({ taskId: task.id, key: data.key }, data.state, data.revision, 'local-operator');
      }
      if (action === 'claim') {
        const agent = actor.agent ?? data.agent;
        if (!config.agents[agent]?.enabled) throw new Error('Agent unavailable');
        if (task.kind === 'knowledge') throw new Error('知识条目不能作为执行任务领取');
        if (task.kind === 'collaboration') await workspaces.guard(task, agent);
        const sourceReader = new Paperclip(config.paperclipUrl, credentials.paperclipTokens?.[agent] ?? 'unconfigured-identity');
        if ((await knowledge.resolve(store.get(task.id), sourceReader)).excluded.length) throw new Error('Knowledge access changed; review the source grants and previous checkpoint before resuming');
        const issue = await control.pc.get(`/issues/${task.id}`);
        if (data.runId) {
          const run = await control.pc.get(`/heartbeat-runs/${data.runId}`);
          if (run.agentId !== config.agents[agent]!.paperclipId || run.contextSnapshot?.issueId !== task.id || run.status !== 'running'
            || issue.executionRunId !== data.runId) throw new Error('Run does not own this task');
        } else {
          if (config.agents[agent]!.mode === 'managed') throw new Error('Managed agents must claim with their Paperclip run');
          await control.pc.post(`/issues/${task.id}/checkout`, { agentId: config.agents[agent]!.paperclipId, expectedStatuses: ['todo', 'in_progress', 'blocked'] });
        }
        const claimed = store.claim(task.id, agent, data.lease ?? randomUUID());
        if (data.runId) { claimed.runId = data.runId; store.save(claimed); }
        return claimed;
      }
      if (action === 'receipt') {
        if (!actor.admin && data.agent !== actor.agent) throw new Error('Unauthorized');
        if (task.kind === 'collaboration') return { outcome: 'done', checkpoint: await workspaces.checkpoint(task.id, data.text, actor, data.lease, data.receiptId) };
        return control.receipt(task.id, data);
      }
      if (action === 'publish') { if (task.kind === 'collaboration') throw new Error('跨岗位任务通过知识采用交付，不推送代码'); return control.publish(task.id); }
      if (action === 'sync') return control.sync(task.id);
      if (action === 'preview') return control.preview(task.id);
      if (!actor.admin) throw new Error('This action requires the human task owner');
      if (action === 'reconcile') return control.reconcile(task.id);
      if (action === 'accept') return control.accept(task.id, data.sha, data.cases, data.actor ?? 'local-operator', data.eventId ?? randomUUID());
      if (action === 'handoff') return task.kind === 'collaboration' ? workspaces.handoff(task.id, data.agent, actor) : control.handoff(task.id, data.agent);
      if (action === 'reply') { if (task.kind === 'collaboration') throw new Error('请使用受限检查点记录后续工作'); return control.reply(task.id, data.text, data.eventId ?? randomUUID()); }
      throw new Error('Unknown action');
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.statusCode = message.includes('Unauthorized') || message.includes('another agent') ? 403 : message.includes('not found') ? 404 : 409;
    res.end(JSON.stringify({ error: message }));
  }
});

async function deliver() {
  const rows = store.db.prepare("SELECT * FROM outbox WHERE state='pending'").all() as { id: string; issue_id: string; text: string }[];
  if (!config.feishu.enabled) return;
  for (const row of rows) {
    const task = store.get(row.issue_id);
    if (!task.messageId.startsWith('om_')) { store.db.prepare("UPDATE outbox SET state='local_only' WHERE id=?").run(row.id); continue; }
    await sendFeishu({ commands: { lark: async (args: string[]) => {
      const result = JSON.parse(await command('lark-cli', ['--profile', config.feishu.profile, ...args, '--as', 'bot', '--format', 'json']));
      if (!result.ok) throw new Error(result.error?.message ?? 'Feishu reply failed'); return result.data;
    } } } as any, { id: row.id, text: row.text, channel: { address: { messageId: task.messageId } } } as any);
    store.db.prepare("UPDATE outbox SET state='sent' WHERE id=?").run(row.id);
  }
}
let stopping = false;
async function tick() {
  if (stopping) return;
  try {
    await serialize(async () => {
      for (const task of store.list().filter(t => t.phase === 'delivered')) {
        await control.sync(task.id);
        const fresh = store.get(task.id);
        if (fresh.delivery?.ci === 'passed' && !fresh.delivery.deployedSha) {
          try { await control.preview(task.id); } catch (error) { store.audit('preview.pending', task.id, { error: String(error).slice(0, 400) }); }
        }
      }
      await deliver();
      await workspaces.tick();
    });
  } catch (error) { console.error('Background check:', String(error).slice(0, 500)); }
  if (!stopping) setTimeout(tick, config.pollMs).unref();
}
let consumer: ReturnType<typeof spawn> | undefined;
if (config.feishu.enabled) {
  if (!config.feishu.allowedSenders.length || !config.feishu.botId) throw new Error('Feishu admission must be configured before listening');
  consumer = spawn('lark-cli', ['--profile', config.feishu.profile, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let ready = false;
  readline.createInterface({ input: consumer.stderr! }).on('line', line => {
    if (line.includes('[event] ready event_key=')) { ready = true; feishuState = 'ready'; console.log('Feishu message listener ready'); }
    else console.error(line);
  });
  readline.createInterface({ input: consumer.stdout! }).on('line', line => {
    if (!ready) return;
    try { const event = JSON.parse(line); void serialize(() => control.ingest(event)).catch(error => console.error('IM intake:', String(error).slice(0, 500))); }
    catch { console.error('Invalid Feishu event JSON'); }
  });
  consumer.on('error', error => { feishuState = 'disconnected'; console.error('Feishu listener:', error.message); });
  consumer.on('exit', code => { ready = false; feishuState = 'disconnected'; if (!stopping) console.error(`Feishu listener exited (${code}); restart after restoring the connection`); });
}
server.listen(config.bridgePort, '127.0.0.1', () => { console.log(`SuitMe bridge: http://127.0.0.1:${config.bridgePort}`); void tick(); });
async function shutdown(code = 0) {
  if (stopping) return; stopping = true; consumer?.stdin?.end(); consumer?.kill('SIGTERM');
  await tail; server.close(() => { store.close(); process.exit(code); });
}
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
