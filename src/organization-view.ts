/**
 * 组织视图（只读）。
 *
 * 产品口径：团队共用一份上下文底座；在这份现场之上，按职能配置三层座位
 * （个人助手 / 职能主管 / 执行与验收）。层是配置不是骨架——小团队可以没有
 * 主管，大团队按业务域加中间决策层；同一个 Agent 可以兼任多个职责。
 *
 * 本模块只做确定性聚合（`modelCalls=0`）：不派单、不改编制、不写任何状态。
 */
import type { Task } from './store.ts';
import type { AgentInstance, AgentRegistry } from './agent-registry.ts';
import { agentVersion, onDuty, scopeCovers } from './agent-registry.ts';

export type OrgShapeInput = {
  mode?: string;
  domains?: readonly string[];
  maxHops?: number;
};

export type OrgAgent = {
  key: string;
  label: string;
  responsibilities: string[];
  domains: string[];
  version: string;
};

export type OrgDomain = {
  domain: string;
  supervisor: string | null;
  workers: number;
  reviewers: number;
  tasks: number;
};

export type OrgLayer = {
  key: 'personal' | 'supervisor' | 'delivery';
  label: string;
  hint: string;
  configured: boolean;
  agents: OrgAgent[];
};

export type OrganizationView = {
  schemaVersion: 1;
  shape: { mode: string; label: string; maxHops: number; domains: string[]; layered: boolean };
  contextBase: {
    engine: string;
    events: number;
    sources: number;
    spaces: number;
    projections: string[];
    shared: true;
    modelCalls: 0;
    note: string;
  };
  layers: OrgLayer[];
  domains: OrgDomain[];
  tasks: {
    total: number;
    byPhase: Record<string, number>;
    byAgent: { agent: string; count: number }[];
    unassigned: number;
    note: string;
  };
  notes: string[];
};

const LAYER_DEFS: { key: OrgLayer['key']; label: string; hint: string }[] = [
  { key: 'personal', label: '个人助手', hint: '接单、追问、把人的话带到责任链上' },
  { key: 'supervisor', label: '职能主管', hint: '只在配置的业务域做中间决策，最多多一跳' },
  { key: 'delivery', label: '执行与验收', hint: '干活、起草标准、逐项判定、周期巡检' },
];

function toOrgAgent(agent: AgentInstance): OrgAgent {
  return {
    key: agent.key, label: agent.label,
    responsibilities: [...agent.responsibilities].sort(),
    domains: [...agent.domains].sort(),
    version: agentVersion(agent),
  };
}

function layerOf(agent: AgentInstance, key: OrgLayer['key']): boolean {
  if (key === 'personal') return agent.responsibilities.includes('personal');
  if (key === 'supervisor') return agent.responsibilities.includes('supervisor');
  return agent.responsibilities.some(item => item !== 'personal' && item !== 'supervisor');
}

function titleOf(task: Task): string {
  const first = String(task.context ?? '').split('\n')[0] ?? '';
  const text = first.trim() || task.identifier || '未命名任务';
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

function shapeLabel(mode: string): string {
  if (mode === 'layered') return '按业务域分层：最多 2 跳，主管须真实在岗';
  if (mode === 'legacy') return '兼容模式：逐字回退旧链路';
  return '扁平：人 / 助手直达执行者，不硬造管理层';
}

export function buildOrganizationView(input: {
  shape: OrgShapeInput;
  registry: AgentRegistry;
  tasks: readonly Task[];
  events: number;
  sources: number;
  spaces: number;
}): OrganizationView {
  const agents = onDuty(input.registry);
  const mode = String(input.shape.mode ?? 'flat');
  const configuredDomains = [...new Set([
    ...(input.shape.domains ?? []),
    ...agents.flatMap(agent => agent.domains),
  ])].sort();
  const layers: OrgLayer[] = LAYER_DEFS.map(def => {
    const matched = agents.filter(agent => layerOf(agent, def.key));
    return { ...def, configured: matched.length > 0, agents: matched.map(toOrgAgent) };
  });

  const domainRows: OrgDomain[] = configuredDomains.map(domain => {
    const inDomain = agents.filter(agent => scopeCovers(agent, domain));
    const supervisor = inDomain.find(agent => agent.responsibilities.includes('supervisor'));
    return {
      domain,
      supervisor: supervisor?.key ?? null,
      workers: inDomain.filter(agent => agent.responsibilities.includes('worker')).length,
      reviewers: inDomain.filter(agent => agent.responsibilities.includes('acceptance')).length,
      tasks: input.tasks.filter(task => inDomain.some(agent => agent.key === task.agent)).length,
    };
  });

  const assigned = input.tasks.filter(task => agents.some(agent => agent.key === task.agent));
  const byPhase: Record<string, number> = {};
  for (const task of input.tasks) byPhase[task.phase] = (byPhase[task.phase] ?? 0) + 1;
  const byAgentMap = new Map<string, number>();
  for (const task of assigned) byAgentMap.set(task.agent, (byAgentMap.get(task.agent) ?? 0) + 1);

  return {
    schemaVersion: 1,
    shape: {
      mode,
      label: shapeLabel(mode),
      maxHops: Number(input.shape.maxHops ?? (mode === 'layered' ? 2 : 1)),
      domains: configuredDomains,
      layered: mode === 'layered',
    },
    contextBase: {
      engine: 'append-only 事件主干 → 四类投影 → 按任务裁剪的 Context Pack',
      events: input.events,
      sources: input.sources,
      spaces: input.spaces,
      projections: ['L1 证据图', 'L2 组织图', 'BM25 向量', 'Context Pack'],
      shared: true,
      modelCalls: 0,
      note: '三层读的是同一份共享现场，只换可见范围与责任主体；不靠聊天记录往下传',
    },
    layers,
    domains: domainRows,
    tasks: {
      total: input.tasks.length,
      byPhase,
      byAgent: [...byAgentMap.entries()].map(([agent, count]) => ({ agent, count }))
        .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)),
      unassigned: input.tasks.length - assigned.length,
      note: input.tasks.length === 0
        ? '当前身份可见范围内还没有协作任务'
        : '按承接 Agent 归并；职能域来自组织编制配置，不从任务标题猜',
    },
    notes: [
      '层是配置不是产品骨架：小团队可以扁平，大团队按业务域加中间决策层',
      '同一个 Agent 可以兼任多个职责；同一 Task 仍禁止自派自验自环',
      '组织形态与编制由组织级 owner 配置，项目只引用不覆写；变更留快照不回溯',
      agents.length === 0 ? '当前未配置 Agent 编制：扁平运行，不硬造主管或验收 Agent' : '当前按配置解析在岗 Agent',
    ],
  };
}

/** 只给控制台展示用：任务标题不参与聚合，避免把正文带出只读视图。 */
export function organizationTaskLine(task: Task): { id: string; identifier: string; title: string; phase: string; agent: string } {
  return { id: task.id, identifier: task.identifier, title: titleOf(task), phase: task.phase, agent: task.agent };
}
