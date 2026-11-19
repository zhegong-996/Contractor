import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, open, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname, homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { remoteEngine, runnerAgentSchema, runnerOllamaUrl } from './runner-profile.ts';
import { runnerEndpoint, runnerRequestId, runnerSecret } from './runner-connection.ts';
import { configuredEnv, formerName } from './compatibility.ts';

const connectionSchema = z.object({ driver: z.literal('contractor').optional(), id: runnerRequestId, token: runnerSecret, endpoint: runnerEndpoint,
  profile: runnerAgentSchema.refine(remoteEngine) }).strict();
const pendingSchema = z.object({ id: runnerRequestId, secret: runnerSecret, expires: z.number() }).strict();
const resultSchema = z.union([z.object({ pending: z.literal(true) }).strict(), connectionSchema.omit({ endpoint: true })]);
const workerFile = path.join(import.meta.dirname, 'device-client.ts');
const loader = import.meta.resolve('tsx');
const runnerProcesses = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runnerProcesses.abort());

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function executable(name: string) {
  try { return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return undefined; }
}

async function file(filename: string) {
  const info = await lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077) throw new Error('执行端凭据文件必须仅本人可读写');
  return readFile(filename, 'utf8');
}

async function save(filename: string, value: unknown) {
  const temporary = filename + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename).catch(async error => { await unlink(temporary); throw error; });
}

async function call(endpoint: string, action: string, secret: string, data: unknown) {
  const response = await fetch(endpoint + '/api/runner/' + action, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
    redirect: 'error', signal: AbortSignal.any([runnerProcesses.signal, AbortSignal.timeout(8000)]), body: JSON.stringify(data),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { error?: string };
    throw new RequestError(response.status, problem.error ?? '工作台连接请求失败（' + response.status + '）');
  }
  return response.json() as Promise<unknown>;
}

function openPage(url: string) {
  if (process.platform !== 'darwin' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  const opener = process.platform === 'darwin' ? 'open' : executable('xdg-open');
  if (!opener) return;
  const browser = spawn(opener, [url], { stdio: 'ignore', detached: true });
  browser.on('error', () => {});
  browser.unref();
}

async function enroll(folder: string, endpoint: string, browser: boolean, name: string) {
  const pendingFile = path.join(folder, 'pending.json');
  const old = await file(pendingFile);
  const restore = old && pendingSchema.parse(JSON.parse(old));
  async function complete(paired: z.infer<typeof connectionSchema>, id: string) {
    if (paired.id !== id) throw new Error('工作台返回了不同的执行端身份');
    const local = path.join(folder, 'devices', paired.id);
    await mkdir(local, { recursive: true, mode: 0o700 });
    await save(path.join(local, 'connection.json'), paired);
    await save(path.join(folder, 'device.json'), { id: paired.id });
    await unlink(pendingFile);
    console.log('授权已确认（' + paired.profile.id + '）。');
    return paired;
  }
  if (restore) {
    const previous = await call(endpoint, 'enroll-status', restore.secret, { id: restore.id }).catch(error => {
      if (!(error instanceof RequestError) || error.status !== 403) throw error;
    });
    if (previous) {
      const paired = resultSchema.parse(previous);
      if (!('pending' in paired)) return complete(connectionSchema.parse({ ...paired, endpoint }), restore.id);
    }
  }
  const pending = restore && restore.expires > Date.now() ? restore
    : { id: randomUUID(), secret: randomBytes(32).toString('base64url'), expires: Date.now() + 10 * 60_000 };
  const engines = ['codex', 'claude'].filter(executable);
  if (!engines.length) throw new Error('未检测到 Codex 或 Claude Code，请先安装其中一个');
  await save(pendingFile, pending);
  const invite = z.object({ expires: z.number(), verification: z.url() }).strict().parse(
    await call(endpoint, 'enroll', pending.secret, { id: pending.id, name, engines }));
  const url = new URL(invite.verification);
  if (url.href !== endpoint + '/runner/connect/' + pending.id) throw new Error('验证页面与团队工作台地址不一致');
  console.log('请打开浏览器，登录并确认项目和 Agent：\n' + url.href);
  if (browser) openPage(url.href);
  while (Date.now() < invite.expires) {
    await wait(2000, undefined, { signal: runnerProcesses.signal });
    let raw;
    try { raw = await call(endpoint, 'enroll-status', pending.secret, { id: pending.id }); }
    catch (error) {
      if (error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError') continue;
      throw error;
    }
    const paired = resultSchema.parse(raw);
    if ('pending' in paired) continue;
    return complete(connectionSchema.parse({ ...paired, endpoint }), pending.id);
  }
  throw new Error('连接请求已过期，请重新运行同一条命令');
}

async function prepareModel(folder: string, profile: z.infer<typeof runnerAgentSchema>) {
  const cli = executable(profile.engine);
  if (!cli) throw new Error('请在此设备安装已授权的 ' + profile.engine + ' CLI');
  if (profile.engine === 'claude') {
    const list = await fetch(runnerOllamaUrl + '/api/tags', { signal: AbortSignal.timeout(3500), redirect: 'error' })
      .then(response => response.json()).catch(() => ({}));
    const parsed = z.object({ models: z.array(z.object({ name: z.string() })) }).safeParse(list);
    if (!parsed.success || !parsed.data.models.some(model => model.name === profile.model))
      throw new Error('请启动此设备的 Ollama 并准备模型 ' + profile.model + '，再运行同一条连接命令');
    return;
  }
  if (process.platform === 'linux' && ['bwrap', 'socat', 'rg'].some(program => !executable(program)))
    throw new Error('请安装 Linux 隔离依赖 bubblewrap、socat、ripgrep，再运行同一条连接命令');
  const base = path.join(folder, 'member-credentials', profile.owner);
  const target = path.join(base, profile.execution!.credential + '.json');
  if (await file(target)) return;
  const login = path.join(folder, 'codex-login');
  await mkdir(login, { recursive: true, mode: 0o700 });
  const loggedIn = path.join(login, 'auth.json');
  if (!await file(loggedIn)) {
    if (!process.stdin.isTTY) throw new Error('请在交互终端运行同一条连接命令，完成此执行端的 Codex 登录');
    console.log('请为这台执行端登录 Codex。');
    execFileSync(cli, ['login', '--device-auth'], { stdio: 'inherit', env: { ...process.env, CODEX_HOME: login } });
  }
  const auth = await file(loggedIn);
  if (!auth) throw new Error('未取得此执行端的 Codex 登录凭据');
  await mkdir(base, { recursive: true, mode: 0o700 });
  await writeFile(target, auth, { mode: 0o600, flag: 'wx' });
}

async function running(local: string, id: string) {
  const pid = Number(await readFile(path.join(local, 'running.pid'), 'utf8').catch(() => ''));
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-ww', '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (command.includes(workerFile + ' connect ' + id)) return pid;
  } catch { /* The previous worker has exited. */ }
}

async function setupLock(folder: string) {
  const lock = path.join(folder, 'setup.pid');
  const temporary = lock + '.' + randomUUID();
  await writeFile(temporary, String(process.pid), { flag: 'wx', mode: 0o600 });
  try {
    await link(temporary, lock).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const raw = await readFile(lock, 'utf8');
      const pid = Number(raw);
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('无法核对同一连接的准备进程');
      let command = '';
      try { command = execFileSync('ps', ['-p', String(pid), '-ww', '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
      catch { /* The owner may have exited without removing its lock. */ }
      if (command.includes('runner-cli.ts') || await readFile(lock, 'utf8') !== raw)
        throw new Error('同一连接正在准备，请继续使用已打开的终端');
      await unlink(lock);
      await link(temporary, lock);
    });
  } finally { await unlink(temporary); }
  return () => unlink(lock);
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    profile: { type: 'string', default: 'default' },
    name: { type: 'string' }, foreground: { type: 'boolean' }, 'no-browser': { type: 'boolean' },
  } });
  const [action, address] = positionals;
  if (positionals.length !== 2 || !['connect', 'stop'].includes(action ?? ''))
    throw new Error('用法：contractor connect <团队地址> [--profile 名称] [--foreground]，或 contractor stop <团队地址> [--profile 名称]');
  const endpoint = runnerEndpoint.parse(address);
  const profile = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).parse(values.profile);
  const home = configuredEnv('CONTRACTOR_RUNNER_HOME');
  const key = createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
  const current = path.resolve(home ?? path.join(homedir(), '.contractor-runner'), key, profile);
  const former = path.join(homedir(), formerName('.contractor-runner'), key, profile);
  const remembered = (folder: string) => file(path.join(folder, 'device.json')).then(value => value ?? file(path.join(folder, 'pending.json')));
  const folder = !home && !await remembered(current) && await remembered(former) ? former : current;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const release = action === 'connect' ? await setupLock(folder) : undefined;
  try { await run(); }
  finally { await release?.(); }

  async function run() {
    const known = await file(path.join(folder, 'device.json'));
    if (action === 'stop' && !known) return console.log('此连接尚未登记');
    const id = known ? z.object({ id: runnerRequestId }).parse(JSON.parse(known)).id : undefined;
    if (action === 'stop') {
      const pid = await running(path.join(folder, 'devices', id!), id!);
      if (!pid) return console.log('执行端已离线');
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 50 && await running(path.join(folder, 'devices', id!), id!); i++) await wait(200);
      if (await running(path.join(folder, 'devices', id!), id!)) throw new Error('执行端仍在退出，请稍后重试');
      return console.log('接单进程已停止，保留设备身份与待回传记录');
    }
    const connection = id ? connectionSchema.parse(JSON.parse(await file(path.join(folder, 'devices', id, 'connection.json')) ?? 'null'))
      : await enroll(folder, endpoint, !values['no-browser'], z.string().trim().min(1).max(100).parse(values.name ?? hostname()));
    const local = path.join(folder, 'devices', connection.id);
    const existing = await running(local, connection.id);
    if (existing) return console.log('执行端已在运行（' + connection.id + '）');
    await prepareModel(folder, connection.profile);
    const env = { ...process.env, COLLAB_STATE_DIR: folder };
    const args = ['--import', loader, workerFile, 'connect', connection.id];
    if (values.foreground) {
      const worker = spawn(process.execPath, args, { env, stdio: 'inherit' });
      runnerProcesses.signal.addEventListener('abort', () => worker.kill('SIGTERM'), { once: true });
      process.exitCode = await new Promise(resolve => { worker.once('exit', code => resolve(code ?? 1)); worker.once('error', () => resolve(1)); });
      return;
    }
    const logPath = path.join(local, 'runner.log');
    const output = await open(logPath, 'a', 0o600);
    let worker;
    try { worker = spawn(process.execPath, args, { env, detached: true, stdio: ['ignore', output.fd, output.fd] }); }
    finally { await output.close(); }
    worker.on('error', () => {});
    for (let i = 0; i < 40; i++) {
      if (worker.exitCode !== null || !worker.pid) break;
      const ready = await readFile(path.join(local, 'ready.pid'), 'utf8').catch(() => '');
      if (ready === String(worker.pid) || ready === worker.pid + ':paused') {
        worker.unref();
        console.log((ready.endsWith(':paused') ? '执行端已连接，当前暂停接单' : '执行端已上线') + '（' + connection.id + '）');
        return;
      }
      await wait(250, undefined, { signal: runnerProcesses.signal });
    }
    worker.kill('SIGTERM');
    throw new Error('执行端暂未连通，请检查网络或运行日志 ' + logPath);
  }
}

try { await main(); }
catch (error) { console.error(runnerProcesses.signal.aborted ? '连接已中止' : (error as Error).message); process.exitCode = 1; }
