import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { nextRun, parseCron } from '../../upstream/autoloop/kernel/cron.ts';
import { runtime } from '../config.ts';
import { canonicalResourceId, feishuDocLocation, githubRepository, resourcePurpose, resourceSchema, routesEvents, topicInputSchema } from './project-resources.ts';
import { digestAgentId, discussionZone } from './discussion.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const member = z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/);
const profileId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(160);
export const title = z.string().trim().min(1).max(100);
const discussion = z.object({
  agent: id,
  model: title.optional(),
  effort: z.enum(['low', 'medium', 'high']).default('low'),
  cron: z.string().max(80).refine(value => {
    const cron = parseCron(value);
    return !!cron && nextRun(cron, Date.now(), discussionZone) !== null;
  }, '请输入能够触发的五段式 cron').default('0 0,12 * * *'),
  history: z.object({ profile: profileId, appId: profileId, userOpenId: profileId, member }).strict().optional(),
  documents: z.array(z.url({ protocol: /^https$/ })).max(4).default([]),
}).strict();
const project = z.object({
  id, title, parent: id.optional(), members: z.array(member).min(1),
  maintainers: z.array(member).min(1),
  relatedProjects: z.array(id).default([]),
  decisionOwner: member.optional(),
  dispatch: z.array(z.object({ topic: id.optional(), function: id, agent: id, decider: member.optional() }).strict()).default([]),
  responsibilities: z.array(z.object({ member, function: id }).strict()).default([]),
  topics: z.array(topicInputSchema).default([]),
  resources: z.array(resourceSchema).default([]),
  budget: z.number().positive().optional(),
  discussion: discussion.optional(),
}).strict();
const agent = z.object({
  id, title, kind: z.enum(['personal', 'specialist']), owner: member,
  capability: z.string().trim().min(1).max(400), function: id,
  projects: z.array(id).min(1),
  engine: z.enum(['codex', 'claude', 'acp', 'command', 'cursor']),
  command: z.array(z.string().min(1)).min(1).optional(),
  model: z.string().max(100).optional(),
  execution: z.object({
    kind: z.enum(['sandbox', 'test']),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/),
    credential: id.optional(),
    effort: z.enum(['low', 'medium', 'high']).default('low'),
    domains: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/)).max(12).default([]),
  }).strict().optional(),
  skill: z.string().trim().min(1).max(5000),
  active: z.boolean().default(false),
}).strict();
export const settingsSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4280),
  projects: z.array(project).min(1),
  functions: z.array(z.object({ id, title, lead: id.optional() }).strict()).min(1),
  agents: z.array(agent),
  feishu: z.object({ profile: z.string(), appId: z.string(), botId: z.string() }).strict().optional(),
  crossChannel: z.object({
    githubPollSeconds: z.number().int().min(15).max(300).default(30),
  }).strict().optional(),
  attribution: z.object({
    entireCommand: z.string().refine(path.isAbsolute),
    checkouts: z.record(z.string().regex(githubRepository), z.string().refine(path.isAbsolute)),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const flag = (message: string) => context.addIssue({ code: 'custom', message });
  for (const entries of [value.projects, value.functions, value.agents]) {
    if (new Set(entries.map(x => x.id)).size !== entries.length) flag('项目、职能或 Agent 标识重复');
  }
  const projectById = new Map(value.projects.map(x => [x.id, x]));
  const refs = new Set<string>();
  for (const p of value.projects) {
    if (p.maintainers.some(name => !p.members.includes(name))) flag('项目维护人必须是项目成员');
    if (p.decisionOwner && !p.maintainers.includes(p.decisionOwner)) flag('项目接单决策人须是项目维护人');
    if (new Set(p.relatedProjects).size !== p.relatedProjects.length
      || p.relatedProjects.some(related => related === p.id || !projectById.has(related))) flag('关联项目必须存在且不能重复或关联自身');
    const duties = new Set<string>();
    for (const duty of p.dispatch) {
      const key = [duty.topic ?? '', duty.function].join('/');
      if (duties.has(key)) flag('同一项目主题下的同一职责只能配置一位牵头 Agent');
      duties.add(key);
      if (duty.topic && !p.topics.some(topic => topic.id === duty.topic)) flag('派工主题必须属于当前项目');
      if (duty.decider && !p.members.includes(duty.decider)) flag('执行决策人必须是项目成员');
      if (!value.agents.some(agent => agent.id === duty.agent && agent.function === duty.function && agent.projects.includes(p.id)))
        flag('派工规则必须引用当前项目内承担该职责的 Agent');
    }
    if (p.responsibilities.some(r => !p.members.includes(r.member) || !value.functions.some(fn => fn.id === r.function)))
      flag('项目职责须由项目成员承担，并引用已定义的职责');
    if (p.discussion && (!value.feishu || !value.crossChannel || !p.resources.some(ref => ref.digest)
      || !value.agents.some(agent => agent.id === p.discussion!.agent && agent.projects.includes(p.id) && agent.active)))
      flag('群整理须配置飞书身份、渠道绑定和当前项目的在岗 Agent');
    if (p.discussion?.history && !p.maintainers.includes(p.discussion.history.member))
      flag('补读账号须由项目维护人授权并指定对应成员');
    if (p.discussion?.documents.length && !p.discussion.history) flag('飞书文档整理须先配置授权读取身份');
    if (new Set(p.topics.map(topic => topic.id)).size !== p.topics.length) flag('项目主题标识重复');
    for (const topic of p.topics) {
      if (topic.parent && !p.topics.some(parent => parent.id === topic.parent && !parent.parent))
        flag('子主题须直属当前项目的一级主题');
    }
    const seen = new Set([p.id]);
    for (let parent = p.parent; parent; parent = projectById.get(parent)?.parent) {
      if (seen.has(parent) || !projectById.has(parent)) { flag('项目层级存在循环或缺少父项目'); break; }
      seen.add(parent);
    }
    const own = new Set<string>();
    for (const ref of p.resources) {
      const key = ref.source + ':' + canonicalResourceId(ref.source, ref.externalId);
      if (own.has(key)) flag('项目来源重复');
      own.add(key);
      if (resourcePurpose(ref) === 'delivery' && (ref.source !== 'github' || !githubRepository.test(ref.externalId)))
        flag('交付目标必须是明确的 GitHub 仓库');
      if (ref.contributors && (resourcePurpose(ref) !== 'delivery' || ref.contributors.some(name => !p.members.includes(name))))
        flag('交付成员必须是对应项目成员');
      if (ref.execution && (resourcePurpose(ref) !== 'delivery' || !ref.contributors?.length))
        flag('代码执行须配置交付仓库和交付成员');
      if (ref.topic && (!routesEvents(ref) || !p.topics.some(topic => topic.id === ref.topic)))
        flag('默认主题只用于当前项目已配置的消息来源');
      if (ref.digest && (ref.source !== 'feishu' || !/^oc_[a-zA-Z0-9]+$/.test(ref.externalId) || !routesEvents(ref) || !p.discussion))
        flag('群整理只适用于已配置的飞书讨论来源');
      if (ref.knowledge) {
        if (ref.state !== 'bound' || !p.members.includes(ref.knowledge.owner))
          flag('知识接入须绑定项目资料，并指定该项目的资料负责人');
        if (ref.knowledge.format === 'feishu-docx' ? !feishuDocLocation(ref)
          : ref.source !== 'github' || !githubRepository.test(ref.externalId))
          flag('知识正文接入只接受明确的飞书 Docx 或 GitHub Markdown 配置');
      }
      if (ref.state === 'bound' && routesEvents(ref)) {
        if (refs.has(key)) flag('接收消息的来源只能路由到一个项目');
        refs.add(key);
      }
    }
  }
  for (const service of value.agents) {
    if (service.id === 'auto') flag('auto 保留给自动派工');
    if (value.projects.some(p => p.discussion && service.id === digestAgentId(p.id)))
      flag('Agent 标识与群整理执行端冲突');
    if (!value.functions.some(x => x.id === service.function)) flag('Agent 的职能不存在');
    if (service.projects.some(p => !projectById.get(p)?.members.includes(service.owner))) flag('Agent 所有者必须是对应项目成员');
    if ((['command', 'cursor'].includes(service.engine)) !== Boolean(service.command)) flag('通用命令与 Cursor 需要配置命令参数');
    if (service.engine === 'cursor' && service.command?.length !== 1) flag('Cursor 配置只接受可执行文件路径');
    if (service.command && !path.isAbsolute(service.command[0]!)) flag('通用命令必须使用可执行文件绝对路径');
  }
  for (const fn of value.functions) {
    if (fn.lead && !value.agents.some(a => a.id === fn.lead && a.function === fn.id && a.kind === 'specialist'))
      flag('职能负责人必须是该职能的专项 Agent');
  }
});

export type Settings = z.infer<typeof settingsSchema>;
export type Project = Settings['projects'][number];
export type Agent = Settings['agents'][number];
export const loadSettings = async () => settingsSchema.parse(JSON.parse(await readFile(runtime('workbench.json'), 'utf8')));
