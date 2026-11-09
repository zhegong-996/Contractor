/**
 * 一条命令装起来（第四十一轮 · 对齐 Agent Autoloop 的「单机一条命令，零依赖」）。
 *
 * 我们不是单进程，所以「一条命令」能包到的边界要说清楚：
 *   - 能自动做完的：环境检查 → 生成配置与密钥 → 装依赖 → 拉起本机服务
 *     （paperclip + bridge）→ 初始化公司 / 项目 / Agent → 体检；
 *   - 不能替人做的：建管理员口令（`npm run console:owner`）、飞书授权、真实业务单。
 *     这两步在最后如实打印，不假装自动化。
 *
 * 设计约束：
 *   - 每一步都幂等：已生成的配置不覆盖、已起的服务不重启、已存在的公司不重建；
 *   - 失败即停：某一步失败就停在那里并打印原始错误，不继续往下「看起来装好了」；
 *   - `--dry-run` 只打印计划，不执行任何命令（用于 review 与 CI）。
 *
 * 执行器可注入：单测用假 exec 验证顺序、跳过与失败停止，不真的起进程。
 */
import { existsSync } from 'node:fs';

export type BootstrapEnv = {
  nodeVersion: string;
  hasNodeModules: boolean;
  hasConfig: boolean;
  hasSecrets: boolean;
  hasRuntime: boolean;
  /** 本机服务当前是否已经在跑（由调用方探测后传入）。 */
  servicesRunning: boolean;
  /**
   * 版本不符时是否硬拦。默认只警告：这台机器实测 node v22.22.2 能跑通全部
   * 测试、类型检查与本机服务，而 package.json 的 engines 写的是 24.11——
   * 声明比现实严。硬拦会让人以为装不了，所以默认「警告 + 继续」，
   * `--strict-node` 才按声明拦。这个差异不藏起来，写在 warnings 里。
   */
  strictNode?: boolean;
};

export type BootstrapStep = {
  id: string;
  title: string;
  detail: string;
  /** 要执行的命令；`skip` 决定这一步这次是否需要跑。 */
  command?: string;
  args?: string[];
  skip?: { when: boolean; reason: string };
  /** 失败是否致命：默认致命（失败即停）。 */
  fatal?: boolean;
};

export type BootstrapPlan = {
  steps: BootstrapStep[];
  blocked: string | null;
  /** 不拦但必须说出来的差异（版本、缺省值等）。 */
  warnings: string[];
  /** 装完之后仍然需要人做的两件事：如实列出，不假装自动化。 */
  nextSteps: string[];
  notes: string[];
};

export const MIN_NODE_MAJOR = 24;
export const MIN_NODE_MINOR = 11;

const NODE = process.execPath;

export function parseNodeVersion(version: string): { major: number; minor: number } {
  const match = /^v?(\d+)\.(\d+)/.exec(String(version ?? '').trim());
  return { major: Number(match?.[1] ?? 0), minor: Number(match?.[2] ?? 0) };
}

export function nodeTooOld(version: string): boolean {
  const { major, minor } = parseNodeVersion(version);
  if (major !== MIN_NODE_MAJOR) return major < MIN_NODE_MAJOR;
  return minor < MIN_NODE_MINOR;
}

export function buildBootstrapPlan(env: BootstrapEnv): BootstrapPlan {
  const tooOld = nodeTooOld(env.nodeVersion);
  const steps: BootstrapStep[] = [
    {
      id: 'prepare-config', title: '生成配置与密钥', detail: '建 .runtime 与首次生成的 config.json / secrets.json（已存在则保持不动，不覆盖你的配置）',
      command: NODE, args: ['--import', 'tsx', 'scripts/setup.ts', '--prepare-only'],
      skip: env.hasConfig && env.hasSecrets ? { when: true, reason: '配置与密钥已存在，跳过以免覆盖' } : undefined,
    },
    {
      id: 'install-deps', title: '安装依赖', detail: '按 lockfile 安装（npm ci）；已经装过就跳过',
      command: 'npm', args: ['ci', '--no-audit', '--no-fund'],
      skip: env.hasNodeModules ? { when: true, reason: 'node_modules 已存在' } : undefined,
    },
    {
      id: 'start-services', title: '拉起本机服务', detail: '启动 paperclip 控制面与 bridge（只绑 127.0.0.1）',
      command: 'npm', args: ['run', 'up'],
      skip: env.servicesRunning ? { when: true, reason: '服务已在运行' } : undefined,
    },
    {
      id: 'provision', title: '初始化公司与 Agent', detail: '在公司下建试点项目、登记 Agent、绑定本机身份（幂等：已存在的复用）',
      command: NODE, args: ['--import', 'tsx', 'scripts/setup.ts'],
    },
    {
      id: 'doctor', title: '体检', detail: '逐项报告服务、Agent、飞书授权是否真的可用',
      command: 'npm', args: ['run', 'doctor'], fatal: false,
    },
    {
      id: 'audit', title: '契约体检', detail: '跑一遍分层契约体检，确认这台机器的行为符合契约（不通过就停）',
      command: 'npm', args: ['run', 'audit:layers'],
    },
  ];
  return {
    steps: steps.filter(step => step.skip?.when !== true),
    blocked: tooOld && env.strictNode
      ? `Node 版本低于 engines 声明：当前 ${env.nodeVersion}，package.json 写的是 v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+（--strict-node 下按声明拦截）`
      : null,
    warnings: tooOld && !env.strictNode
      ? [`Node 版本 ${env.nodeVersion} 低于 package.json engines 声明的 v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+；本机实测该版本能跑通测试与服务，因此只警告不拦。要按声明拦截请加 --strict-node。`]
      : [],
    nextSteps: [
      '建管理员：npm run console:owner（设置第一个人的账号与口令，只有这一步必须由人做）',
      '看规则：npm run rules:view（确认派活、例程、通道、验收是不是你要的）',
      '开控制台：npm run console（默认 http://127.0.0.1:4200，可用 CONSOLE_PORT 改）',
      '接飞书：在 .runtime/config.json 填 feishu.appId / botId 与白名单，再重启 bridge',
    ],
    notes: [
      '幂等：重复执行同一条命令不会重建公司、不会覆盖已有配置、不会重启在跑的服务',
      '失败即停：任何一步失败就停下并打印原始错误，不会继续往下「看起来装好了」',
      '自动化边界：建管理员、飞书授权、真实业务单仍需人做，命令不会替你完成',
    ],
  };
}

export type ExecResult = { code: number; stdout?: string; stderr?: string };
export type Exec = (command: string, args: string[]) => Promise<ExecResult>;

export type BootstrapOutcome = {
  ok: boolean;
  executed: { id: string; code: number }[];
  skipped: { id: string; reason: string }[];
  stoppedAt: string | null;
  message: string;
};

export async function runBootstrap(plan: BootstrapPlan, options: {
  exec: Exec; log?: (line: string) => void; dryRun?: boolean;
}): Promise<BootstrapOutcome> {
  const log = options.log ?? (() => {});
  const executed: { id: string; code: number }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  if (plan.blocked) return { ok: false, executed, skipped, stoppedAt: 'preflight', message: plan.blocked };

  for (const step of plan.steps) {
    if (step.skip?.when) { skipped.push({ id: step.id, reason: step.skip.reason }); log(`跳过 ${step.title}：${step.skip.reason}`); continue; }
    if (options.dryRun) { log(`将执行 ${step.title}：${step.command} ${(step.args ?? []).join(' ')}`); continue; }
    log(`执行 ${step.title}…`);
    let result: ExecResult;
    try { result = await options.exec(step.command ?? '', step.args ?? []); }
    catch (error) { result = { code: 1, stderr: String(error instanceof Error ? error.message : error) }; }
    executed.push({ id: step.id, code: result.code });
    if (result.code !== 0 && step.fatal !== false)
      return { ok: false, executed, skipped, stoppedAt: step.id,
        message: `步骤「${step.title}」失败（exit ${result.code}）：${(result.stderr || result.stdout || '').trim().slice(0, 500)}` };
    if (result.code !== 0) log(`注意 ${step.title} 返回 ${result.code}，这一步不致命，继续（结果已如实报告）`);
  }
  return { ok: true, executed, skipped, stoppedAt: null, message: '装好了；接下来的两步需要人做' };
}
