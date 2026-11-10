// 第七十一轮 · Skill 生效体检。
//
// 起因：我上一轮判断「skill 没传到外部 CLI」，查完发现是误判——skill 确实以
// 纯文本段落进了 prompt（section 名 `suitme:skill:<id>` 在渲染后就没了，
// 所以按名字搜不到）。但这个误判本身暴露了真问题：**配了 skill，却没有任何
// 办法确认它真的进了 prompt**。
//
// 本模块做一件事：把声明的 skill 逐条拿到编译后的 prompt 里核对指纹。
// 不靠猜、不靠日志，只看最终 prompt 里有没有那段指令。
//
// 纯核对逻辑（auditFromPrompt）与编译解耦，便于单测；compile 由调用方注入。

import { skillCatalog, type AgentDefinition } from './agent-definition.ts';

export type SkillCheck = {
  id: string;
  /** skill 是否真的出现在最终 prompt 里。 */
  present: boolean;
  /** 用于核对的指纹（指令首段），便于人眼复查。 */
  fingerprint: string;
};

export type SkillAudit = {
  agentKey: string;
  name: string;
  declared: string[];
  checks: SkillCheck[];
  /** 声明了但没进 prompt 的 skill。 */
  missing: string[];
  /** 定义里有、但目录里查不到的 skill（配置写错）。 */
  unknown: string[];
  promptLength: number;
  toolCount: number;
  /** 一句话结论，直接给人看。 */
  verdict: string;
};

/** 指纹取指令首 24 个非空白字符——足够唯一，又不受排版空白影响。 */
function fingerprintOf(instruction: string): string {
  return String(instruction ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

/** 核心核对：给定声明的 skill 与最终 prompt，逐条判断是否生效。 */
export function auditFromPrompt(input: {
  agentKey: string; name: string;
  declared: readonly string[];
  prompt: string;
  toolCount?: number;
  catalog?: readonly { id: string; instruction: string }[];
}): SkillAudit {
  const catalog = input.catalog ?? skillCatalog;
  const prompt = String(input.prompt ?? '');
  // 排版不参与判定：prompt 里的换行/缩进由渲染器决定，指令原文可能没有空白。
  // 两侧都去掉全部空白再比——这条规则对"换行变成空格"和"根本没有空白"同时成立。
  const barePrompt = prompt.replace(/\s+/g, '');
  const checks: SkillCheck[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];

  for (const id of input.declared) {
    const skill = catalog.find(s => s.id === id);
    if (!skill) { unknown.push(id); continue; }
    const fingerprint = fingerprintOf(skill.instruction);
    const bareFingerprint = fingerprint.replace(/\s+/g, '');
    // 指纹为空说明这条 skill 本身没写指令——那它也不可能生效。
    const present = Boolean(bareFingerprint) && barePrompt.includes(bareFingerprint);
    checks.push({ id, present, fingerprint });
    if (!present) missing.push(id);
  }

  const parts: string[] = [];
  parts.push(`${checks.filter(c => c.present).length}/${input.declared.length} 条 skill 已生效`);
  if (missing.length) parts.push(`未生效：${missing.join('、')}`);
  if (unknown.length) parts.push(`目录里查不到：${unknown.join('、')}`);

  return {
    agentKey: input.agentKey,
    name: input.name,
    declared: [...input.declared],
    checks,
    missing,
    unknown,
    promptLength: prompt.length,
    toolCount: input.toolCount ?? 0,
    verdict: parts.join(' · '),
  };
}

/** 定义补全：与 profile 的解析规则保持一致（缺省走 defaultAgentDefinition）。 */
export type SkillAuditProfile = {
  key: string;
  name: string;
  responsibilities: string;
  definition?: AgentDefinition | undefined;
};

/**
 * 逐个体检。
 *
 * `compile` 由调用方注入（真实实现是 harness-composition.compileAgent），
 * 这样测试可以传一个假的编译结果，不必真的跑 esbuild。
 */
export async function auditSkills(
  profiles: readonly SkillAuditProfile[],
  compile: (profile: { id: string; name: string; responsibilities: string; definition?: AgentDefinition })
    => Promise<{ prompt: string; toolNames?: readonly string[]; definition?: { skills: readonly string[] } }>,
  catalog?: readonly { id: string; instruction: string }[],
): Promise<SkillAudit[]> {
  const results: SkillAudit[] = [];
  for (const profile of profiles) {
    try {
      const compiled = await compile({
        id: profile.key, name: profile.name,
        responsibilities: profile.responsibilities, definition: profile.definition,
      });
      results.push(auditFromPrompt({
        agentKey: profile.key, name: profile.name,
        declared: compiled.definition?.skills ?? profile.definition?.skills ?? [],
        prompt: compiled.prompt ?? '',
        toolCount: compiled.toolNames?.length ?? 0,
        catalog,
      }));
    } catch (error) {
      results.push({
        agentKey: profile.key, name: profile.name, declared: [], checks: [], missing: [], unknown: [],
        promptLength: 0, toolCount: 0,
        verdict: '编译失败：' + String((error as Error).message ?? error).slice(0, 120),
      });
    }
  }
  return results;
}

export type SkillAuditSummary = {
  agents: number;
  /** 有 skill 未生效的 agent 数。 */
  degraded: number;
  totalDeclared: number;
  totalEffective: number;
};

export function summarizeSkillAudit(audits: readonly SkillAudit[]): SkillAuditSummary {
  return {
    agents: audits.length,
    degraded: audits.filter(a => a.missing.length > 0 || a.unknown.length > 0 || a.promptLength === 0).length,
    totalDeclared: audits.reduce((n, a) => n + a.declared.length, 0),
    totalEffective: audits.reduce((n, a) => n + a.checks.filter(c => c.present).length, 0),
  };
}
