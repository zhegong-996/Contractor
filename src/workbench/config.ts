import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runtime } from '../config.ts';
import { canonicalResourceId, githubRepository, resourcePurpose, resourceSchema, routesEvents, topicInputSchema } from './project-resources.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const member = z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/);
export const title = z.string().trim().min(1).max(100);
const project = z.object({
  id, title, parent: id.optional(), members: z.array(member).min(1),
  maintainers: z.array(member).min(1),
  responsibilities: z.array(z.object({ member, function: id }).strict()).default([]),
  topics: z.array(topicInputSchema).default([]),
  resources: z.array(resourceSchema).default([]),
  budget: z.number().positive().optional(),
}).strict();
const agent = z.object({
  id, title, kind: z.enum(['personal', 'specialist']), owner: member,
  capability: z.string().trim().min(1).max(400), function: id,
  projects: z.array(id).min(1),
  engine: z.enum(['codex', 'claude', 'acp', 'command', 'cursor']),
  command: z.array(z.string().min(1)).min(1).optional(),
  model: z.string().max(100).optional(),
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
    if (p.responsibilities.some(r => !p.members.includes(r.member) || !value.functions.some(fn => fn.id === r.function)))
      flag('项目职责须由项目成员承担，并引用已定义的职责');
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
      if (ref.state === 'bound' && routesEvents(ref)) {
        if (refs.has(key)) flag('接收消息的来源只能路由到一个项目');
        refs.add(key);
      }
    }
  }
  for (const service of value.agents) {
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
