import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { feishuTrigger, feishuTriggerId } from '../upstream.ts';
import type { ConsoleAuth } from '../console-auth.ts';
import { channelCommand, feishuCommandText, feishuConsultation, messageRef, type ChannelRef, type PlatformActor } from './channel-links.ts';
import type { Collaboration } from './collaboration.ts';
import { WorkbenchError } from './errors.ts';
import type { Settings } from './config.ts';
import { discussionInput } from './discussion-intake.ts';
import { readCardClick } from './feishu-cards.ts';
import { watchFeishu } from './feishu-events.ts';
import { openFeishuInbox, pullFeishuInbox } from './feishu-inbox.ts';
import { channelInbox, drainChannelInbox, openChannelJournal } from './channel-journal.ts';
import { feishuIngressCard, feishuIngressMessage, feishuIngressText } from './feishu-ingress-envelope.ts';
import { githubReference, watchGithub, type GitHubConnection } from './github-intake.ts';
import { startOctopIM } from './octop-im.ts';
import { octopIMEvent, type OctopIMTransport } from './octop-im-contract.ts';

type ChannelIntake = Pick<Collaboration,
  'receiveOctopIM' | 'activationIdentityAvailable' | 'activation' | 'proveAccount' | 'channelMember' | 'answerDecision'
  | 'channelEventSeen' | 'githubRouteScope' | 'receiveChannel' | 'rememberDiscussion' | 'githubRepositories'
  | 'tracksPull' | 'githubCheckpoint' | 'refreshGithubEvidence' | 'githubProject' | 'channelTicket'
  | 'refreshDelivery' | 'refreshIssue' | 'receiveNote' | 'refreshFeishuHistory' | 'recoveredFeishuEvent'
  | 'trackFeishuThread' | 'observeFeishuTopic' | 'feishuProject' | 'feishuTopic' | 'receiveFeishuConsultation' | 'receiveFeishuReply'
  | 'start' | 'isFeishuTopicRoot' | 'rootThread' | 'detail' | 'reply' | 'clickFeishuCard'>;
type IdentityProofs = {
  verifyActivation?: (sender: PlatformActor) => Promise<string | undefined>;
  verifyRecovery: (code: string, sender: PlatformActor, at: string, direct: boolean) => void;
};

const prose = z.string().trim().min(1).max(3500);
const channelProviders = { watchFeishu, openFeishuInbox, pullFeishuInbox, watchGithub, startOctopIM };

/** Channel delivery and normalization. Ticket assignment, access and audit stay with the workflow. */
export async function openIntake(config: Pick<Settings, 'feishu' | 'crossChannel' | 'octop'>,
  collaboration: ChannelIntake, auth: Pick<ConsoleAuth, 'listAccounts'>, proofs: IdentityProofs, providers = channelProviders) {
  const { feishu } = config;
  const { verifyActivation, verifyRecovery } = proofs;
  let feishuWatch: ReturnType<typeof watchFeishu> | undefined;
  let cardWatch: ReturnType<typeof watchFeishu> | undefined;
  let feishuIngress: ReturnType<typeof pullFeishuInbox> | undefined;
  let githubWatch: ReturnType<typeof watchGithub> | undefined;
  let historyTimer: NodeJS.Timeout | undefined;
  let closing = false;
  const retryable = (error: unknown) => !(error instanceof SyntaxError || error instanceof z.ZodError
    || error instanceof WorkbenchError && error.status < 500 && ![408, 429].includes(error.status));
  const log = (error: unknown) => console.error('渠道事件暂未处理：', (error as Error).name);
  let octopIM: Awaited<ReturnType<typeof startOctopIM>>;
  let inline: { inbox: ReturnType<typeof openFeishuInbox>; owner: string; pulse?: NodeJS.Timeout } | undefined;
  const otherInboxes: { id: string; drain: ReturnType<typeof drainChannelInbox<'message'>> }[] = [];
  let historyRead: Promise<void> | undefined;
  async function close() {
    if (closing) return;
    closing = true;
    if (historyTimer) clearInterval(historyTimer);
    if (inline?.pulse) clearInterval(inline.pulse);
    await Promise.allSettled([octopIM?.close(), githubWatch?.close(), feishuWatch?.close(), cardWatch?.close(), historyRead]);
    if (inline) inline.inbox.release(inline.owner);
    await Promise.allSettled([feishuIngress?.close(), ...otherInboxes.map(row => row.drain.close())]);
  }
  try {
    for (const connector of config.octop?.channels ?? []) {
      const inbox = channelInbox<'message'>(openChannelJournal(), 'octop:' + connector.id);
      otherInboxes.push({ id: connector.id, drain: drainChannelInbox(inbox, { retryable, log,
        async deliver(_kind, line) {
          const event = octopIMEvent.parse(JSON.parse(line));
          if (event.address.connector !== connector.id || event.address.kind !== connector.kind) return;
          await collaboration.receiveOctopIM(event);
        } }) });
    }
    octopIM = await providers.startOctopIM(config.octop);
    const processChannel = async (text: string, trigger: Trigger, sender: PlatformActor, origin: ChannelRef, project?: string, topic?: string,
      revision?: string) => {
      const action = channelCommand(text);
      if (!action) return;
      if (action.kind === 'activation') {
        if (!verifyActivation || !feishu || trigger.meta.direct !== true || sender.namespace !== feishu.appId
          || !collaboration.activationIdentityAvailable(sender) || !collaboration.activation.awaiting(action.code, sender, trigger.at)) return;
        const label = await verifyActivation(sender);
        if (label && collaboration.activationIdentityAvailable(sender))
          collaboration.activation.verify(action.code, { ...sender, label }, trigger.at);
        return;
      }
      if (action.kind === 'recovery') {
        if (sender.namespace === feishu?.appId)
          verifyRecovery(action.code, sender, trigger.at, trigger.meta.direct === true);
        return;
      }
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

    if (config.crossChannel) githubWatch = providers.watchGithub({
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
    let historyRequested = false;
    const refreshHistory = () => {
      if (closing) return;
      if (historyRead) { historyRequested = true; return; }
      historyRead = collaboration.refreshFeishuHistory()
        .catch(error => { if (!closing) console.error('飞书历史补读未完成：', (error as Error).name); })
        .finally(() => {
          historyRead = undefined;
          if (historyRequested) {
            historyRequested = false;
            refreshHistory();
          }
        });
    };
    if (feishu) {
      historyTimer = setInterval(refreshHistory, 60_000);
      historyTimer.unref();
    }
    if (feishu) {
      const receiveMessage = async (line: string) => {
        const event = JSON.parse(line);
        if (event.sender_type !== 'user' || typeof event.content !== 'string' || event.content.length > 16000) return;
        const content = feishuIngressText(event.content, event.message_type);
        if (!content?.trim()) return;
        const mentions: { id: string; key?: string; name?: string }[] = Array.isArray(event.mentions) ? event.mentions : [];
        const normalized = { ...event, root_id: event.root_id || undefined, parent_id: event.parent_id || event.reply_to || undefined,
          thread_id: event.thread_id || undefined, content };
        const trigger = feishuTrigger(normalized, feishu.botId, feishu.appId) as Trigger | undefined;
        if (!trigger?.human) return;
        collaboration.observeFeishuTopic(trigger);
        if (collaboration.recoveredFeishuEvent(trigger.id)) return;
        collaboration.trackFeishuThread(trigger);
        const mention = mentions.find(m => m.id === feishu.botId || m.id === feishu.appId);
        const text = feishuCommandText(content, mention);
        const updatedAt = Number(event.update_time);
        const input = { ...discussionInput(trigger, feishu.appId), ...(Number.isSafeInteger(updatedAt) && updatedAt > 0 && { updatedAt }) };
        const { sender, origin } = input;
        const chat = String(trigger.meta.chatId);
        const root = trigger.meta.rootId ?? trigger.meta.threadId ?? trigger.meta.messageId;
        const project = collaboration.feishuProject(chat, root);
        const topic = project && collaboration.feishuTopic(project, chat, root);
        if (trigger.channel && typeof root === 'string') trigger.channel.address.topicRoot = root;
        const question = feishuConsultation(text);
        if (question && project && !trigger.meta.direct) {
          await collaboration.receiveFeishuConsultation(project, trigger, question);
          return;
        }
        const action = config.crossChannel && channelCommand(text);
        if (action && ((['proof', 'answer', 'recovery', 'activation'].includes(action.kind) && trigger.meta.direct) || (action.kind === 'work' && trigger.addressed && project))) {
          await processChannel(text, trigger, sender, origin, project?.id, topic);
          return;
        }
        if (config.crossChannel && action) return;
        if (!text.startsWith('/') && project && collaboration.receiveFeishuReply(input, project.id)) return;
        if (config.crossChannel && project && trigger.addressed && !text.startsWith('/') && text.trim()) {
          const directAgent = /^@([a-z][a-z0-9-]{0,47})\s+([\s\S]+)$/.exec(text);
          const wanted = directAgent?.[1] ?? 'auto';
          const request = directAgent?.[2] ?? text;
          if (request.length <= 3500) await processChannel('/协作 ' + wanted + ' ' + request, trigger, sender, origin, project.id, topic);
          return;
        }
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
          const anchored = collaboration.isFeishuTopicRoot(project, chat, root);
          const ticket = (config.crossChannel && typeof parent === 'string' && !collaboration.isFeishuTopicRoot(project, chat, parent)
            && collaboration.channelTicket(messageRef(feishuTriggerId(parent)))) || (!anchored && (
              (config.crossChannel && collaboration.channelTicket(origin)) || collaboration.rootThread(project.id, thread.source, thread.id)));
          if (!ticket) return;
          const [question] = collaboration.detail(actor.username, ticket).questions;
          if (!question) return;
          const value = prose.parse(answer[1]);
          collaboration.reply(actor.username, ticket, { card: question.id, nonce: trigger.id,
            ...(/^\d+$/.test(value) ? { choice: Number(value) - 1 } : { text: value }) }, trigger);
        }
      };
      const receiveCard = async (line: string) => { await collaboration.clickFeishuCard(readCardClick(line)); };
      const inbox = providers.openFeishuInbox(feishu.appId);
      feishuIngress = providers.pullFeishuInbox(inbox, { message: receiveMessage, card: receiveCard, ready: refreshHistory, retryable, log });
      if (!feishu.separateIngress) {
        const owner = 'workbench:' + randomUUID();
        if (!inbox.claim(owner, Date.now())) throw new Error('该飞书应用已有入口连接。');
        inline = { inbox, owner };
        const pulse = () => {
          if (!closing && feishuWatch) inbox.pulse(owner, Date.now(), { messages: feishuWatch.status(), cards: cardWatch?.status() });
        };
        if (feishu.decisionCards) cardWatch = providers.watchFeishu(feishu.profile, line => {
          if (closing) return;
          try {
            const item = feishuIngressCard(line);
            if (item) inbox.put(owner, 'card', item.lane, line, Date.now(), item.id);
            feishuIngress?.poll();
          } catch (error) { if (retryable(error)) log(error); }
        }, message => console.error('飞书卡片：', message), { event: 'card.action.trigger', onReady: pulse });
        feishuWatch = providers.watchFeishu(feishu.profile, line => {
          if (closing) return;
          try {
            const item = feishuIngressMessage(line);
            if (item && (item.event.chat_type === 'p2p' || feishu.allowedGroups?.includes(item.event.chat_id) || collaboration.feishuProject(item.event.chat_id,
              item.event.root_id || item.event.thread_id || item.event.message_id))) inbox.put(owner, 'message', item.lane, line, Date.now(), item.id);
            feishuIngress?.poll();
          } catch (error) { if (retryable(error)) log(error); }
        }, console.info, { onReady: pulse });
        inline.pulse = setInterval(() => { try { pulse(); } catch (error) { log(error); } }, 2000);
        inline.pulse.unref();
        pulse();
      }
    }
    return {
      octopConnected: (connector: string) => octopIM?.connected(connector) === true,
      octopReady: (address: Parameters<OctopIMTransport['ready']>[0]) => octopIM?.transport.ready(address) === true,
      async sendOctop(...args: Parameters<OctopIMTransport['send']>) {
        if (!octopIM) throw new Error('Octop IM 连接未就绪');
        return octopIM.transport.send(...args);
      },
      messages: () => feishuIngress?.messages() ?? feishuWatch?.status(),
      cards: () => feishuIngress?.cards() ?? cardWatch?.status(),
      backlog: () => feishuIngress?.backlog(),
      imStatus: () => otherInboxes.map(({ id, drain }) => ({ id, ready: octopIM?.connected(id) === true, inbox: drain.backlog() })),
      github(repositories?: string[]): GitHubConnection[] {
        return githubWatch?.status(repositories) ?? (repositories ?? []).map(repository => ({ repository, state: 'disabled' }));
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
