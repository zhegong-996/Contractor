// 第六十八轮 · 接入台：对标 LobeHub 的 Connect External Agents。
//
// LobeHub 的做法是「选设备 → 自动扫描 → 显示已装与版本 → 选择 → 接入 → 开对话」，
// 并且明确区分三层权限：连接器权限 / 外部 agent 自身权限 / 设备权限，互不替代。
// 工作目录不是安全沙箱 —— 这句话我们原样保留在界面提示里。
//
// 我们这边对应的现实是：执行端 = 本机一个真实 CLI 进程（codex / claude / …），
// 身份 = config.agents 里的 key（必须先在 paperclip 注册才有 paperclipId 和 token）。
// 所以「接入」这一步拆成三个可验证的状态，而不是一句"已接入"：
//
//   not-installed   本机没有这个命令            → 先装
//   needs-register  CLI 有，但编制里没有这个 key → 可接入
//   needs-enable    编制里有但 enabled=false     → 可一键启用
//   needs-binding   已启用但没有 paperclipId     → 去平台注册后才能派单
//   ready           装了 + 启用 + 已注册          → 可直接派单
//
// 纯探测不写盘；写操作单独走 enable/register，并强制先备份。

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configPath, loadConfig, runtime, type Agent } from './config.ts';

/** 目录项：一个可被扫描的外部执行端。key 与 config.agents 的 key 对齐。 */
export type CatalogEntry = {
  key: string;
  name: string;
  /** 落进 config.agents 时用哪种执行方式。 */
  use: Agent['use'];
  /** PATH 里的命令名。 */
  bin: string;
  versionArgs: string[];
  /** 登录/配置线索：$HOME 下这些路径存在，说明这台机器上大概率已经登录过。 */
  homeHints: string[];
  docs: string;
  note: string;
};

/** 对标 LobeHub 的连接目录；这里只放我们真能探测到、且 use 能对上的。 */
export const EXECUTION_CATALOG: CatalogEntry[] = [
  { key: 'codex', name: 'Codex', use: 'codex', bin: 'codex', versionArgs: ['--version'],
    homeHints: ['.codex'], docs: 'https://github.com/openai/codex',
    note: 'OpenAI 终端编码 agent，能读文件、改代码、跑命令' },
  { key: 'claude', name: 'Claude Code', use: 'claude', bin: 'claude', versionArgs: ['--version'],
    homeHints: ['.claude', '.claude.json'], docs: 'https://code.claude.com/docs/en/setup',
    note: 'Anthropic 终端编码 agent' },
  { key: 'gemini', name: 'Gemini CLI', use: 'command', bin: 'gemini', versionArgs: ['--version'],
    homeHints: ['.gemini'], docs: 'https://github.com/google-gemini/gemini-cli',
    note: 'Google 终端 agent；走自定义命令行接入' },
  { key: 'opencode', name: 'OpenCode', use: 'command', bin: 'opencode', versionArgs: ['--version'],
    homeHints: ['.opencode', '.config/opencode'], docs: 'https://opencode.ai/docs',
    note: '开源编码 agent，支持多模型供应商' },
  { key: 'kimi', name: 'Kimi Code', use: 'command', bin: 'kimi', versionArgs: ['--version'],
    homeHints: ['.kimi'], docs: 'https://kimi.com/code/docs',
    note: 'Moonshot 的编码 CLI' },
  { key: 'cursor', name: 'Cursor', use: 'command', bin: 'cursor', versionArgs: ['--version'],
    homeHints: ['.cursor'], docs: 'https://cursor.com/docs/cli/installation',
    note: 'Cursor 编码 agent；注意 GUI 与 CLI 是两回事' },
  { key: 'amp', name: 'Amp', use: 'command', bin: 'amp', versionArgs: ['--version'],
    homeHints: ['.amp'], docs: 'https://ampcode.com/docs/cli',
    note: 'Amp 编码 agent CLI' },
  { key: 'droid', name: 'Factory Droid', use: 'command', bin: 'droid', versionArgs: ['--version'],
    homeHints: ['.factory'], docs: 'https://docs.factory.ai/droid-cli/quickstart',
    note: 'Factory 的 Droid 编码 agent' },
  { key: 'qoder', name: 'Qoder', use: 'command', bin: 'qoder', versionArgs: ['--version'],
    homeHints: ['.qoder'], docs: 'https://docs.qoder.com/cli/installation',
    note: 'Qoder 编码 agent CLI' },
  { key: 'codebuddy', name: 'CodeBuddy', use: 'command', bin: 'codebuddy', versionArgs: ['--version'],
    homeHints: ['.codebuddy'], docs: 'https://codebuddy.ai/docs/cli/installation',
    note: '腾讯 CodeBuddy Code CLI；要装 CLI 而不是编辑器插件' },
  { key: 'trae', name: 'TRAE CLI', use: 'command', bin: 'trae', versionArgs: ['--version'],
    homeHints: ['.trae'], docs: 'https://docs.trae.cn/cli/get-started-with-trae-cli',
    note: 'TRAE 企业版 CLI' },
];

/** 接入状态：五档，每档对应一个下一步动作，不允许"未知"。 */
export type OnboardingState = 'ready' | 'needs-enable' | 'needs-binding' | 'needs-register' | 'not-installed';

export type ProbeEntry = {
  key: string;
  name: string;
  use: Agent['use'];
  bin: string;
  installed: boolean;
  version: string | null;
  /** 本机是否留下过登录痕迹；不确定时为 null，不猜。 */
  signedIn: boolean | null;
  path: string | null;
  configured: boolean;
  enabled: boolean;
  paperclipBound: boolean;
  state: OnboardingState;
  docs: string;
  note: string;
};

export type DeviceProbe = {
  device: { host: string; platform: string; home: string; at: string };
  entries: ProbeEntry[];
  summary: { ready: number; actionable: number; notInstalled: number; total: number };
};

/** 五档判定：纯函数，输入只有"事实"，不做任何猜测。 */
export function onboardingState(fact: {
  installed: boolean; configured: boolean; enabled: boolean; paperclipBound: boolean;
}): OnboardingState {
  if (!fact.installed) return 'not-installed';
  if (!fact.configured) return 'needs-register';
  if (!fact.enabled) return 'needs-enable';
  if (!fact.paperclipBound) return 'needs-binding';
  return 'ready';
}

async function findOnPath(bin: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* 继续找 */ }
  }
  return null;
}

function versionOf(binPath: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile(binPath, args, { timeout: 2500, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      const text = String(stdout || stderr || '').trim().split('\n')[0] ?? '';
      // --version 常在 stderr 打印，也可能非零退出；有输出就当版本，没输出才算失败。
      resolve(text ? text.slice(0, 80) : null);
    });
  });
}

async function signedInOf(homeHints: readonly string[]): Promise<boolean | null> {
  if (!homeHints.length) return null;
  const home = os.homedir();
  let seen = false;
  for (const hint of homeHints) {
    try { await access(path.join(home, hint)); seen = true; } catch { /* 没有这条线索 */ }
  }
  return seen;
}

/** 扫描本机：并行探测每个目录项，任何一项失败都不影响其它项。 */
export async function probeDevice(agents: Record<string, Agent> = loadConfig().agents): Promise<DeviceProbe> {
  const entries = await Promise.all(EXECUTION_CATALOG.map(async (item): Promise<ProbeEntry> => {
    const binPath = await findOnPath(item.bin);
    const installed = Boolean(binPath);
    const [version, signedIn] = await Promise.all([
      installed ? versionOf(binPath!, item.versionArgs) : Promise.resolve(null),
      signedInOf(item.homeHints),
    ]);
    const configuredAgent = agents[item.key];
    const configured = Boolean(configuredAgent);
    const enabled = Boolean(configuredAgent?.enabled);
    const paperclipBound = Boolean(configuredAgent?.paperclipId);
    return {
      key: item.key, name: item.name, use: item.use, bin: item.bin,
      installed, version, signedIn, path: binPath,
      configured, enabled, paperclipBound,
      state: onboardingState({ installed, configured, enabled, paperclipBound }),
      docs: item.docs, note: item.note,
    };
  }));
  const count = (s: OnboardingState) => entries.filter(e => e.state === s).length;
  return {
    device: { host: os.hostname(), platform: `${process.platform}/${process.arch}`, home: os.homedir(), at: new Date().toISOString() },
    entries,
    summary: {
      ready: count('ready'),
      actionable: entries.filter(e => e.state === 'needs-register' || e.state === 'needs-enable' || e.state === 'needs-binding').length,
      notInstalled: count('not-installed'),
      total: entries.length,
    },
  };
}

/** 写盘前统一备份：时间戳命名、0600、与配置文件同目录。 */
async function backupConfig(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = runtime(`config.backup-${stamp}.json`);
  await copyFile(configPath, target);
  return target;
}

async function readRawConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
}

async function writeRawConfig(value: Record<string, unknown>): Promise<void> {
  await writeFile(configPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export type MutateResult = {
  key: string;
  state: OnboardingState;
  backup: string;
  /** 是否真的改了盘；幂等命中时为 false。 */
  changed: boolean;
  note: string;
};

/**
 * 启用/停用一个已配置的执行端。
 *
 * 只动 `enabled`，不碰 use / access / paperclipId——接入台不替人改执行语义，
 * 那是 agent-execution 那一层的事。
 */
export async function setExecutionEnabled(key: string, enabled: boolean): Promise<MutateResult> {
  const raw = await readRawConfig();
  const agents = (raw.agents ?? {}) as Record<string, Agent>;
  const entry = agents[key];
  if (!entry) throw new Error(`编制里没有执行端 ${key}，请先用「接入」登记`);
  const current = Boolean(entry.enabled);
  if (current === enabled) {
    return { key, state: onboardingState({ installed: Boolean(await findOnPath(key)), configured: true, enabled, paperclipBound: Boolean(entry.paperclipId) }),
      backup: '', changed: false, note: enabled ? '已经是启用状态' : '已经是停用状态' };
  }
  const backup = await backupConfig();
  agents[key] = { ...entry, enabled };
  raw.agents = agents;
  await writeRawConfig(raw);
  return {
    key, changed: true, backup,
    state: onboardingState({ installed: true, configured: true, enabled, paperclipBound: Boolean(entry.paperclipId) }),
    note: enabled ? '已启用；loadConfig 每次读盘，无需重启' : '已停用',
  };
}

export type RegisterInput = {
  key: string;
  /** 执行方式；不传则按目录给的默认值。 */
  use?: Agent['use'];
  name?: string;
  /** 自定义 CLI 才需要。 */
  command?: string[];
  access?: Agent['access'];
};

/**
 * 把一个已装好的执行端登记进编制。
 *
 * 刻意不带 paperclipId：那必须在 paperclip 侧注册后拿到，凭空写会造出一个
 * "看起来能派单、实际派不出去"的假条目。登记后状态是 needs-binding，
 * 这是诚实的——它确实还不能接单。
 */
export async function registerExecution(input: RegisterInput): Promise<MutateResult> {
  const item = EXECUTION_CATALOG.find(c => c.key === input.key);
  const binPath = await findOnPath(item?.bin ?? input.key);
  if (!binPath) throw new Error(`本机找不到命令 ${item?.bin ?? input.key}，先安装再接入`);

  const raw = await readRawConfig();
  const agents = (raw.agents ?? {}) as Record<string, Agent>;
  if (agents[input.key] && agents[input.key].paperclipId) {
    return { key: input.key, changed: false, backup: '',
      state: onboardingState({ installed: true, configured: true, enabled: Boolean(agents[input.key].enabled), paperclipBound: true }),
      note: '编制里已有同 key 的注册执行端，未覆盖' };
  }
  const use = input.use ?? item?.use ?? 'command';
  const next: Agent = {
    name: input.name ?? item?.name ?? input.key,
    mode: 'managed',
    use,
    access: input.access ?? 'read',
    enabled: true,
    ...(input.command ? { command: input.command } : {}),
  } as Agent;
  const backup = await backupConfig();
  agents[input.key] = next;
  raw.agents = agents;
  await writeRawConfig(raw);
  return { key: input.key, changed: true, backup,
    state: onboardingState({ installed: true, configured: true, enabled: true, paperclipBound: false }),
    note: '已登记；还缺 paperclipId，去平台注册后才能派单' };
}

/** 单端体检：只读，回答"这个执行端现在到底能不能跑"。 */
export async function checkExecution(key: string): Promise<{
  key: string; state: OnboardingState; installed: boolean; version: string | null;
  signedIn: boolean | null; binPath: string | null; readyHint: string;
}> {
  const item = EXECUTION_CATALOG.find(c => c.key === key);
  if (!item) throw new Error(`目录里没有执行端 ${key}`);
  const binPath = await findOnPath(item.bin);
  const [version, signedIn] = await Promise.all([
    binPath ? versionOf(binPath, item.versionArgs) : Promise.resolve(null),
    signedInOf(item.homeHints),
  ]);
  const agent = loadConfig().agents[key];
  const state = onboardingState({
    installed: Boolean(binPath), configured: Boolean(agent),
    enabled: Boolean(agent?.enabled), paperclipBound: Boolean(agent?.paperclipId),
  });
  const readyHint = {
    'not-installed': `未安装：按 ${item.docs} 装到这台机器，再重新扫描`,
    'needs-register': '已安装但未登记：点「接入」写进编制',
    'needs-enable': '已登记但停用：点「启用」',
    'needs-binding': '已启用但缺 paperclipId：去平台注册该 agent 后回填',
    ready: '可派单',
  }[state];
  return { key, state, installed: Boolean(binPath), version, signedIn, binPath, readyHint };
}
