import { createServer, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Engine, key, runningAssignment, ticketStage, type Candidate, type Ticket, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { Policy, SourceScope } from '../../upstream/superagent/src/core/ports.ts';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';
import type { Result } from '../../upstream/autoloop/protocol/validate.ts';
import { root, runtime } from '../config.ts';
import { command } from '../commands.ts';
import { Github } from '../github.ts';
import { feishuTrigger, sendFeishu } from '../upstream.ts';
import type { Task } from '../store.ts';
import { openSuperAgentEffects, openSuperAgentStore } from '../superagent-ports.ts';
import { openAutoloop, taskRule, workerName, type ExecutionCard } from './autoloop.ts';
import { validateAcceptance } from '../delivery-acceptance.ts';
import { executorPrincipal, PilotKnowledge, sha256 } from './knowledge.ts';

const targetRepo = 'zhegong-996/desktop-tutorial';
const stateDir = process.env.COLLAB_STATE_DIR;
if (!stateDir || path.resolve(stateDir) !== runtime() || path.basename(stateDir) !== 'superagent-first-chain')
  throw new Error('需要独立的 COLLAB_STATE_DIR，目录名为 superagent-first-chain');
const pilot = z.object({
  repository: z.literal(targetRepo), checkout: z.string(), port: z.number().int().min(1024).max(65535),
  feishu: z.object({ profile: z.string().min(1), appId: z.string().startsWith('cli_'),
    botId: z.string().min(1), chat: z.string().startsWith('oc_'), requester: z.string().startsWith('ou_') }),
}).strict().parse(JSON.parse(await readFile(runtime('config.json'), 'utf8')));
const repoUri = 'https://github.com/' + targetRepo + '.git';
const checkoutOrigin = (await command('git', ['remote', 'get-url', 'origin'], pilot.checkout)).trim();
if (checkoutOrigin !== repoUri) throw new Error('试点 checkout 的 origin 与指定测试仓库不一致');

const outputPath = 'collab-pilot/index.html';
const config = {
  bridgePort: pilot.port, repository: targetRepo, checkout: pilot.checkout,
  allowedPaths: [outputPath, '.github/workflows/collab-pilot.yml'],
};
const github = new Github(config);
const cases = ['显示已确认的标题与演练声明', '点击试点按钮后显示预约待门店确认', '预览文件与 GitHub 交付提交一致'];
const sourceScope: SourceScope = { scope: input => input.source === 'feishu' && input.meta.chatId === pilot.feishu.chat
  ? { listened: true, observed: false } : { listened: false, reason: 'outsidePilot' } };
const policyUrl = pathToFileURL(path.join(root, 'upstream/superagent/src/policy.ts'));
const { SettingsSchema, settingsPolicy } = await import(policyUrl.href);
const settings = SettingsSchema.parse({ policy: { sources: { feishu: { allowed: [{ id: pilot.feishu.requester }] } } }, eval: { mode: 'observe' } });
const policy = (): Policy => settingsPolicy(settings, sourceScope);

interface DeliveryRecord {
  task: Task;
  blocked?: string;
  accepted?: { at: string; actor: string; commit: string; cases: string[] };
}


await mkdir(stateDir, { recursive: true, mode: 0o700 });
let healthy = false;
let stopping = false;
// Bind before opening the ledger to prevent a second writer on this host.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ engine: 'superagent', feishu: healthy, ready: healthy }));
  } else if (req.method === 'GET' && healthy) {
    void render(req.url ?? '/', res).catch(() => res.writeHead(500).end());
  }
  else res.writeHead(503).end();
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(pilot.port, '127.0.0.1', resolve);
});

const store = await openSuperAgentStore(runtime('orchestrator.sqlite'));
const effects = await openSuperAgentEffects(store);
const knowledge = new PilotKnowledge(store);
const hub = await openAutoloop(pilot.checkout);
store.db.exec(`
  CREATE TABLE IF NOT EXISTS pilot_delivery (ticket TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pilot_rounds (
    id INTEGER PRIMARY KEY, ticket TEXT NOT NULL, assignment TEXT NOT NULL,
    result TEXT NOT NULL, preview_pending INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pilot_actions (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS pilot_execution (run INTEGER PRIMARY KEY, assignment TEXT NOT NULL, manifest TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pilot_audit (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ticket TEXT, value TEXT NOT NULL);
`);
function audit(kind: string, ticket: string | null, detail: object = {}) {
  store.db.prepare('INSERT INTO pilot_audit(kind,ticket,value) VALUES (?,?,?)').run(kind, ticket, JSON.stringify(detail));
  console.log(JSON.stringify({ event: kind, ticket, ...detail }));
}
function journal(ticket: string): DeliveryRecord | undefined {
  const row = store.db.prepare('SELECT value FROM pilot_delivery WHERE ticket = ?').get(ticket);
  return row ? JSON.parse(String(row.value)) : undefined;
}
function saveJournal(ticket: string, value: DeliveryRecord) {
  store.db.prepare('INSERT INTO pilot_delivery VALUES (?, ?) ON CONFLICT(ticket) DO UPDATE SET value=excluded.value')
    .run(ticket, JSON.stringify(value));
}
function sameAssignment(ticketId: string, assignment: string) {
  const ticket = store.tickets.get(ticketId);
  return ticket && !ticket.ended && ticket.assignments.at(-1)?.id === assignment ? ticket : undefined;
}
function current(ticket: Ticket) {
  return policy().revalidate(ticket.mandate) && knowledge.readable(ticket.id) && !journal(ticket.id)?.blocked;
}
function firstMessage(ticket: Ticket) {
  const message = store.triggers.get(ticket.origin.triggerId);
  if (!message) throw new Error('工单缺少原始消息');
  return message;
}
function sameTaskAnswers(ticket: Ticket) {
  return ticket.inputs.flatMap(input => {
    if (input.kind !== 'trigger' || input.triggerId === ticket.origin.triggerId) return [];
    const text = store.triggers.get(input.triggerId)?.text;
    return text?.startsWith('/pilot-answer ' + ticket.id + ' ') ? [text.split(' ').at(-1)!] : [];
  });
}
function assertDeliveryBase(record: DeliveryRecord) {
  const base = JSON.parse(record.task.context).baseSha;
  return command('git', ['ls-remote', 'origin', 'refs/heads/main'], pilot.checkout).then(result => {
    if (JSON.parse(record.task.context).triggerSha !== base || result.trim().split(/\s+/)[0] !== base) throw new Error('测试仓库主分支已变化，请核对后再继续');
  });
}

const engine = new Engine({
  repo: store, policy, scope: sourceScope,
  assessor: { request(candidate) {
    effects.enqueue('assessment', candidate.evalId, { triggerId: candidate.triggers[0]!.id });
  } },
  prepareTicket(ticket) { knowledge.grant(ticket.id); return ticket; },
  executor: {
    start(ticket, assignment) {
      effects.enqueue('delivery', ticket.id, { ticketId: ticket.id, assignmentId: assignment.id });
    },
    deliver(ticket, assignment) {
      effects.enqueue('delivery', ticket.id, { ticketId: ticket.id, assignmentId: assignment.id });
    },
    stop(ticket) { effects.enqueue('delivery', ticket.id, { ticketId: ticket.id }); },
  },
  outbox: {
    send(message) { if (store.receipts.add(message)) effects.enqueue('reply', message.id, {}); },
    status: id => store.replyStatus(id),
    withdraw(id) { store.receipts.withdraw(id); },
  },
  emit: event => store.afterCommit(() => audit(event.type,
    'ticketId' in event.data ? event.data.ticketId : null, event.data)),
});

function assess(candidate: Candidate) {
  const trigger = candidate.triggers.find(t => t.text.startsWith('/pilot-superagent '));
  if (candidate.strength !== 'explicit' || !trigger || candidate.triggers.length !== 1)
    return { kind: 'ignore' as const, reason: '仅受理测试单聊中显式发起的迁移演练' };
  return {
    kind: 'accept' as const, title: '预约体验页迁移演练', scope: '只交付测试仓库的独立静态预约体验页',
    reason: '来自已绑定测试项目的本人显式请求', acknowledgement: '已接收预约体验页试点，待确认影响交付的要求时会在这里提问。',
  };
}
effects.handle('assessment', ({ triggerId }, evalId) => {
  const candidate = engine.candidate(triggerId);
  if (candidate?.evalId === evalId) engine.decide(triggerId, { ...assess(candidate), evalId });
  return Promise.resolve();
});
effects.handle('reply', async (_payload, id) => {
  const message = store.receipts.get(id);
  if (!message || store.replyStatus(id) !== 'pending') return;
  if (message.channel.source !== 'feishu' || message.channel.address.chatId !== pilot.feishu.chat)
    throw new Error('试点出站会话不匹配');
  const outcome = await sendFeishu({ commands: {
    lark: (args: string[]) => command('lark-cli', ['--profile', pilot.feishu.profile, ...args, '--as', 'bot']),
  } }, message);
  store.receipts.settle(message, outcome === 'sent' ? 'sent' : 'channelGone');
  audit('feishu.reply', message.ticketId ?? null, { outcome, kind: message.kind });
}, { ordered: true });

const titles = ['预约体验', '预约演示'] as const;
const instructions = {
  clarify: '先读 context.json。请在 Autoloop ask 回执中提出唯一一个“页面标题”的选择问题。两个选项依次为“预约体验”和“预约演示”，key 用 page-title。只澄清，不写文件。',
  edit: '先读 context.json 的 answers。只创建 collab-pilot/index.html。页面标题使用已确认的选项。使用完整中文 HTML 和内联样式与脚本。展示“仅供试点演练”，提供“提交演练预约”按钮，点击后显示“预约待门店确认”。不访问网络，不收集个人资料。',
};
function assembleJob(job: Job, ticket: Ticket, record: DeliveryRecord): Job {
  const source = knowledge.sourceForWorker(ticket.id);
  const clarified = sameTaskAnswers(ticket).length > 0 && (job.context.answers.length > 0 || job.context.decided.length > 0);
  const prompt = clarified ? instructions.edit : instructions.clarify;
  return { ...job,
    rule: { ...job.rule, cwd: record.task.workspace,
      prompt: prompt + '\n内部评审依据只供核对，不复制到交付文件。不提交、不推送、不自行发消息、合并、发布或验收。' },
    agent: { ...job.agent, access: clarified ? 'edit' : 'read' },
    context: { ...job.context, events: [...job.context.events, {
      id: source.revision, source: 'knowledge', sourceName: '任务资料', type: 'source',
      subject: ticket.id, summary: '版本验收依据', detail: source.text, link: '', receivedAt: ticket.createdAt,
    }] },
  };
}

effects.handle('delivery', async ({ ticketId, assignmentId }) => {
  if (!assignmentId) return;
  const ticket = sameAssignment(ticketId, assignmentId);
  if (!ticket || !current(ticket)) return;
  let record = journal(ticket.id);
  if (!record) {
    const prepared = await github.prepare(ticket.id);
    const opening = firstMessage(ticket);
    record = { task: { id: ticket.id, identifier: 'SA-' + ticket.id.slice(0, 8), kind: 'development',
      triggerId: opening.id, chatId: pilot.feishu.chat, messageId: String(opening.meta.messageId),
      senderId: pilot.feishu.requester, agent: 'codex', ...prepared, context: JSON.stringify({
        baseSha: prepared.baseSha, triggerSha: opening.meta.headSha, businessAcceptance: cases, allowedPaths: config.allowedPaths,
      }), generation: 1, phase: 'ready' } };
    saveJournal(ticket.id, record);
  }
  try { await assertDeliveryBase(record); } catch (error) { block(ticket, error); return; }
  const latest = sameAssignment(ticket.id, assignmentId);
  if (!latest || !current(latest)) return;
  const answer = sameTaskAnswers(latest).at(-1);
  if (!answer) {
    const message = firstMessage(latest);
    hub.ingest('suitme', { id: key('assignment', latest.id, assignmentId), type: 'ticket.assigned',
      subject: latest.id, summary: latest.title, detail: message.text });
  } else {
    const card = titleCard(latest.id, 'open');
    if (card) {
      const message = latest.inputs.findLast(input => input.kind === 'trigger' && input.triggerId !== latest.origin.triggerId);
      if (message?.kind !== 'trigger') throw new Error('缺少原工单的人类答复引用');
      const choice = (JSON.parse(card.options) as string[]).indexOf(answer);
      hub.answer(card.id, { choice, by: pilot.feishu.requester, ref: message.triggerId });
      engine.report(latest.id, { state: 'progress', summary: '已收到标题选择，接续执行', question: null });
      audit('autoloop.answer', latest.id, { card: card.id, trigger: message.triggerId });
    }
  }
  store.atomic(() => {
    if (!runningAssignment(latest)) engine.assignmentStarted(latest.id, assignmentId);
    engine.inputsDelivered(latest.id, assignmentId, latest.undelivered);
  });
}, { ordered: true });

function titleCard(ticket: string, state?: string) {
  return hub.one<ExecutionCard>(`SELECT id,title,text,options,state FROM cards
    WHERE rule=? AND lane=? AND kind='ask' AND key=? AND (?='' OR state=?) ORDER BY id DESC LIMIT 1`,
  [taskRule, ticket, 'thread:' + taskRule + ':' + ticket + ':page-title', state ?? '', state ?? '']);
}
function block(ticket: Ticket, error: unknown) {
  const record = journal(ticket.id);
  if (record) {
    record.blocked = error instanceof Error ? error.message : String(error);
    saveJournal(ticket.id, record);
  }
  if (!ticket.ended) engine.report(ticket.id, { state: 'blocked', summary: '需要核对版本或任务范围后再继续', question: null });
  audit('ticket.blocked', ticket.id, { reason: record?.blocked });
}
function binding(id: number) {
  const row = hub.one<{ lane: string }>('SELECT lane FROM runs WHERE id=?', [id]);
  const ticket = row && store.tickets.get(row.lane);
  const assignment = ticket?.assignments.at(-1);
  const recorded = store.db.prepare('SELECT assignment FROM pilot_execution WHERE run=?').get(id);
  if (recorded && assignment?.id !== recorded.assignment) return {};
  return { ticket, assignment };
}

function mirrorResult(id: number, result: Result) {
  const { ticket, assignment } = binding(id);
  if (!ticket || !assignment || ticket.ended || !current(ticket)) return;
  store.atomic(() => {
    const added = store.db.prepare('INSERT OR IGNORE INTO pilot_rounds (id,ticket,assignment,result) VALUES (?,?,?,?)')
      .run(id, ticket.id, assignment.id, JSON.stringify({ outcome: result.outcome, session: result.session, usage: result.usage,
        asks: result.ask?.length ?? 0 }));
    if (!added.changes) return;
    const card = titleCard(ticket.id, 'open');
    const unread = ticket.inputs.filter(input => input.kind === 'trigger' && input.deliveredTo === assignment.id && input.readAt === null);
    engine.inputsRead(ticket.id, unread.map(input => input.id));
    if (card) {
      if (JSON.stringify(JSON.parse(card.options)) !== JSON.stringify(titles)) {
        block(ticket, new Error('执行端返回的标题选项与验收范围不一致'));
      } else {
        const question = card.title + '\n' + card.text
          + '\n\n在原话题回复 `/pilot-answer ' + ticket.id + ' 预约体验` 或 `/pilot-answer ' + ticket.id + ' 预约演示`。';
        engine.report(ticket.id, { state: 'waiting', summary: '等待需求方确认页面标题', question, askedBy: ticket.origin.triggerId });
        engine.reply({ purpose: 'attention', ticketId: ticket.id, question, text: question });
      }
    } else if (result.outcome === 'done' && sameTaskAnswers(ticket).length) {
      store.db.prepare('UPDATE pilot_rounds SET preview_pending=1 WHERE id=?').run(id);
      engine.report(ticket.id, { state: 'progress', summary: '执行结束，待核对 GitHub 交付', question: null });
    } else {
      block(ticket, new Error('执行端未生成预约页或有效的澄清问题'));
    }
    engine.turnEnded(ticket.id, assignment.id);
    store.afterCommit(() => audit('autoloop.receipt', ticket.id, { id, assignment: assignment.id, outcome: result.outcome,
      session: result.session, card: card?.id, usage: result.usage }));
  });
}

const workerUrl = pathToFileURL(path.join(root, 'upstream/autoloop/worker/worker.ts'));
const { createWorker } = await import(workerUrl.href);
const worker = createWorker({ name: workerName, capacity: 1, wait: 0, log: console.log, hub: {
  async work(request: { claim: string; capacity?: boolean; running?: number[] }) {
    const running = request.running ?? [];
    hub.heartbeat(workerName, running);
    for (const id of running) {
      const { ticket } = binding(id);
      const lease = hub.one<{ state: string; cancel_at: string | null }>('SELECT state,cancel_at FROM runs WHERE id=?', [id]);
      if (lease?.state === 'claimed' && !lease.cancel_at && (!ticket || ticket.ended || !current(ticket))) hub.cancel(id);
    }
    const cancel = hub.cancels(workerName);
    if (cancel.length || stopping || request.capacity === false || running.length) return { cancel };
    const job = hub.claimNext(workerName, request.claim);
    if (!job) return {};
    const { ticket, assignment } = binding(job.run);
    const record = ticket && journal(ticket.id);
    if (!ticket || !assignment || !record || ticket.ended || !current(ticket)) {
      hub.finish(job.run, job.token, { outcome: 'cancelled', summary: '工单授权退出' });
      return {};
    }
    try { await assertDeliveryBase(record); } catch (error) {
      hub.finish(job.run, job.token, { outcome: 'cancelled', summary: '版本核对未通过' });
      block(ticket, error);
      return {};
    }
    const latest = sameAssignment(ticket.id, assignment.id);
    if (!latest || !current(latest)) {
      hub.finish(job.run, job.token, { outcome: 'cancelled', summary: '工单授权退出' });
      return {};
    }
    const assembled = assembleJob(job, latest, record);
    // Freeze the resolved request for this attempt without copying the source text into the business ledger.
    const manifest = {
      baseSha: JSON.parse(record.task.context).baseSha,
      promptHash: sha256(assembled.rule.prompt ?? ''),
      contextHash: sha256(JSON.stringify(assembled.context)),
      engine: assembled.agent.use,
      model: assembled.agent.model ?? null,
      access: assembled.agent.access,
      session: assembled.session,
    };
    store.db.prepare('INSERT INTO pilot_execution VALUES (?,?,?) ON CONFLICT(run) DO UPDATE SET manifest=excluded.manifest')
      .run(job.run, assignment.id, JSON.stringify(manifest));
    audit('autoloop.start', ticket.id, { run: job.run, assignment: assignment.id, resumed: !!job.session });
    return { job: assembled };
  },
  async started(id: number, token: string, info: { session?: string }) {
    const ack = hub.started(id, token, info);
    audit('codex.session', binding(id).ticket?.id ?? null, { run: id, session: info.session });
    return ack;
  },
  async result(id: number, token: string, result: Result) {
    const { ticket } = binding(id);
    const valid = ticket && !ticket.ended && current(ticket);
    // A revoked or superseded run can settle its own lease, without publishing its outputs.
    const receipt: Result = valid ? result : { outcome: 'cancelled', summary: '工单已停止或授权已退出' };
    const ack = hub.finish(id, token, receipt);
    // Native Autoloop owns transient failure retry, cancellation, and receipt deduplication.
    if (valid && (result.outcome === 'done' || result.outcome === 'nothing')) mirrorResult(id, result);
    else if (valid && result.outcome === 'failed') {
      const run = hub.one<{ state: string; attempts: number }>('SELECT state,attempts FROM runs WHERE id=?', [id]);
      if (!ack.duplicate) audit('autoloop.failure', ticket.id, { run: id, state: run?.state, attempts: run?.attempts });
      if (run?.state === 'cancelled') engine.report(ticket.id, { state: 'failed', summary: '执行端已结束自动重试', question: null });
    }
    return ack;
  },
} });

async function publishReady() {
  const pending = store.db.prepare('SELECT id,ticket,assignment FROM pilot_rounds WHERE preview_pending=1 ORDER BY id LIMIT 1').get();
  if (!pending) return;
  const ticket = sameAssignment(String(pending.ticket), String(pending.assignment));
  if (!ticket || !current(ticket)) {
    store.db.prepare('UPDATE pilot_rounds SET preview_pending=0 WHERE id=?').run(pending.id!);
    return;
  }
  const record = journal(ticket.id)!;
  try { await assertDeliveryBase(record); }
  catch (error) { block(ticket, error); return; }
  if (!current(ticket)) return;
  if (!record.task.delivery) {
    const dir = path.join(record.task.workspace, 'collab-pilot');
    const webpage = path.join(dir, 'index.html');
    if (!(await lstat(dir)).isDirectory() || !(await lstat(webpage)).isFile()) {
      block(ticket, new Error('交付路径必须是常规目录与文件'));
      return;
    }
    const html = await readFile(webpage, 'utf8');
    const selected = sameTaskAnswers(ticket).at(-1);
    if (!selected || !html.includes(selected) || !html.includes('仅供试点演练') || html.includes('试点内部评审依据')) {
      block(ticket, new Error('交付文件与标题、演练提示或资料范围不一致'));
      return;
    }
    if (!current(ticket)) return;
    record.task.delivery = await github.publish(record.task);
    saveJournal(ticket.id, record);
    audit('github.pr', ticket.id, { pr: record.task.delivery.url, sha: record.task.delivery.headSha });
    return;
  }
  const checked = await github.inspect(record.task.delivery.pr);
  if (checked.headSha !== record.task.delivery.headSha || checked.ci === 'failed' || checked.merged) {
    block(ticket, new Error('PR 版本、CI 或合并状态已变化'));
    return;
  }
  if (checked.ci !== 'passed') return;
  const proof = await github.preview({ ...record.task, delivery: checked });
  if (!current(ticket)) return;
  store.atomic(() => {
    record.task.delivery = proof;
    saveJournal(ticket.id, record);
    store.db.prepare('UPDATE pilot_rounds SET preview_pending=0 WHERE id=?').run(pending.id!);
    engine.report(ticket.id, { state: 'ready', summary: 'PR 同版本预览已就绪，待发起人按版本验收' });
    engine.reply({ purpose: 'result', ticketId: ticket.id,
      text: '已交付预约演练页，等待你验收。\n\nPR ' + proof.url + '\n\n提交 `' + proof.headSha + '`\n\n核对：' + cases.join('、')
        + '。确认后在原话题回复 `/pilot-accept ' + ticket.id + ' ' + proof.headSha + '`。' });
    audit('github.preview', ticket.id, { sha: proof.deployedSha, ci: proof.ci, run: proof.artifactRunId });
  });
}

function replyAction(trigger: Trigger, ticket: Ticket, action: string, text: string) {
  const message = { id: key('pilot-action', trigger.id, action), channel: trigger.channel!, text, kind: 'notice' as const, ticketId: ticket.id };
  if (store.receipts.add(message)) effects.enqueue('reply', message.id, {});
}

const incoming = z.object({
  message_id: z.string(), chat_id: z.string(), chat_type: z.string(), sender_id: z.string(), sender_type: z.string(),
  content: z.string().max(4000), create_time: z.string(), message_type: z.string().optional(),
  root_id: z.string().optional(), thread_id: z.string().optional(), reply_to: z.string().optional(),
  parent_id: z.string().optional(),
});
async function onEvent(line: string) {
  const parsed = incoming.safeParse(JSON.parse(line));
  if (!parsed.success) return;
  const event = parsed.data;
  if (event.chat_id !== pilot.feishu.chat || event.chat_type !== 'p2p' || event.sender_id !== pilot.feishu.requester
    || event.sender_type !== 'user' || (event.message_type && event.message_type !== 'text')) return;
  const trigger = feishuTrigger({ ...event, parent_id: event.parent_id ?? event.reply_to }, pilot.feishu.botId, pilot.feishu.appId) as Trigger | undefined;
  if (!trigger?.human || !trigger.addressed || !trigger.channel) return;
  if (trigger.text.startsWith('/pilot-superagent ')) {
    if (store.tickets.list().length || store.triggers.get(trigger.id)) return;
    const sha = (await command('git', ['ls-remote', 'origin', 'refs/heads/main'], pilot.checkout)).trim().split(/\s+/)[0];
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('无法确认开工版本');
    engine.receive({ ...trigger, meta: { ...trigger.meta, headSha: sha } });
    engine.evaluateDue();
    return;
  }
  const match = /^\/pilot-(answer|accept|adopt|revoke) ([a-f0-9]{32})(?: (\S+))?$/.exec(trigger.text.trim());
  if (!match) return;
  const [, action, id, argument] = match;
  const ticket = store.tickets.get(id!);
  if (!ticket || firstMessage(ticket).actor.id !== trigger.actor.id) return;
  if (action === 'answer') {
    if (ticket.ended || !ticket.attention || !current(ticket) || !titles.some(choice => choice === argument)) return;
    if (event.root_id && event.root_id !== firstMessage(ticket).meta.messageId) return;
    engine.receive({ ...trigger, threads: firstMessage(ticket).threads });
    engine.evaluateDue();
    return;
  }
  if (store.db.prepare('SELECT 1 FROM pilot_actions WHERE id=?').get(trigger.id)) return;
  const record = journal(ticket.id);
  const delivery = record?.task.delivery;
  if (!record || !delivery || (event.root_id && firstMessage(ticket).meta.messageId !== event.root_id)) return;
  if (action === 'accept' && !record.accepted) {
    if (argument !== delivery.headSha || !delivery.deployedSha) {
      replyAction(trigger, ticket, action, '请核对并使用当前已生成预览的完整提交号。');
      return;
    }
    const remote = await github.inspect(delivery.pr);
    if (remote.headSha !== argument || remote.ci !== 'passed' || remote.merged)
      throw new Error('验收时 GitHub 版本或状态已变化');
    validateAcceptance(record.task, argument, cases.map(name => ({ name, passed: true })));
    store.atomic(() => {
      const fresh = journal(ticket.id)!;
      if (fresh.accepted) return;
      const candidate = knowledge.candidate(ticket.id, trigger.actor.id, argument, delivery.url,
        sameTaskAnswers(ticket).at(-1)!, trigger.id);
      fresh.accepted = { actor: trigger.actor.id, at: trigger.at, commit: argument, cases };
      saveJournal(ticket.id, fresh);
      store.db.prepare('INSERT INTO pilot_actions VALUES (?)').run(trigger.id);
      replyAction(trigger, ticket, action,
        '已按版本记录验收。项目知识候选「' + candidate.document.title + '」\n\n'
        + candidate.document.body + '\n\n适用范围：' + candidate.document.appliesTo
        + '\n\n来源：' + delivery.url + '\n\n回复 `/pilot-adopt ' + ticket.id + ' ' + candidate.revision + '` 采用。');
      audit('acceptance.recorded', ticket.id, { sha: argument, cases: cases.length, trigger: trigger.id, candidate: candidate.revision });
    });
    return;
  }
  if (!record.accepted) return;
  store.atomic(() => {
    if (action === 'adopt' && argument) {
      knowledge.adopt(ticket.id, argument, trigger.actor.id);
      const hits = knowledge.recall(ticket.id, executorPrincipal, trigger.actor.id).length;
      if (!hits) throw new Error('采用后未在当前授权执行身份下召回');
      replyAction(trigger, ticket, action,
        '已采用当前版本，试点执行身份可检索。回复 `/pilot-revoke ' + ticket.id + '` 撤回该工单临时访问。');
      audit('knowledge.adopted', ticket.id, { revision: argument, hits, trigger: trigger.id });
    } else if (action === 'revoke' && !argument) {
      const before = knowledge.recall(ticket.id, executorPrincipal, trigger.actor.id).length;
      knowledge.revoke(ticket.id, trigger.actor.id);
      const hits = knowledge.recall(ticket.id, executorPrincipal, trigger.actor.id).length;
      const source = knowledge.readable(ticket.id);
      if (hits || source) throw new Error('撤权后仍能读取任务资料或派生知识');
      replyAction(trigger, ticket, action, '已撤回本试点的执行身份访问。资料与派生知识已无法由该身份取回。');
      let sourceBlocked = false;
      try { knowledge.sourceForWorker(ticket.id); } catch { sourceBlocked = true; }
      if (!sourceBlocked) throw new Error('读取入口未拒绝已撤权执行身份');
      audit('knowledge.revoked', ticket.id, { before, after: hits, sourceReadable: source, trigger: trigger.id });
    } else return;
    store.db.prepare('INSERT INTO pilot_actions VALUES (?)').run(trigger.id);
  });
}

function publicTickets() {
  return store.tickets.list().map(ticket => {
    const record = journal(ticket.id);
    const candidate = knowledge.getCandidate(ticket.id);
    const owner = pilot.feishu.requester;
    const rounds = store.db.prepare('SELECT id,result FROM pilot_rounds WHERE ticket=? ORDER BY id').all(ticket.id);
    return { id: ticket.id, title: ticket.title, stage: ticketStage(ticket), assignments: ticket.assignments.length,
      question: ticket.attention?.question, selectedTitle: sameTaskAnswers(ticket).at(-1),
      rounds: rounds.map(r => ({ id: r.id, ...JSON.parse(String(r.result)) })),
      baseSha: record && JSON.parse(record.task.context).baseSha, delivery: record?.task.delivery,
      accepted: record?.accepted && { commit: record.accepted.commit, cases: record.accepted.cases, at: record.accepted.at },
      blocked: !!record?.blocked, knowledge: { candidate: candidate?.revision,
        ownerHits: knowledge.recall(ticket.id, owner, owner).length,
        workerHits: knowledge.recall(ticket.id, executorPrincipal, owner).length,
        workerSource: knowledge.readable(ticket.id) } };
  });
}
async function render(url: string, res: ServerResponse) {
  res.setHeader('cache-control', 'no-store');
  if (url === '/' || url === '/tickets') {
    if (!healthy) { res.writeHead(503).end(); return; }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ product: 'SuitMe 协作台', tickets: publicTickets() }, null, 2));
    return;
  }
  const match = /^\/preview\/([a-f0-9]{32})\/([a-f0-9]{40})\/(index\.html|version\.json)$/.exec(url);
  if (match) {
    const [, ticket, sha, filename] = match;
    const delivery = journal(ticket!)?.task.delivery;
    if (delivery?.deployedSha === sha) {
      const content = await readFile(runtime('previews', ticket!, sha!, filename!)).catch(() => undefined);
      if (content) {
        res.setHeader('content-type', filename === 'index.html' ? 'text/html; charset=utf-8' : 'application/json');
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'");
        res.end(content);
        return;
      }
    }
  }
  res.writeHead(404).end();
}

const consumer = spawn('lark-cli', ['--profile', pilot.feishu.profile, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const diagnostic = createInterface({ input: consumer.stderr });
diagnostic.on('line', line => {
  if (/\[event\] ready\b/.test(line)) {
    healthy = true;
    audit('feishu.ready', null);
  }
});
let intake = Promise.resolve();
createInterface({ input: consumer.stdout }).on('line', line => {
  intake = intake.then(() => onEvent(line)).catch(error => console.error('Feishu intake:', String(error)));
});
consumer.on('error', error => { healthy = false; console.error('Feishu consumer:', error.message); });
consumer.on('exit', code => {
  healthy = false;
  if (!stopping) {
    console.error('Feishu consumer exited', code);
    void stop();
  }
});

effects.start();
let executing = Promise.resolve();
let publishing = Promise.resolve();
let workerBusy = false;
let deliveryBusy = false;
const workTimer = setInterval(() => {
  if (stopping || workerBusy || !healthy) return;
  workerBusy = true;
  executing = Promise.resolve().then(() => { hub.tick(); effects.kick(); engine.evaluateDue(); return worker.tick(); })
    .catch(error => console.error('Execution:', String(error))).finally(() => { workerBusy = false; });
}, 500);
const publishTimer = setInterval(() => {
  if (stopping || deliveryBusy || !healthy) return;
  deliveryBusy = true;
  publishing = publishReady().catch(error => console.error('Delivery:', String(error)))
    .finally(() => { deliveryBusy = false; });
}, 8000);

async function stop() {
  if (stopping) return;
  stopping = true;
  healthy = false;
  clearInterval(workTimer);
  clearInterval(publishTimer);
  consumer.kill('SIGTERM');
  server.close();
  await Promise.allSettled([intake, executing, publishing, effects.drain()]);
  hub.db.close();
  store.close();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
