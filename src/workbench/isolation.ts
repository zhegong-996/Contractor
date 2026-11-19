import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Job } from './execution/protocol.ts';
import type { Usage } from './execution/protocol.ts';
import type { Turn } from './execution/protocol.ts';
import { codexProgram } from './execution/cli.ts';
import { runtime } from '../config.ts';
import { allowedFile } from '../github.ts';
import { bundleHash, codeBundleSchema, codeDeltaSchema, materializeCode, type CodeBundle, type CodeDelta } from './code-bundle.ts';
import type { RunnerAgent } from './runner-profile.ts';
import { readCodexCatalog } from './codex-catalog.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const scopeRoot = (scope: string) => runtime('isolated', scope);
const launchFile = (run: number, attempt: number) => runtime('isolation-launches', `${run}-${attempt}.json`);
const sandboxRuntime = path.dirname(createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/package.json'));
const privateFile = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
};
export type Isolation = {
  scope: string; owner: string; agent: string; provider: string; model: string; credentialVersion: string;
  boundary: 'os-sandbox' | 'remote' | 'test' | 'octop'; executableVersion?: string;
};
type Launch = {
  isolation: Isolation; executable: string; workspace: string; home: string; input: string; temp: string;
  remoteBase?: string; placeholders?: string[]; policy: string; baseline: Record<string, string>; canonical?: string; paths: string[];
};

async function plainPath(file: string) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (info?.isSymbolicLink()) throw new Error('执行资料或凭据路径不能经过符号链接');
  }
}

// A member's authentication slot is provisioned by the host, never by task text or another member's fallback.
async function credential(agent: RunnerAgent) {
  if (!agent.execution?.credential) throw new Error('请为此成员配置独立的模型凭据');
  const file = runtime('member-credentials', agent.owner, agent.execution.credential + '.json');
  // Resolve the trusted state root first (macOS /var is itself a system symlink).
  const parent = await realpath(runtime());
  await plainPath(path.join(parent, 'member-credentials', agent.owner, agent.execution.credential + '.json'));
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > 1024 * 1024) throw new Error('成员凭据须为仅本人可读写的普通文件（0600），不能使用硬链接');
  const bytes = await readFile(file);
  let auth: Record<string, unknown>;
  try { auth = JSON.parse(bytes.toString()); }
  catch { throw new Error('成员凭据格式无法解析，请重新配置'); }
  if (!auth || typeof auth !== 'object' || (!auth.tokens && !auth.OPENAI_API_KEY)) throw new Error('成员 Codex 凭据不完整');
  return { bytes, version: hash(bytes) };
}

const excluded = (file: string) => file.split('/').some(part => ['.git', '.codex', '.cursor', '.entire', 'node_modules'].includes(part)
  || part === '.env' || part.startsWith('.env.'));

async function files(folder: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let size = 0;
  async function walk(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (excluded(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('隔离工作区不能包含符号链接');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) {
        if ((await lstat(path.join(directory, entry.name))).nlink !== 1) throw new Error('隔离文件不能使用硬链接');
        const data = await readFile(path.join(directory, entry.name));
        size += data.length;
        if (size > 64 * 1024 * 1024 || Object.keys(result).length >= 4000) throw new Error('执行文件范围过大，请缩小项目代码范围');
        result[name] = hash(data);
      } else throw new Error('隔离工作区只接受普通文件');
    }
  }
  await walk(folder);
  return result;
}

export function sandboxPolicy(workspace: string, home: string, input: string, executable: string, paths: string[], domains: string[], temp = path.join(home, 'tmp'), readPaths?: string[]) {
  const system = process.platform === 'darwin'
    ? ['/System/Library', '/usr/lib', '/usr/bin', '/usr/share', '/bin', '/sbin', '/Library/Apple', '/private/etc/ssl', '/private/etc/hosts', '/private/etc/resolv.conf', '/private/etc/codex', '/private/var/select/sh']
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ssl', '/etc/ld.so.cache', '/etc/resolv.conf', '/etc/hosts', '/etc/codex', '/proc/self', '/proc/thread-self',
      path.join(sandboxRuntime, 'vendor/seccomp', process.arch, 'apply-seccomp')];
  const literal = (item: string) => ({ path: item, literal: true as const });
  return {
    network: { allowedDomains: domains, deniedDomains: [], allowLocalBinding: false, strictAllowlist: true },
    filesystem: {
      denyRead: ['/'],
      allowRead: [...system, '/etc', '/private/etc', '/dev/null', '/dev/urandom', '/dev/random', '/dev/fd',
        ...(readPaths ? readPaths.map(item => path.join(workspace, item)) : [workspace]), home, input,
        // Codex ships its code-mode host beside the native binary; this directory contains programs, not user state.
        path.dirname(executable), path.resolve(path.dirname(executable), '../codex-path'), temp].map(literal),
      allowWrite: [home, temp, ...paths.map(item => path.join(workspace, item))].map(literal),
      // SRT's compatibility temp paths must not become a shared channel between members.
      denyWrite: ['/tmp/claude', '/private/tmp/claude', path.join(home, 'config.toml'), input,
        path.join(workspace, '.git'), path.join(workspace, '.codex'), path.join(workspace, '.cursor')].map(literal),
    },
  };
}

async function codexExecutable() {
  let executable = realpathSync(codexProgram());
  if (executable.endsWith('.js')) {
    const target = (process.arch === 'arm64' ? 'aarch64' : 'x86_64')
      + (process.platform === 'darwin' ? '-apple-darwin' : '-unknown-linux-musl');
    const pkg = createRequire(executable).resolve('@openai/codex-' + process.platform + '-' + process.arch + '/package.json');
    executable = realpathSync(path.join(path.dirname(pkg), 'vendor', target, 'bin', 'codex'));
  }
  return executable;
}

const catalogCache = new Map<string, { expires: number; result: Promise<{ models: Set<string>; checkedAt: string }> }>();
export async function codexModelCatalog(agent: RunnerAgent) {
  if (agent.engine !== 'codex' || agent.execution?.kind !== 'sandbox' || agent.execution.provider !== 'openai' || !agent.model)
    throw new Error('当前执行端没有经授权的模型目录适配');
  const auth = await credential(agent);
  const executable = await codexExecutable();
  const key = hash(JSON.stringify([agent.owner, agent.execution.credential, auth.version, agent.execution.domains, executable]));
  const now = Date.now();
  const cached = catalogCache.get(key);
  if (cached && cached.expires > now) return cached.result;
  for (const [id, entry] of catalogCache) if (entry.expires <= now) catalogCache.delete(id);
  const result = loadCodexCatalog(executable, auth.bytes, agent.execution.domains).catch(error => {
    if (catalogCache.get(key)?.result === result) catalogCache.delete(key);
    throw error;
  });
  catalogCache.set(key, { expires: now + 60_000, result });
  return result;
}

// Discover capabilities in a fresh sandbox. No ticket, file contents or execution prompt enter this process.
async function loadCodexCatalog(executable: string, auth: Buffer, domains: string[]) {
  const temp = await realpath(await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'contractor-catalog-')));
  const home = path.join(temp, 'home');
  const workspace = path.join(temp, 'work');
  const policy = path.join(temp, 'policy.json');
  try {
    await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(workspace, { mode: 0o700 })]);
    await writeFile(path.join(home, 'auth.json'), auth, { mode: 0o600 });
    await writeFile(path.join(home, 'config.toml'), 'model_provider = "openai"\ncli_auth_credentials_store = "file"\n[features]\napps = false\nmulti_agent = false\n', { mode: 0o600 });
    await privateFile(policy, sandboxPolicy(workspace, home, workspace, executable, [], domains, temp));
    const [command, ...args] = sandboxInvocation({ home, temp, policy }, [executable, 'app-server', '--listen', 'stdio://'], workspace);
    return await readCodexCatalog(command!, args, workspace, path.join(home, 'models_cache.json'));
  } finally { await rm(temp, { recursive: true, force: true }); }
}

/** Prepare an AutoLoop job; no queue, lease, retry or parallel execution is introduced here. */
export async function isolateJob(agent: RunnerAgent, job: Job, authority: unknown, previous?: Isolation,
  code?: { canonical: string; paths: string[] } | { bundle: CodeBundle; paths: string[] }): Promise<{ job: Job; isolation: Isolation }> {
  if (!agent.execution) throw new Error('请配置本轮模型、成员凭据和隔离执行方式');
  if (agent.execution.kind === 'test') {
    if (!process.env.NODE_TEST_CONTEXT) throw new Error('测试执行器只能在 Node 测试进程中使用');
    return { job, isolation: { scope: hash(JSON.stringify(authority)), owner: agent.owner, agent: agent.id,
      provider: agent.execution.provider, model: agent.model ?? 'test-fixture', credentialVersion: 'test', boundary: 'test' } };
  }
  if (!agent.model?.trim()) throw new Error('请明确配置此 Agent 使用的模型');
  if (agent.engine !== 'codex' || agent.execution.provider !== 'openai')
    throw new Error('此 CLI 或模型服务尚未完成隔离适配，不能继承宿主环境执行');
  const auth = await credential(agent);
  const executable = await codexExecutable();
  const executableVersion = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000,
    env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const effort = job.agent.effort ?? agent.execution.effort;
  const isolation: Isolation = { scope: hash(JSON.stringify({ owner: agent.owner, agent, authority, credential: auth.version,
    ...(job.agent.effort && { effort }) })),
    owner: agent.owner, agent: agent.id, provider: agent.execution.provider, model: agent.model,
    credentialVersion: auth.version, boundary: 'os-sandbox', executableVersion };
  // macOS may expose the same data directory via /var and /private/var.
  // Give Seatbelt and the CLI the same canonical paths without broadening its read rules.
  const folder = path.join(await realpath(runtime()), 'isolated', isolation.scope);
  await plainPath(folder);
  const workspace = path.join(folder, 'workspace');
  const home = path.join(folder, 'home');
  const input = path.join(folder, 'input');
  // Unix socket names have a small OS limit. A private short temp root is not shared across runs.
  const temp = await realpath(await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'contractor-')));
  await chmod(temp, 0o700);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  // Reconstruct code from the trusted handoff, never from a different agent's working directory.
  await rm(workspace, { recursive: true, force: true });
  for (const dir of [workspace, home, input, path.join(home, 'tmp')]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }
  if (!existsSync(path.join(home, 'auth.json'))) await writeFile(path.join(home, 'auth.json'), auth.bytes, { mode: 0o600 });
  await writeFile(path.join(home, 'config.toml'), [
    `model = ${JSON.stringify(agent.model)}`, 'model_provider = "openai"', 'approval_policy = "never"',
    'cli_auth_credentials_store = "file"', 'web_search = "disabled"',
    '[features]', 'apps = false', 'multi_agent = false', '[shell_environment_policy]', 'inherit = "core"',
  ].join('\n'), { mode: 0o600 });
  const baseline: Record<string, string> = {};
  if (code && 'canonical' in code) {
    // git supplies a bounded source list. Its metadata, hooks, credentials and private CLI files stay on the host.
    const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: code.canonical, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
    let size = 0;
    for (const name of new Set(names)) {
      if (excluded(name)) continue;
      if (!allowedFile(name, [name])) throw new Error('代码文件路径不合法');
      const source = path.join(code.canonical, name);
      await plainPath(path.join(await realpath(code.canonical), name));
      const stat = await lstat(source).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (!stat) continue;
      if (!stat.isFile() || stat.nlink !== 1 || (size += stat.size) > 64 * 1024 * 1024 || Object.keys(baseline).length >= 4000)
        throw new Error('执行文件范围过大或包含非普通文件');
      const to = path.join(workspace, name);
      await mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
      await copyFile(source, to);
      baseline[name] = hash(await readFile(to));
    }
    for (const item of code.paths) await mkdir(path.dirname(path.join(workspace, item)), { recursive: true, mode: 0o700 });
  }
  if (code && 'bundle' in code) {
    Object.assign(baseline, await materializeCode(workspace, code.bundle));
    for (const item of code.paths) await mkdir(path.dirname(path.join(workspace, item)), { recursive: true, mode: 0o700 });
  }
  // Linux bind mounts need an existing destination for an exact writable file.
  // Empty placeholders are excluded from changes unless the Agent actually writes content.
  const placeholders: string[] = [];
  if (code && process.platform === 'linux') for (const item of code.paths) {
    const file = path.join(workspace, item);
    if (item.endsWith('/')) await mkdir(file, { recursive: true, mode: 0o700 });
    else if (!existsSync(file)) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, '', { flag: 'wx', mode: 0o600 });
      placeholders.push(item);
    }
  }
  const policy = runtime('isolation-launches', `${job.run}-${job.attempt}-policy.json`);
  // SRT restores allowRead mounts after writes under a denyRead root on Linux.
  // A read-only workspace ancestor would hide the narrower writable mounts again.
  // Mount disjoint read files and write scopes instead; the repository remains private.
  const readPaths = code && process.platform === 'linux'
    ? [...Object.keys(baseline).filter(file => !allowedFile(file, code.paths)), ...code.paths] : undefined;
  await privateFile(policy, sandboxPolicy(workspace, home, input, executable, code?.paths ?? [], agent.execution.domains, temp, readPaths));
  const launch: Launch = { isolation, executable, workspace, home, input, temp, policy, baseline, canonical: code && 'canonical' in code ? code.canonical : undefined, paths: code?.paths ?? [],
    remoteBase: code && 'bundle' in code ? bundleHash(code.bundle) : undefined, placeholders };
  await privateFile(launchFile(job.run, job.attempt), launch);
  return { isolation, job: { ...job, session: previous?.scope === isolation.scope ? job.session : null,
    agent: { ...job.agent, use: 'contractor-isolated', model: agent.model, effort,
      command: [launchFile(job.run, job.attempt)] }, rule: { ...job.rule, cwd: workspace } } };
}

/** Called by the native worker in its host process, before it starts the confined CLI. */
export function isolatedCommand(turn: Turn, nativeCommand: (turn: Turn, executable: string) => string[]): string[] {
  const launch: Launch = JSON.parse(readFileSync(turn.command![0]!, 'utf8'));
  const context = path.join(launch.input, path.basename(turn.folder) + '-context.json');
  writeFileSync(context, readFileSync(turn.contextFile), { mode: 0o600 });
  // Seatbelt cannot be installed twice in the same process tree. The mandatory outer SRT policy is
  // stricter than Codex's built-in workspace policy (including reads) and is the enforcement boundary.
  // This argv is only ever returned behind sandboxInvocation; there is no unconfined fallback.
  const argv = nativeCommand({ ...turn, access: 'full', prompt: turn.prompt.replaceAll(turn.contextFile, context), contextFile: context }, launch.executable);
  argv[0] = launch.executable;
  // Home is deliberately scoped for this child; no token, cookie, connector config or NODE_OPTIONS is inherited.
  return sandboxInvocation(launch, argv, context);
}

export function sandboxInvocation(launch: Pick<Launch, 'home' | 'temp' | 'policy'>, argv: string[], context: string): string[] {
  return ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin', 'LANG=en_US.UTF-8', 'SHELL=/bin/sh',
    // rustls otherwise probes the host keychain from inside Seatbelt and can stall before routing discovery.
    'SSL_CERT_FILE=' + (process.platform === 'darwin' ? '/etc/ssl/cert.pem' : '/etc/ssl/certs/ca-certificates.crt'),
    'HOME=' + launch.home, 'CODEX_HOME=' + launch.home, 'TMPDIR=' + launch.temp,
    'CLAUDE_CODE_TMPDIR=' + launch.temp, 'AGENT_AUTOLOOP_CONTEXT=' + context,
    process.execPath, path.join(sandboxRuntime, 'dist/cli.js'), '--settings', launch.policy, '--', ...argv];
}

/** Only call after the native worker and all observed children have exited. */
export async function importIsolatedChanges(run: number, attempt: number, authorized = () => true) {
  const launch: Launch = JSON.parse(await readFile(launchFile(run, attempt), 'utf8'));
  await importWorkspace(launch, authorized);
}

async function importWorkspace(launch: Pick<Launch, 'canonical' | 'workspace' | 'baseline' | 'paths' | 'placeholders'>, authorized: () => boolean) {
  if (!launch.canonical) return;
  const current = await files(launch.workspace);
  for (const file of launch.placeholders ?? []) if (current[file] === hash('')) delete current[file];
  const changed = [...new Set([...Object.keys(current), ...Object.keys(launch.baseline)])]
    .filter(name => current[name] !== launch.baseline[name]);
  // Validate the whole delta before writing any file. Concurrent host edits are not overwritten.
  for (const name of changed) {
    if (!allowedFile(name, launch.paths)) throw new Error('隔离执行产生了授权范围外的代码改动');
    await plainPath(path.join(await realpath(launch.canonical), name));
    const stat = await lstat(path.join(launch.canonical, name)).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('宿主交接文件不能使用硬链接或特殊文件');
    const existing = await readFile(path.join(launch.canonical, name)).then(hash, error => {
      if (error.code === 'ENOENT') return undefined; throw error;
    });
    if (existing !== launch.baseline[name] && existing !== current[name]) throw new Error('交接时宿主代码已变化，需研发核对');
  }
  // Recheck after asynchronous inspection. No API grant mutation can interleave with the bounded synchronous transfer.
  if (!authorized()) throw new Error('导入代码前资料或委托授权已变化');
  for (const name of changed) {
    const target = path.join(launch.canonical, name);
    if (current[name]) {
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(path.join(launch.workspace, name), target);
    } else rmSync(target, { force: true });
  }
}

/** Freeze the same bounded, trusted checkout used by local isolation; no Git credentials leave the host. */
export async function exportCodeBundle(canonical: string, paths: string[]): Promise<CodeBundle> {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: canonical, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  const result: CodeBundle = { paths, files: {} };
  const root = await realpath(canonical);
  let size = 0;
  for (const name of new Set(names)) {
    if (excluded(name)) continue;
    if (!allowedFile(name, [name])) throw new Error('代码路径不合法');
    const source = path.join(root, name);
    await plainPath(source);
    const stat = await lstat(source).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!stat) continue;
    if (!stat.isFile() || stat.nlink !== 1 || (size += stat.size) > 8 * 1024 * 1024 || Object.keys(result.files).length >= 4000)
      throw new Error('远端代码范围过大或包含非普通文件');
    result.files[name] = (await readFile(source)).toString('base64');
  }
  return codeBundleSchema.parse(result);
}

export async function exportCodeDelta(run: number, attempt: number): Promise<CodeDelta | undefined> {
  const launch: Launch = JSON.parse(await readFile(launchFile(run, attempt), 'utf8'));
  if (!launch.remoteBase) return;
  const current = await files(launch.workspace);
  for (const file of launch.placeholders ?? []) if (current[file] === hash('')) delete current[file];
  const result: CodeDelta = { base: launch.remoteBase, files: {} };
  for (const name of new Set([...Object.keys(current), ...Object.keys(launch.baseline)])) {
    if (current[name] === launch.baseline[name]) continue;
    if (!allowedFile(name, launch.paths)) throw new Error('远端代码改动超出授权范围');
    result.files[name] = current[name] ? (await readFile(path.join(launch.workspace, name))).toString('base64') : null;
  }
  return codeDeltaSchema.parse(result);
}

export async function importRemoteCode(canonical: string, bundle: CodeBundle, input: CodeDelta, authorized: () => boolean) {
  const delta = codeDeltaSchema.parse(input);
  if (delta.base !== bundleHash(bundle)) throw new Error('远端代码回执基线不匹配');
  const files = { ...bundle.files };
  for (const [name, data] of Object.entries(delta.files)) {
    if (!allowedFile(name, bundle.paths)) throw new Error('远端改动超出授权路径');
    if (data === null) delete files[name]; else files[name] = data;
  }
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'contractor-import-'));
  try {
    await materializeCode(workspace, { paths: bundle.paths, files });
    await importWorkspace({ workspace, canonical, paths: bundle.paths,
      baseline: Object.fromEntries(Object.entries(bundle.files).map(([name, data]) => [name, hash(Buffer.from(data, 'base64'))])) }, authorized);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

export async function discardIsolation(isolation: Isolation) {
  if (isolation.boundary === 'os-sandbox') await rm(scopeRoot(isolation.scope), { recursive: true, force: true });
}

export async function cleanIsolationTemp(run: number, attempt: number) {
  const launch: Launch = JSON.parse(await readFile(launchFile(run, attempt), 'utf8'));
  await rm(launch.temp, { recursive: true, force: true });
}

export async function readIsolation(run: number, attempt: number): Promise<Isolation | undefined> {
  return readFile(launchFile(run, attempt), 'utf8').then(text => (JSON.parse(text) as Launch).isolation, error => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

export async function codexSessionEvidence(isolation: Isolation | undefined, session?: string, includeUsage = false) {
  if (isolation?.boundary !== 'os-sandbox' || !session || !/^[a-zA-Z0-9-]+$/.test(session)) return {};
  const sessions = path.join(scopeRoot(isolation.scope), 'home', 'sessions');
  async function walk(folder: string): Promise<string | undefined> {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { const found = await walk(file); if (found) return found; }
      else if (entry.name.endsWith('-' + session + '.jsonl')) return file;
    }
  }
  const file = await walk(sessions);
  if (!file) return {};
  let model: string | undefined, usage: Usage | undefined;
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    try {
      const row = JSON.parse(line);
      if (row.type === 'turn_context' && typeof row.payload?.model === 'string') model = row.payload.model;
      if (!includeUsage || row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
      const total = row.payload.info?.total_token_usage;
      if (!total) continue;
      const { input_tokens: input, output_tokens: output, cached_input_tokens: cached } = total;
      const valid = (value: number) => Number.isSafeInteger(value) && value >= 0;
      if (valid(input) && valid(output) && (input > 0 || output > 0))
        usage = { input, output, ...(valid(cached) && cached <= input && { cached }) };
    } catch { /* Ignore a malformed or interrupted JSONL record. */ }
  }
  return { model, usage };
}

export async function modelReceipt(isolation: Isolation | undefined, session?: string, runnerModel?: string) {
  if (!isolation) return { verification: 'legacy-unverified' as const };
  const reported = isolation.boundary === 'remote' || isolation.boundary === 'octop' ? runnerModel : (await codexSessionEvidence(isolation, session)).model;
  return { provider: isolation.provider, requested: isolation.model, reported,
    verification: reported ? 'session-reported' as const : 'requested-only' as const };
}
