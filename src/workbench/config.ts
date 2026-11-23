import { executionCapabilities } from './execution-capabilities.ts';
import { runnerEndpoint } from './runner-connection.ts';
import { remoteEngine, runnerAgentSchema, type RunnerAgent } from './runner-profile.ts';
export { remoteEngine, runnerAgentSchema, runnerOllamaUrl, type RunnerAgent } from './runner-profile.ts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digestSchedule } from './execution/cron.ts';
import { runtime } from '../config.ts';
import { canonicalResourceId, feishuDocLocation, feishuHistoryReader, figmaNodeLocation, githubRepository, resourcePurpose, resourceSchema, routesEvents, topicInputSchema } from './project-resources.ts';
import { digestAgentId } from './discussion.ts';
import { octopIMConnector } from './octop-im-contract.ts';
import { imLoginSettings } from './im-login-providers.ts';
import { memoryProviderIds } from './memory-providers.ts';
import { assistantProfiles } from './platform-assistant.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const member = z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/);
export const title = z.string().trim().min(1).max(100);
export const modelId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const modelNames = z.array(modelId).min(1).max(12).refine(models => new Set(models).size === models.length);
export const modelRoute = z.object({ purpose: z.enum(['summary', 'personal', 'execution']), agent: id,
  models: modelNames.refine(models => models.length <= 4) }).strict();
export const dispatchRule = z.object({ topic: id.optional(), function: id, agent: id, decider: member.optional() }).strict();
export const projectResponsibility = z.object({ member, function: id }).strict();
export type ModelPurpose = z.infer<typeof modelRoute>['purpose'];
export type FeishuHistoryReader = z.infer<typeof feishuHistoryReader>;
const discussion = z.object({
  agent: id,
  model: title.optional(),
  effort: z.enum(['low', 'medium', 'high']).default('low'),
  cron: z.string().max(80).refine(value => {
    try { return digestSchedule(value).next(Date.now()) !== undefined; } catch { return false; }
  }, '请输入能够触发的五段式 cron').default('0 0,12 * * *'),
  history: feishuHistoryReader.optional(),
  documents: z.array(z.url({ protocol: /^https$/ })).max(4).default([]),
}).strict();
export const goalSchema = z.object({ id, title, done: z.boolean().default(false) }).strict();
export const triggerPolicy = z.object({
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  sensitivity: z.enum(['strict', 'balanced', 'open']).default('balanced'),
  silenceMinutes: z.number().int().min(0).max(10080).default(0),
  mentionAlways: z.boolean().default(true),
}).strict();
export type TriggerPolicy = z.infer<typeof triggerPolicy>;
export const approvalStage = z.object({ id, title, members: z.array(member).min(1), requireAll: z.boolean().default(false) }).strict();
export type ApprovalStage = z.infer<typeof approvalStage>;
export const routineSchema = z.object({
  id, title,
  cron: z.string().max(80).refine(value => {
    try { return digestSchedule(value).next(Date.now()) !== undefined; } catch { return false; }
  }, '请输入能够触发的五段式 cron'),
  actor: member,
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ticket'), title, request: z.string().trim().min(1).max(3000), topic: id.optional(), agent: id.optional() }).strict(),
    z.object({ kind: z.literal('consultation'), topic: id, text: z.string().trim().min(1).max(3000), agent: id }).strict(),
    z.object({ kind: z.literal('next-version'), ticket: id, reason: z.string().trim().min(1).max(1000) }).strict(),
  ]),
}).strict();
const project = z.object({
  id, title, parent: id.optional(), members: z.array(member).min(1),
  maintainers: z.array(member).min(1),
  relatedProjects: z.array(id).default([]),
  decisionOwner: member.optional(),
  delegations: z.array(z.object({ from: id, to: id, repository: z.string().regex(githubRepository).optional(),
    maxChildren: z.number().int().min(1).max(8).default(3), maxDepth: z.number().int().min(1).max(3).default(2),
    scope: z.object({ title, request: z.string().trim().min(1).max(3000),
      allowRestricted: z.literal(true).optional(),
      material: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).max(8)
        .refine(list => new Set(list).size === list.length) }).strict().optional(),
  }).strict()).default([]),
  dispatch: z.array(dispatchRule).default([]),
  responsibilities: z.array(projectResponsibility).default([]),
  topics: z.array(topicInputSchema).default([]),
  consultations: z.array(z.object({ topic: id, feishu: z.boolean().optional(), sharedExperts: z.boolean().optional(), agents: z.array(z.object({
    agent: id, material: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).min(1).max(4),
  }).strict()).max(4).default([]) }).strict()).optional(),
  consultationHistory: feishuHistoryReader.optional(),
  modelRoutes: z.array(modelRoute).max(60).optional(),
  resources: z.array(resourceSchema).default([]),
  budget: z.number().positive().optional(),
  discussion: discussion.optional(),
  goals: z.array(goalSchema).default([]),
  routines: z.array(routineSchema).default([]),
  trigger: triggerPolicy.optional(),
  approvals: z.array(approvalStage).max(6).optional(),
}).strict();
const agent = runnerAgentSchema.extend({
  title, kind: z.enum(['personal', 'specialist']),
  capability: z.string().trim().min(1).max(400), function: id,
  projects: z.array(id).min(1),
  command: z.array(z.string().min(1)).min(1).optional(),
  allowedModels: modelNames.optional(),
  skill: z.string().trim().min(1).max(5000),
  active: z.boolean().default(false),
}).strict();
const octopSettings = z.object({ python: z.string().refine(path.isAbsolute),
  indexSocket: z.string().refine(value => path.isAbsolute(value) && Buffer.byteLength(value) < 104 && !value.includes('\0'),
    '知识索引须使用绝对路径的本机 Unix socket，路径少于 104 字节').optional(),
  profiles: z.array(z.object({ owner: member, model: z.string().regex(/^deepseek-[a-z0-9.-]{1,70}$/), credential: id }).strict()).max(100),
  channels: z.array(octopIMConnector).max(12).optional(),
  feishuGateway: z.boolean().default(false) }).strict().refine(item => new Set(item.profiles.map(row => row.owner)).size === item.profiles.length,
  '每位成员只能配置一个 Octop 执行身份');
export type OctopSettings = z.infer<typeof octopSettings>;
export const orgSettings = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: title,
  domain: z.string().max(180).optional(),
}).strict();
export type OrgSettings = z.infer<typeof orgSettings>;
export const settingsSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4280),
  executionRuntime: z.enum(['autoloop', 'contractor']).default('autoloop'),
  remoteRunnerPort: z.number().int().min(1024).max(65535).optional(),
  runnerConnectUrl: runnerEndpoint.optional(),
  workbenchPublicUrl: runnerEndpoint.refine(value => value.startsWith('https://'), '团队工作台地址须为 HTTPS').optional(),
  org: orgSettings.optional(),
  imLogin: imLoginSettings.optional(),
  projects: z.array(project).default([]),
  functions: z.array(z.object({ id, title, lead: id.optional() }).strict()).default([]),
  agents: z.array(agent).default([]),
  octop: octopSettings.optional(),
  platformAssistant: assistantProfiles.optional(),
  plugins: z.object({ memory: z.enum(memoryProviderIds).optional() }).strict().optional(),
  feishu: z.object({ profile: z.string(), appId: z.string(), botId: z.string(), decisionCards: z.boolean().optional(),
    separateIngress: z.boolean().optional(),
    allowedGroups: z.array(z.string().regex(/^oc_[a-zA-Z0-9_-]+$/)).max(100).optional() }).strict().optional(),
  crossChannel: z.object({
    githubPollSeconds: z.number().int().min(15).max(300).default(30),
  }).strict().optional(),
  attribution: z.object({
    entireCommand: z.string().refine(path.isAbsolute).optional(),
    checkouts: z.record(z.string().regex(githubRepository), z.string().refine(path.isAbsolute)),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const flag = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.plugins?.memory === 'octop' && !value.octop) flag('Octop 索引插件需要配置 octop 服务。');
  if (value.agents.some(agent => agent.engine === 'octop' || agent.execution?.kind === 'harness'))
    flag('Octop Agent 由共享专家目录创建，执行凭据在 octop.profiles 登记');
  if (value.octop?.feishuGateway && !value.feishu) flag('Octop 飞书入口须启用已授权的飞书连接');
  if (value.remoteRunnerPort === value.port) flag('远程执行端须使用独立端口');
  if (value.runnerConnectUrl && !value.remoteRunnerPort) flag('浏览器连接执行端须配置远程执行端口');
  for (const entries of [value.projects, value.functions, value.agents]) {
    if (new Set(entries.map(x => x.id)).size !== entries.length) flag('项目、职能或 Agent 标识重复');
  }
  const projectById = new Map(value.projects.map(x => [x.id, x]));
  const itemAgents = (p: z.infer<typeof project>, topic: string) => p.consultations?.find(item => item.topic === topic)?.agents ?? [];
  const connectors = value.octop?.channels ?? [];
  if (new Set(connectors.map(row => row.id)).size !== connectors.length) flag('Octop IM 连接标识重复');
  for (const connector of connectors) {
    const routes = [...connector.routes, ...connector.allowedConversations ?? []];
    if (new Set(routes.map(row => JSON.stringify([row.chat, row.thread]))).size !== routes.length)
      flag('同一 Octop IM 会话或话题只能绑定一个项目主题');
    for (const route of connector.routes) if (!projectById.get(route.project)?.consultations?.some(row => row.topic === route.topic))
      flag('Octop IM 会话须绑定已开启咨询的项目主题');
  }
  const refs = new Set<string>();
  for (const p of value.projects) {
    if (p.maintainers.some(name => !p.members.includes(name))) flag('项目维护人必须是项目成员');
    if (p.decisionOwner && !p.maintainers.includes(p.decisionOwner)) flag('项目接单决策人须是项目维护人');
    if (new Set(p.relatedProjects).size !== p.relatedProjects.length
      || p.relatedProjects.some(related => related === p.id || !projectById.has(related))) flag('关联项目必须存在且不能重复或关联自身');
    const delegated = new Set<string>();
    for (const rule of p.delegations) {
      const key = rule.from + '/' + rule.to;
      if (delegated.has(key)) flag('Agent 转委托规则不能重复');
      delegated.add(key);
      if (!value.agents.some(a => a.id === rule.from && a.projects.includes(p.id)) || !value.functions.some(f => f.id === rule.to))
        flag('转委托须引用项目 Agent 和已配置职责');
      if (rule.repository && !p.resources.some(r => r.source === 'github' && r.state === 'bound' && r.execution
        && r.externalId.toLowerCase() === rule.repository!.toLowerCase())) flag('转委托代码仓库须是本项目已配置的交付目标');
    }
    const duties = new Set<string>();
    const modelRoutes = new Set<string>();
    for (const route of p.modelRoutes ?? []) {
      const name = route.purpose + '/' + route.agent;
      const agent = value.agents.find(candidate => candidate.id === route.agent);
      if (modelRoutes.has(name)) flag('同一项目、用途和 Agent 的模型路线不能重复');
      modelRoutes.add(name);
      if (!agent?.projects.includes(p.id) || !p.members.includes(agent.owner) || agent.engine !== 'codex'
        || agent.execution?.kind !== 'sandbox' || agent.execution.provider !== 'openai' || !executionCapabilities(agent).local
        || route.models.some(model => !agent.allowedModels?.includes(model)))
        flag('模型路线须引用当前项目已授权的本机 Codex 及其模型名单');
      if (route.purpose === 'personal' && agent?.kind !== 'personal') flag('个人模型路线须引用个人 Agent');
      if (route.purpose === 'summary' && (p.discussion?.agent !== route.agent || p.discussion.model))
        flag('整理模型路线须使用项目的整理 Agent，并移除旧的单模型覆盖');
    }
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
      || !value.agents.some(agent => agent.id === p.discussion!.agent && agent.projects.includes(p.id) && agent.active && executionCapabilities(agent).platformDigest)))
      flag('群整理须配置飞书身份、渠道绑定和当前项目的在岗 Agent');
    if (p.discussion?.model) {
      const models = value.agents.find(item => item.id === p.discussion!.agent)?.allowedModels;
      if (models && !models.includes(p.discussion.model)) flag('整理单模型覆盖须在 Agent 模型名单内');
    }
    if (p.discussion?.history && !p.maintainers.includes(p.discussion.history.member))
      flag('补读账号须由项目维护人授权并指定对应成员');
    if (p.consultationHistory && (!p.maintainers.includes(p.consultationHistory.member) || !p.consultations?.some(item => item.feishu)))
      flag('咨询补读须指定项目维护人的飞书读取身份，并启用飞书主题咨询');
    if (p.discussion?.documents.length && !p.discussion.history) flag('飞书文档整理须先配置授权读取身份');
    if (new Set(p.topics.map(topic => topic.id)).size !== p.topics.length) flag('项目主题标识重复');
    if (new Set(p.consultations?.map(item => item.topic)).size !== (p.consultations?.length ?? 0)) flag('主题咨询配置重复');
    for (const item of p.consultations ?? []) {
      if (!p.topics.some(topic => topic.id === item.topic)) flag('咨询主题须属于当前项目');
      if ((!item.sharedExperts && !item.agents.length) || (item.sharedExperts && !value.octop))
        flag('主题咨询须登记 Agent 或启用 Octop 共享专家');
      if (item.feishu && (!value.feishu || !p.resources.some(ref => ref.source === 'feishu' && ref.state === 'bound' && routesEvents(ref)
        && (ref.topic === item.topic || ref.feishuTopicRoots?.[item.topic]))))
        flag('飞书咨询须配置同一主题的讨论群');
      if (new Set(item.agents.map(row => row.agent)).size !== item.agents.length || item.agents.some(row => !value.agents.some(agent =>
        agent.id === row.agent && agent.projects.includes(p.id) && p.members.includes(agent.owner)))) flag('咨询须引用当前项目成员的 Agent，且每位只能登记一次');
      if (item.agents.some(row => new Set(row.material).size !== row.material.length)) flag('同一 Agent 的咨询资料不能重复');
    }
    for (const topic of p.topics) {
      if (topic.parent && !p.topics.some(parent => parent.id === topic.parent && !parent.parent))
        flag('子主题须直属当前项目的一级主题');
    }
    if (new Set(p.goals.map(goal => goal.id)).size !== p.goals.length) flag('项目目标标识重复');
    if (p.approvals && new Set(p.approvals.map(stage => stage.id)).size !== p.approvals.length) flag('审批阶段标识重复');
    for (const stage of p.approvals ?? []) {
      if (new Set(stage.members).size !== stage.members.length || stage.members.some(name => !p.members.includes(name)))
        flag('审批人必须是项目成员且不能重复');
    }
    if (new Set(p.routines.map(routine => routine.id)).size !== p.routines.length) flag('例行任务标识重复');
    for (const routine of p.routines) {
      if (!p.members.includes(routine.actor)) flag('例行任务须由项目成员的名义执行');
      const action = routine.action;
      if (action.kind === 'consultation') {
        if (!p.topics.some(topic => topic.id === action.topic) || !p.consultations?.some(item => item.topic === action.topic)
          || !itemAgents(p, action.topic).some(row => row.agent === action.agent)) flag('例行咨询须使用已配置主题咨询中的 Agent');
      } else if (action.kind === 'ticket') {
        if (action.topic && !p.topics.some(topic => topic.id === action.topic)) flag('例行工单的主题须属于当前项目');
        if (action.agent && !value.agents.some(agent => agent.id === action.agent && agent.projects.includes(p.id)
          && p.members.includes(agent.owner))) flag('例行工单的 Agent 须属于当前项目成员');
      }
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
      if (ref.feishuTopicRoots) {
        const roots = Object.entries(ref.feishuTopicRoots);
        if (ref.source !== 'feishu' || ref.state !== 'bound' || !routesEvents(ref) || !value.feishu?.allowedGroups?.includes(ref.externalId)
          || !roots.length || roots.length > 40 || new Set(roots.map(([, root]) => root)).size !== roots.length
          || roots.some(([topic]) => !p.topics.some(item => item.id === topic)))
          flag('飞书固定话题须属于获准的项目群，每个主题对应不同的根消息');
      }
      if (ref.feishuSubprojectRoots) {
        const roots = Object.entries(ref.feishuSubprojectRoots);
        const ownRoots = new Set(Object.values(ref.feishuTopicRoots ?? {}));
        const recoveryThreads = roots.flatMap(([, target]) => target.recovery ? [target.recovery.thread] : []);
        if (ref.source !== 'feishu' || ref.state !== 'bound' || !routesEvents(ref) || !value.feishu?.allowedGroups?.includes(ref.externalId)
          || !roots.length || roots.length > 40 || new Set(recoveryThreads).size !== recoveryThreads.length || roots.some(([root, target]) => {
            const child = projectById.get(target.project);
            return ownRoots.has(root) || child?.parent !== p.id || !child.topics.some(topic => topic.id === target.topic)
              || !!target.recovery && !child.maintainers.includes(target.recovery.reader.member);
          })) flag('群内子项目入口必须使用不同的固定话题，并指向直属子项目及已有主题');
      }
      if (ref.shareConsultationResults && (ref.source !== 'feishu' || !/^oc_[a-zA-Z0-9_-]+$/.test(ref.externalId)
        || ref.state !== 'bound' || !routesEvents(ref) || !value.feishu?.allowedGroups?.includes(ref.externalId)
        || !p.consultations?.some(item => item.feishu && item.topic === ref.topic)))
        flag('只有已启用主题咨询的指定飞书群可以共享咨询结论');
      if (ref.digest && (ref.source !== 'feishu' || !/^oc_[a-zA-Z0-9]+$/.test(ref.externalId) || !routesEvents(ref) || !p.discussion))
        flag('群整理只适用于已配置的飞书讨论来源');
      if (ref.knowledge) {
        if (ref.state !== 'bound' || !p.members.includes(ref.knowledge.owner))
          flag('知识接入须绑定项目资料，并指定该项目的资料负责人');
        if (ref.knowledge.format === 'feishu-docx' ? !feishuDocLocation(ref)
          : ref.knowledge.format === 'figma-node' ? !figmaNodeLocation(ref)
          : ref.source !== 'github' || !githubRepository.test(ref.externalId))
          flag('知识正文接入须指定飞书 Docx、GitHub Markdown 或 Figma 节点');
      }
      if (ref.state === 'bound' && routesEvents(ref)) {
        if (refs.has(key)) flag('接收消息的来源只能路由到一个项目');
        refs.add(key);
      }
    }
  }
  for (const service of value.agents) {
    if (service.allowedModels && (!service.model || !service.allowedModels.includes(service.model))) flag('Agent 的默认模型须在授权名单内');
    if (service.id === 'auto') flag('auto 保留给自动派工');
    if (value.projects.some(p => p.discussion && service.id === digestAgentId(p.id)))
      flag('Agent 标识与群整理执行端冲突');
    if (!value.functions.some(x => x.id === service.function)) flag('Agent 的职能不存在');
    if (service.projects.some(p => !projectById.get(p)?.members.includes(service.owner))) flag('Agent 所有者必须是对应项目成员');
    if ((['command', 'cursor'].includes(service.engine)) !== Boolean(service.command)) flag('通用命令与 Cursor 需要配置命令参数');
    if (service.engine === 'cursor' && service.command?.length !== 1) flag('Cursor 配置只接受可执行文件路径');
    if (service.command && !path.isAbsolute(service.command[0]!)) flag('通用命令必须使用可执行文件绝对路径');
    if (service.execution?.kind === 'remote' && !remoteEngine(service)) flag('远程执行须明确配置支持的引擎、模型和凭据方式');
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
export function runnerAgent(agent: Agent): RunnerAgent {
  return runnerAgentSchema.parse({ id: agent.id, owner: agent.owner, engine: agent.engine, model: agent.model, execution: agent.execution });
}
