import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { z } from 'zod';
import { root, runtime } from '../config.ts';
import { ConsoleAuth, CONSOLE_ROLES } from '../console-auth.ts';
import { command } from '../commands.ts';
import { feishuTrigger, sendFeishu } from '../upstream.ts';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { loadSettings, title } from './config.ts';
import { openCollaboration, WorkbenchError } from './collaboration.ts';
import { measureSchema, observationSchema } from './learning.ts';

const stateDir = process.env.COLLAB_STATE_DIR;
if (!stateDir || !path.isAbsolute(stateDir)) throw new Error('请提供独立工作台的 COLLAB_STATE_DIR 绝对路径。');

const auth = new ConsoleAuth();
await mkdir(runtime(), { recursive: true, mode: 0o700 });
async function prepareAuth() {
  await mkdir(runtime('console'), { recursive: true, mode: 0o700 });
  await writeFile(runtime('secrets.json'), JSON.stringify({ jwtSecret: randomBytes(32).toString('hex') }),
    { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await auth.ready();
}
const nonce = z.string().uuid();
const id = z.string().min(1).max(80);
const prose = z.string().trim().min(1).max(3500);
const settingsRoutes = {
  start: z.object({ project: id, title, request: prose, nonce, material: z.array(id).max(8).default([]),
    priority: z.enum(['normal', 'urgent']).default('normal'), agent: id.optional(), function: id.optional(), parent: id.optional(), measure: measureSchema.optional(), reusedLesson: id.optional() }).strict(),
  answer: z.object({ card: z.number().int().positive(), choice: z.number().int().nonnegative().optional(), text: prose.optional(), nonce }).strict(),
  accept: z.object({ revision: z.string().length(64), commit: z.string().regex(/^[a-f0-9]{40}$/).optional(), body: z.string().trim().max(16000).default(''), conditions: z.string().trim().max(600).default('') }).strict(),
  add: z.object({ title, body: z.string().trim().min(1).max(16000), conditions: z.string().trim().max(600).default(''),
    kind: z.enum(['reference', 'procedure', 'decision']), visibility: z.enum(['project', 'restricted']) }).strict(),
  access: z.object({ entry: id, reason: prose }).strict(),
  changeAccess: z.object({ state: z.enum(['granted', 'revoked']) }).strict(),
  publish: z.object({ revision: z.string().length(64) }).strict(),
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serve() {
  // Defined above before the first HTTP request. Hosting remains on the local machine.
  const config = await loadSettings();
  const feishu = config.feishu;
  let work: Awaited<ReturnType<typeof openCollaboration>> | undefined;
  let available = false;
  const staticRoot = path.join(root, 'workbench');
  const assets = new Map([
    ['/', [path.join(staticRoot, 'index.html'), 'text/html'] ],
    ['/app.js', [path.join(staticRoot, 'app.js'), 'text/javascript']],
    ['/workbench.css', [path.join(staticRoot, 'style.css'), 'text/css']],
    ['/vue.js', [path.join(root, 'console/vendor/vue.global.prod.js'), 'text/javascript']],
  ]);

  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') { json(res, available ? 200 : 503, { ready: available, engine: 'superagent', executor: 'autoloop' }); return; }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      const file = req.method === 'GET' && assets.get(url.pathname);
      if (file) {
        res.writeHead(200, { 'content-type': file[1] + '; charset=utf-8' }).end(await readFile(file[0]!));
        return;
      }
      if (!url.pathname.startsWith('/api/')) throw new WorkbenchError('未找到。', 404);
      if (req.headers.host !== '127.0.0.1:' + config.port && req.headers.host !== 'localhost:' + config.port) throw new WorkbenchError('请使用本机工作台地址。', 403);
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && origin !== 'http://' + req.headers.host) throw new WorkbenchError('请在工作台内操作。', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkbenchError('请求格式无效。', 415);
      }
      if (!work) throw new WorkbenchError('工作台正在启动。', 503);
      const parts = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
      const [view, item = '', action, reference] = parts;
      const post = req.method === 'POST';
      const get = req.method === 'GET';
      if (post && view === 'login') {
        const input = z.object({ username: id, password: z.string().max(300) }).parse(await body(req));
        try {
          const { cookie, session } = auth.login(input.username, input.password);
          res.setHeader('set-cookie', cookie + '; HttpOnly; SameSite=Strict; Path=/');
          json(res, 200, { username: session.username });
        } catch (error) { throw new WorkbenchError((error as Error).message, 401); }
        return;
      }
      const session = auth.sessionFromRequest(req.headers.cookie);
      const actor = session?.username;
      if (get && view === 'session') { json(res, 200, { signedIn: !!actor }); return; }
      if (!actor || !auth.listAccounts().some(a => a.username === actor && !a.disabled))
        throw new WorkbenchError('请先登录。', 401);
      let output: unknown;
      if (post && view === 'logout') auth.logout(req.headers.cookie);
      else if (get && view === 'overview') output = work.overview(actor);
      else if (get && view === 'ticket' && item) output = work.detail(actor, item);
      else if (get && view === 'request' && item) output = { ticket: work.resolveStart(actor, item) };
      else if (post && view === 'project' && item && action === 'bind') {
        const value = z.object({ source: z.enum(['feishu', 'github', 'figma']), externalId: z.string().min(1).max(200) }).parse(await body(req));
        work.bindResource(actor, item, value.source, value.externalId);
      } else if (post && view === 'agent' && item) work.setAgent(actor, item, z.object({ active: z.boolean() }).parse(await body(req)).active);
      else if (post && view === 'ticket' && !item) output = work.start(actor, settingsRoutes.start.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'answer') work.reply(actor, item, settingsRoutes.answer.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'stop') work.stop(actor, item);
      else if (post && view === 'ticket' && action === 'delivery') {
        const value = z.object({ url: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }) }).parse(await body(req));
        await work.linkDelivery(actor, item, value.url);
      } else if (post && view === 'ticket' && action === 'accept') {
        const value = settingsRoutes.accept.parse(await body(req));
        if (value.body && !value.conditions) throw new WorkbenchError('请填写这条结论的适用条件。');
        await work.accept(actor, item, value.revision, value.conditions, value.body, value.commit);
      } else if (post && view === 'ticket' && action === 'observation') {
        output = work.recordObservation(actor, item, observationSchema.parse(await body(req)));
      } else if (post && view === 'ticket' && action === 'access' && !reference) {
        const input = settingsRoutes.access.parse(await body(req));
        work.request(actor, item, input.entry, input.reason);
      } else if (post && view === 'ticket' && action === 'access' && reference)
        work.changeAccess(actor, item, reference, settingsRoutes.changeAccess.parse(await body(req)).state);
      else if (get && view === 'knowledge' && item) output = work.browse(actor, item, (url.searchParams.get('q') ?? '').slice(0, 300));
      else if (post && view === 'knowledge' && action === 'publish') work.publish(actor, item, settingsRoutes.publish.parse(await body(req)).revision);
      else if (post && view === 'knowledge' && item) output = { id: work.addKnowledge(actor, item, settingsRoutes.add.parse(await body(req))) };
      else throw new WorkbenchError('未找到。', 404);
      json(res, 200, output ?? { ok: true });
    } catch (error) {
      if (error instanceof WorkbenchError) json(res, error.status, { error: error.message });
      else if (error instanceof z.ZodError || error instanceof SyntaxError) json(res, 400, { error: '请检查输入的格式与长度。' });
      else { console.error('SuitMe 工作台请求失败：', String(error)); json(res, 500, { error: '操作暂未完成，请刷新状态后重试。' }); }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  try {
    await prepareAuth();
    const collaboration = await openCollaboration(config, auth, feishu && (message =>
      sendFeishu({ commands: { lark: (args: string[]) => command('lark-cli', ['--profile', feishu.profile, ...args, '--as', 'bot']) } }, message)));
    work = collaboration;
    available = true;
    console.log('SuitMe 工作台 http://127.0.0.1:' + config.port);
    const consumer = feishu && spawn('lark-cli', ['--profile', feishu.profile, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot'], { stdio: ['pipe', 'pipe', 'pipe'] });
    if (consumer && feishu) {
      consumer.on('error', error => console.error('飞书接入失败：', error.message));
      consumer.stderr.resume();
      createInterface({ input: consumer.stdout }).on('line', line => {
        try {
          const event = JSON.parse(line);
          if (event.sender_type !== 'user' || (event.message_type && event.message_type !== 'text')) return;
          const content = typeof event.content === 'string' ? event.content : '';
          if (content.length > 16000) return;
          const mentions: { id: string; key?: string }[] = Array.isArray(event.mentions) ? event.mentions : [];
          const normalized = { ...event, root_id: event.root_id || undefined, parent_id: event.parent_id || undefined, content };
          const trigger = feishuTrigger(normalized, feishu.botId, feishu.appId) as Trigger | undefined;
          if (!trigger?.human) return;
          const matches = auth.listAccounts().filter(a => a.feishuOpenId === trigger.actor.id && !a.disabled);
          const actor = matches.length === 1 && matches[0];
          const project = collaboration.boundProject('feishu', String(trigger.meta.chatId));
          if (!actor || !project) return;
          const mention = mentions.find(m => m.id === feishu.botId || m.id === feishu.appId);
          const text = mention?.key && content.trimStart().startsWith(mention.key)
            ? content.trimStart().slice(mention.key.length).trim() : content.trim();
          const request = /^\/协作\s+([a-z][a-z0-9-]*)\s+([\s\S]+)$/.exec(text);
          const answer = /^\/答\s+([\s\S]+)$/.exec(text);
          if (request && trigger.addressed && !trigger.meta.rootId) {
            const value = prose.parse(request[2]);
            collaboration.start(actor.username, { project: project.id, agent: request[1], material: [], title: value.slice(0, 100),
              request: value, nonce: trigger.id, priority: 'normal' }, trigger);
          } else if (answer && trigger.meta.rootId) {
            const thread = trigger.threads[0]!;
            const ticket = collaboration.rootThread(project.id, thread.source, thread.id);
            if (!ticket) return;
            const [question] = collaboration.detail(actor.username, ticket).questions;
            if (!question) return;
            const value = prose.parse(answer[1]);
            collaboration.reply(actor.username, ticket, { card: question.id, nonce: trigger.id,
              ...(/^\d+$/.test(value) ? { choice: Number(value) - 1 } : { text: value }) }, trigger);
          }
        } catch (error) { console.error('飞书事件未受理：', (error as Error).name); }
      });
    }
    const close = () => {
      consumer?.kill();
      server.close();
      void collaboration.close().catch(console.error);
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch (error) { server.close(); throw error; }
}

async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 65000) throw new WorkbenchError('请求内容过长。', 413);
  }
  return JSON.parse(text || '{}');
}

const argv = process.argv.slice(2);
if (argv[0] === 'init-owner' || argv[0] === 'add-member') {
  await prepareAuth();
  const password = (await readFile('/dev/stdin', 'utf8')).trimEnd();
  if (argv[0] === 'init-owner') await auth.bootstrapOwner(argv[1] ?? '', password);
  else {
    const owner = auth.listAccounts().find(a => a.role === 'owner' && !a.disabled);
    if (!owner) throw new Error('请先初始化工作台所有者。');
    const role = z.enum(CONSOLE_ROLES).parse(argv[2]);
    if (argv[3] && !/^ou_[A-Za-z0-9]+$/.test(argv[3])) throw new Error('飞书成员标识无效。');
    if (argv[3] && auth.listAccounts().some(a => a.feishuOpenId === argv[3])) throw new Error('该飞书身份已绑定。');
    await auth.createAccount(argv[1] ?? '', password, role, owner.username, argv[3]);
  }
  console.log('本机工作台账号已保存。');
} else {
  await serve();
}
