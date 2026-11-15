import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { root, runtime } from '../config.ts';
import { ConsoleAuth, CONSOLE_ROLES } from '../console-auth.ts';
import { command } from '../commands.ts';
import { feishuTrigger, feishuTriggerId, sendFeishu } from '../upstream.ts';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { loadSettings, title } from './config.ts';
import { openCollaboration, WorkbenchError } from './collaboration.ts';
import { measureSchema, observationSchema } from './learning.ts';
import { channelCommand, feishuCommandText, messageRef, type ChannelRef, type PlatformActor } from './channel-links.ts';
import { githubReference, watchGithub } from './github-intake.ts';
import { referenceSchema, resourceSource, topicInputSchema } from './project-resources.ts';
import { discussionInput } from './discussion-intake.ts';
import { watchFeishu } from './feishu-events.ts';

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
const provider = z.enum(['feishu', 'github']);
const accountRef = z.object({ provider, namespace: z.string().min(1).max(180), id });
const githubUrl = z.url({ protocol: /^https$/, hostname: /^github\.com$/ });
const channelDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), ticket: id }),
  z.object({ action: z.literal('create'), project: id.optional(), topic: id.optional(), agent: id.optional(), parent: id.optional(),
    brief: prose.optional(), separate: z.boolean().optional() }),
  z.object({ action: z.literal('project') }),
  z.object({ action: z.literal('topic'), topic: id }),
  z.object({ action: z.literal('dismiss') }),
]);
const selectedMessage = { message: id.optional() };
const discussionDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('project'), ...selectedMessage }).strict(),
  z.object({ action: z.literal('topic'), topic: id, ...selectedMessage }).strict(),
  z.object({ action: z.literal('link'), ticket: id, ...selectedMessage }).strict(),
  z.object({ action: z.literal('create'), agent: id.optional(), topic: id.optional(), ...selectedMessage }).strict(),
  z.object({ action: z.literal('dismiss'), ...selectedMessage }).strict(),
]);
const settingsRoutes = {
  start: z.object({ project: id, title, request: prose, nonce, material: z.array(id).max(8).default([]),
    resources: z.array(z.string().max(180)).max(12).default([]), target: z.string().max(180).optional(), topic: id.optional(),
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
  let feishuWatch: ReturnType<typeof watchFeishu> | undefined;
  let available = false;
  const staticRoot = path.join(root, 'workbench');
  const assets = new Map([
    ['/', [path.join(staticRoot, 'index.html'), 'text/html'] ],
    ['/app.js', [path.join(staticRoot, 'app.js'), 'text/javascript']],
    ['/workbench.css', [path.join(staticRoot, 'style.css'), 'text/css']],
    ['/vue.js', [path.join(staticRoot, 'vendor/vue.global.prod.js'), 'text/javascript']],
  ]);

  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        const subscription = feishu && (feishuWatch?.status() ?? { state: 'connecting' });
        const ready = available && (!subscription || subscription.state === 'ready');
        json(res, ready ? 200 : 503, { ready, engine: 'superagent', executor: 'autoloop', feishu: subscription });
        return;
      }
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
      else if (get && view === 'needs-you') output = work.needsYou(actor);
      else if (post && view === 'intake' && item && action === 'resolve') {
        const input = z.discriminatedUnion('action', [
          z.object({ action: z.literal('create'), agent: id.optional() }).strict(),
          z.object({ action: z.literal('dismiss') }).strict(),
        ]).parse(await body(req));
        output = work.resolveIntake(actor, item, input);
      }
      else if (get && view === 'discussion' && item && action === 'revisions' && reference)
        output = await work.discussionRevisions(actor, item, reference);
      else if (get && view === 'discussion' && item) output = work.discussionView(actor, item);
      else if (post && view === 'discussion' && item && action === 'resolve')
        output = work.resolveDiscussion(actor, item, discussionDecision.parse(await body(req)));
      else if (config.crossChannel && get && view === 'channels') output = work.channelView(actor);
      else if (config.crossChannel && post && view === 'channels' && item === 'proof') {
        const input = z.object({ provider }).parse(await body(req));
        output = work.accountProof(actor, input.provider);
      } else if (config.crossChannel && post && view === 'channels' && item === 'confirm') {
        const input = accountRef.parse(await body(req));
        work.confirmAccount(actor, input.provider, input);
      } else if (config.crossChannel && post && view === 'channels' && item === 'unlink') {
        const input = accountRef.parse(await body(req));
        work.revokeAccount(actor, input.provider, input.namespace, input.id);
      } else if (config.crossChannel && post && view === 'channels' && action === 'resolve') {
        output = work.resolveChannel(actor, item, channelDecision.parse(await body(req)));
      }
      else if (get && view === 'ticket' && item) output = work.detail(actor, item);
      else if (get && view === 'request' && item) output = { ticket: work.resolveStart(actor, item) };
      else if (post && view === 'project' && item && action === 'bind') {
        const value = z.object({ source: resourceSource, externalId: z.string().min(1).max(200) }).parse(await body(req));
        work.bindResource(actor, item, value.source, value.externalId);
      } else if (post && view === 'project' && item && action === 'reference') {
        output = work.addReference(actor, item, referenceSchema.parse(await body(req)));
      } else if (post && view === 'project' && item && action === 'topic') {
        work.createTopic(actor, item, topicInputSchema.parse(await body(req)));
      } else if (post && view === 'agent' && item) work.setAgent(actor, item, z.object({ active: z.boolean() }).parse(await body(req)).active);
      else if (post && view === 'ticket' && !item) output = work.start(actor, settingsRoutes.start.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'answer') work.reply(actor, item, settingsRoutes.answer.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'stop') work.stop(actor, item);
      else if (post && view === 'ticket' && action === 'handoff')
        output = work.handoff(actor, item, z.object({ agent: id, reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'resume')
        output = work.resume(actor, item, z.object({ nonce, reason: prose, version: z.number().int().positive(),
          baseSha: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'revise')
        output = work.revise(actor, item, z.object({ revision: z.string().length(64), reason: prose,
          kind: z.enum(['rejected', 'continued']).optional() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'approve-development')
        work.approveDevelopment(actor, item, z.object({ offer: id.optional() }).strict().parse(await body(req)).offer);
      else if (post && view === 'ticket' && action === 'respond-development')
        output = work.respondDevelopment(actor, item, z.object({ offer: id, response: z.enum(['decline', 'return']), reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'reoffer-development')
        output = work.reofferDevelopment(actor, item, z.object({ offer: id, agent: id, reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'topic') work.setTopic(actor, item, z.object({ topic: id.optional() }).parse(await body(req)).topic);
      else if (post && view === 'ticket' && action === 'related') work.relateWork(actor, item, z.object({ ticket: id }).parse(await body(req)).ticket);
      else if (post && view === 'ticket' && action === 'branch') {
        const value = z.object({ url: githubUrl }).parse(await body(req));
        await work.linkBranch(actor, item, value.url);
      }
      else if (post && view === 'ticket' && action === 'delivery') {
        const value = z.object({ url: githubUrl }).parse(await body(req));
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
    const collaboration = await openCollaboration(config, auth, feishu && (async message => {
      const lark = (args: string[]) => command('lark-cli', ['--profile', feishu.profile, ...args, '--as', 'bot']);
      const userId = message.channel.address.userId;
      if (!userId) return sendFeishu({ commands: { lark } }, message);
      await lark(['im', '+messages-send', '--user-id', userId, '--text', message.text, '--idempotency-key', message.id]);
      return 'sent';
    }));
    work = collaboration;
    const processChannel = async (text: string, trigger: Trigger, sender: PlatformActor, origin: ChannelRef, project?: string, topic?: string,
      revision?: string) => {
      const action = channelCommand(text);
      if (!action) return;
      if (action.kind === 'proof') {
        collaboration.proveAccount(action.code, sender, trigger.url);
        return;
      }
      const actor = collaboration.channelMember(sender, trigger.at);
      if (!actor) return;
      if (action.kind === 'answer') {
        collaboration.answerDecision(actor, action.id, action.response, trigger);
        return;
      }
      if (!project || collaboration.channelEventSeen(trigger.id)) return;
      let reference: ChannelRef | string | null | undefined;
      if (action.reference) {
        if (/^[0-9a-f]{32}$/.test(action.reference)) reference = action.reference;
        else if (sender.provider === 'github' && action.reference === origin.url) reference = origin;
        else {
          try {
            const scope = collaboration.githubRouteScope(project, actor);
            const match = await githubReference(action.reference, scope.map(item => item.repository));
            const repository = match && new URL(match.url!).pathname.split('/').slice(1, 3).join('/').toLowerCase();
            const target = scope.find(item => item.repository.toLowerCase() === repository);
            reference = match && target ? { ...match, project: target.project } : null;
          }
          catch { reference = null; }
        }
      }
      const parent = sender.provider === 'feishu' && trigger.meta.parentId;
      collaboration.receiveChannel({ project, origin, sender, trigger, agent: action.agent, request: action.request, topic, revision,
        parentMessage: typeof parent === 'string' ? messageRef(feishuTriggerId(parent)) : undefined }, reference);
      if (sender.provider === 'feishu' && feishu) collaboration.rememberDiscussion(discussionInput(trigger, feishu.appId));
    };

    const stopGithub = config.crossChannel && watchGithub({
      repositories: () => collaboration.githubRepositories(),
      tracksPull: collaboration.tracksPull,
      seen: collaboration.channelEventSeen,
      interval: config.crossChannel.githubPollSeconds,
      checkpoint: collaboration.githubCheckpoint,
      refresh: collaboration.refreshGithubEvidence,
      log: message => console.error(message),
      async consume(input) {
        const project = collaboration.githubProject(input.repository.name, input.origin);
        if (!project) return;
        if (input.evidence === 'pull') {
          if (collaboration.channelTicket(input.origin)) await collaboration.refreshDelivery(input.origin, project.id);
        } else if (input.evidence === 'issue') {
          if (collaboration.channelTicket(input.origin)) await collaboration.refreshIssue(input.origin, input.repository.name, project);
        } else if (input.note) {
          collaboration.receiveNote({ project: project.id, origin: input.origin, sender: input.sender,
            trigger: input.trigger, agent: '', request: input.text, revision: input.revision });
        } else {
          const topic = project.resources.find(ref => ref.source === 'github' && ref.externalId.toLowerCase() === input.repository.name.toLowerCase())?.topic;
          await processChannel(input.text, input.trigger, input.sender, input.origin, project.id, topic, input.revision);
        }
      },
    });
    available = true;
    console.log('SuitMe 工作台 http://127.0.0.1:' + config.port);
    let closing = false;
    if (feishu) {
      feishuWatch = watchFeishu(feishu.profile, line => {
        try {
          const event = JSON.parse(line);
          if (event.sender_type !== 'user' || (event.message_type && event.message_type !== 'text')) return;
          const content = typeof event.content === 'string' ? event.content : '';
          if (content.length > 16000) return;
          const mentions: { id: string; key?: string; name?: string }[] = Array.isArray(event.mentions) ? event.mentions : [];
          const normalized = { ...event, root_id: event.root_id || undefined, parent_id: event.parent_id || event.reply_to || undefined, content };
          const trigger = feishuTrigger(normalized, feishu.botId, feishu.appId) as Trigger | undefined;
          if (!trigger?.human) return;
          const project = collaboration.boundProject('feishu', String(trigger.meta.chatId));
          const mention = mentions.find(m => m.id === feishu.botId || m.id === feishu.appId);
          const text = feishuCommandText(content, mention);
          const input = discussionInput(trigger, feishu.appId);
          const { sender, origin } = input;
          const chat = String(trigger.meta.chatId);
          const action = config.crossChannel && channelCommand(text);
          if (action && ((['proof', 'answer'].includes(action.kind) && trigger.meta.direct) || (action.kind === 'work' && trigger.addressed && project))) {
            void processChannel(text, trigger, sender, origin, project?.id,
              project?.resources.find(ref => ref.source === 'feishu' && ref.externalId === chat)?.topic)
              .catch(error => console.error('飞书协作未受理：', (error as Error).name));
            return;
          }
          if (config.crossChannel && action) return;
          if (!trigger.addressed && !text.startsWith('/')) collaboration.rememberDiscussion(input);
          const boundMember = config.crossChannel && collaboration.channelMember(sender, trigger.at);
          const matches = auth.listAccounts().filter(a => !a.disabled && (config.crossChannel
            ? a.username === boundMember : a.feishuOpenId === trigger.actor.id));
          const actor = matches.length === 1 && matches[0];
          if (!actor || !project) return;
          const request = !config.crossChannel && /^\/协作\s+([a-z][a-z0-9-]*)\s+([\s\S]+)$/.exec(text);
          const answer = /^\/答\s+([\s\S]+)$/.exec(text);
          if (request && trigger.addressed && !trigger.meta.rootId) {
            const value = prose.parse(request[2]);
            collaboration.start(actor.username, { project: project.id, agent: request[1], material: [], title: value.slice(0, 100),
              request: value, nonce: trigger.id, priority: 'normal' }, trigger);
          } else if (answer && trigger.meta.rootId) {
            const thread = trigger.threads[0]!;
            const parent = trigger.meta.parentId ?? trigger.meta.rootId;
            const ticket = (config.crossChannel && ((typeof parent === 'string' && collaboration.channelTicket(messageRef(feishuTriggerId(parent))))
              || collaboration.channelTicket(origin)))
              || collaboration.rootThread(project.id, thread.source, thread.id);
            if (!ticket) return;
            const [question] = collaboration.detail(actor.username, ticket).questions;
            if (!question) return;
            const value = prose.parse(answer[1]);
            collaboration.reply(actor.username, ticket, { card: question.id, nonce: trigger.id,
              ...(/^\d+$/.test(value) ? { choice: Number(value) - 1 } : { text: value }) }, trigger);
          }
        } catch (error) { console.error('飞书事件未受理：', (error as Error).name); }
      }, message => console.info(message));
    }
    const close = () => {
      if (closing) return;
      closing = true;
      feishuWatch?.close();
      server.close();
      void Promise.resolve(stopGithub ? stopGithub() : undefined).then(() => collaboration.close()).catch(console.error);
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
