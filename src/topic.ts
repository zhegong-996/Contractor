/**
 * 主题（topic）：把散在多个群、多个任务里的事，归到一个有责任人的聚合单位下。
 *
 * 出处：千问办公的「关联多个群 + 跨群对齐」，以及天猫技术那篇的
 * 业务单元 → 主题 → 频道 → 工作项 结构。我们此前只有 task，跨任务没有落点，
 * 「这件事现在到哪一步了」只能靠人翻聊天记录。
 *
 * 一条硬约束（比照抄更重要）：
 *   只有「有责任人」的频道和任务才能进主题。
 * 聚合做过头就会变成「什么都能挂，但没人说得清谁负责」——那正好把
 * 我们唯一比千问强的地方（判定谁有资格、什么算验收）给丢了。
 *
 * 边界：主题只做聚合与陈述，不参与派单、不参与验收判定、不改任务状态。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';

export const TOPIC_STATUSES = ['active', 'paused', 'closed'] as const;
export type TopicStatus = typeof TOPIC_STATUSES[number];
export const CHANNEL_KINDS = ['im', 'board', 'meeting'] as const;
export type ChannelKind = typeof CHANNEL_KINDS[number];

export interface TopicChannel {
  id: string;
  kind: ChannelKind;
  /** 群 id / 协作板 id / 会议 id，外部系统的稳定标识。 */
  ref: string;
  /** 这个入口的负责人。没有责任人的入口不进主题。 */
  ownerUserId: string;
  addedAt: string;
  addedBy: string;
}

export interface TopicTask {
  taskId: string;
  /** 主职能，和职能注册表同一套 id。 */
  roleId: string;
  ownerUserId: string;
  addedAt: string;
  addedBy: string;
}

export interface Topic {
  schemaVersion: 1;
  id: string;
  title: string;
  /** 这个主题要达成什么。空目标的主题等于一个聊天分组，没有意义。 */
  goal: string;
  ownerUserId: string;
  status: TopicStatus;
  channels: TopicChannel[];
  tasks: TopicTask[];
  createdAt: string;
  updatedAt: string;
}

export const topicDir = () => path.join(runtime('v06'), 'topics');

const shortId = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 10);
const requireText = (value: unknown, field: string): string => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field}不能为空：主题里的每一项都要能追到人`);
  return text;
};

function writeTopic(dir: string, topic: Topic): Topic {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, `${topic.id}.json`), JSON.stringify(topic, null, 2), { mode: 0o600 });
  return topic;
}

export function listTopics(dir: string = topicDir()): Topic[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try { return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Topic; } catch { return null; }
    })
    .filter((topic): topic is Topic => Boolean(topic?.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function readTopic(id: string, dir: string = topicDir()): Topic {
  const file = path.join(dir, `${id}.json`);
  if (!existsSync(file)) throw new Error(`主题 ${id} 不存在`);
  return JSON.parse(readFileSync(file, 'utf8')) as Topic;
}

export function createTopic(input: {
  title: string; goal: string; ownerUserId: string; actor?: string; at?: string;
}, dir: string = topicDir()): Topic {
  const title = requireText(input.title, '主题标题');
  const goal = requireText(input.goal, '主题目标');
  const ownerUserId = requireText(input.ownerUserId, '主题负责人');
  const at = input.at ?? new Date().toISOString();
  const id = `topic-${shortId(`${title}|${ownerUserId}|${at}`)}`;
  const topic: Topic = {
    schemaVersion: 1, id, title, goal, ownerUserId, status: 'active',
    channels: [], tasks: [], createdAt: at, updatedAt: at,
  };
  writeTopic(dir, topic);
  return topic;
}

/**
 * 挂一个协作入口（群 / 协作板 / 会议）。
 * 同一 ref 不重复挂；不同主题挂同一个群是允许的（一个群可以服务多个主题）。
 */
export function attachChannel(input: {
  topicId: string; kind: ChannelKind; ref: string; ownerUserId: string; actor?: string; at?: string;
}, dir: string = topicDir()): Topic {
  const topic = readTopic(input.topicId, dir);
  if (!CHANNEL_KINDS.includes(input.kind)) throw new Error(`不认识的入口类型：${input.kind}`);
  const ref = requireText(input.ref, '入口标识');
  const ownerUserId = requireText(input.ownerUserId, '入口负责人');
  if (topic.channels.some(channel => channel.ref === ref)) return topic;
  const at = input.at ?? new Date().toISOString();
  topic.channels.push({ id: `ch-${shortId(`${topic.id}|${ref}`)}`, kind: input.kind,
    ref, ownerUserId, addedAt: at, addedBy: input.actor ?? ownerUserId });
  topic.updatedAt = at;
  return writeTopic(dir, topic);
}

/**
 * 挂一个任务。一个任务只能属于一个主题 —— 否则同一件活会出现两套口径，
 * 正是我们要避免的那种「看起来聚合了，其实没人负责」。
 */
export function attachTask(input: {
  topicId: string; taskId: string; roleId: string; ownerUserId: string; actor?: string; at?: string;
}, dir: string = topicDir()): Topic {
  const topic = readTopic(input.topicId, dir);
  const taskId = requireText(input.taskId, '任务标识');
  const roleId = requireText(input.roleId, '主职能');
  const ownerUserId = requireText(input.ownerUserId, '任务负责人');
  const holder = listTopics(dir).find(other => other.id !== topic.id
    && other.tasks.some(task => task.taskId === taskId));
  if (holder) throw new Error(`任务 ${taskId} 已属于主题 ${holder.id}「${holder.title}」，请先从那边移出`);
  if (topic.tasks.some(task => task.taskId === taskId)) return topic;
  const at = input.at ?? new Date().toISOString();
  topic.tasks.push({ taskId, roleId, ownerUserId, addedAt: at, addedBy: input.actor ?? ownerUserId });
  topic.updatedAt = at;
  return writeTopic(dir, topic);
}

export interface TopicDigest {
  topicId: string;
  title: string;
  goal: string;
  ownerUserId: string;
  status: TopicStatus;
  tasks: number;
  channels: number;
  byState: Record<string, number>;
  blocked: { taskId: string; reason: string }[];
  /** 一句话回答「这个主题现在到哪一步了」。 */
  summary: string;
}

/** 聚合视图：只陈述现状，不替任何人做决定。 */
export function topicDigest(topic: Topic,
  states: Record<string, { state?: string; blockedReason?: string }> = {}): TopicDigest {
  const byState: Record<string, number> = {};
  const blocked: { taskId: string; reason: string }[] = [];
  for (const task of topic.tasks) {
    const state = states[task.taskId]?.state ?? 'unknown';
    byState[state] = (byState[state] ?? 0) + 1;
    const reason = states[task.taskId]?.blockedReason?.trim();
    if (reason) blocked.push({ taskId: task.taskId, reason });
  }
  const parts = Object.entries(byState).map(([state, count]) => `${state} ${count}`);
  const summary = topic.tasks.length === 0
    ? '主题里还没有任务：先挂一件具体要推进的事。'
    : `${topic.channels.length} 个入口 / ${topic.tasks.length} 个任务：`
      + (parts.join('、') || '状态未知')
      + (blocked.length ? `；${blocked.length} 个卡点要人处理` : '；没有卡点');
  return {
    topicId: topic.id, title: topic.title, goal: topic.goal,
    ownerUserId: topic.ownerUserId, status: topic.status,
    tasks: topic.tasks.length, channels: topic.channels.length,
    byState, blocked, summary,
  };
}

/** 一个群/协作板可以同时服务多个主题（例如「筹备」和「预算」都在同一个群）。 */
export function findTopicsByChannel(ref: string, dir: string = topicDir()): Topic[] {
  const target = String(ref ?? '').trim();
  if (!target) return [];
  return listTopics(dir).filter(topic => topic.channels.some(channel => channel.ref === target));
}

export interface ChannelMessage {
  channelRef: string;
  at: string;
  author: string;
  text: string;
}

export interface ChannelDigest {
  ref: string;
  kind: string | null;
  messages: number;
  lastAt: string | null;
  /** 这个频道最后一句说了什么，给未读的人一个落点。 */
  lastText: string;
}

export interface TopicContextPack {
  topicId: string;
  title: string;
  goal: string;
  channels: ChannelDigest[];
  /** 合并稿：按频道分组、按时间排序，只做归并和标注，不下结论。 */
  merged: string;
}

/**
 * 把主题下多个频道的上下文并成一份稿子（千问的「跨群对齐」里最没有争议的那一半）。
 *
 * 刻意只做三件事：归并、标注来源、留最后一句。
 * 不做「两个频道说的是不是同一件事」的判断 —— 那种判断要么靠模型瞎猜，
 * 要么得先定口径，两者都不该塞进一个只读聚合里。
 */
export function topicContextPack(topic: Topic, messages: readonly ChannelMessage[],
  options: { perChannel?: number } = {}): TopicContextPack {
  const perChannel = Math.max(1, options.perChannel ?? 3);
  const known = new Map(topic.channels.map(channel => [channel.ref, channel]));
  const grouped = new Map<string, ChannelMessage[]>();
  for (const message of messages) {
    if (!known.has(message.channelRef)) continue;       // 不属于本主题的频道不进稿
    if (!grouped.has(message.channelRef)) grouped.set(message.channelRef, []);
    grouped.get(message.channelRef)!.push(message);
  }
  const channels: ChannelDigest[] = [];
  const lines = [`【主题】${topic.title}｜目标：${topic.goal}`];
  for (const channel of topic.channels) {
    const list = (grouped.get(channel.ref) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
    const tail = list.slice(-perChannel);
    channels.push({
      ref: channel.ref,
      kind: channel.kind ?? null,
      messages: list.length,
      lastAt: tail.at(-1)?.at ?? null,
      lastText: tail.at(-1)?.text ?? '',
    });
    lines.push(`\n[${channel.kind}] ${channel.ref}（${list.length} 条，负责人 ${channel.ownerUserId}）`);
    if (tail.length === 0) lines.push('  （这个入口还没有可合并的内容）');
    for (const message of tail) lines.push(`  · ${message.at} ${message.author}：${message.text}`);
  }
  lines.push('\n以上是按频道归并的原文摘录，没有做结论、也没有判定谁对谁错；'
    + '口径不一致时仍需人指定以哪边为准。');
  return { topicId: topic.id, title: topic.title, goal: topic.goal, channels, merged: lines.join('\n') };
}
