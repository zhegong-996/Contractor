import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runtime } from '../config.ts';
import { formerName } from './compatibility.ts';

type NativeEntry = { driver?: 'contractor'; run: number; attempt: number; token: string; turn: number; pid?: number; result?: unknown; stopping?: number; launchedAt?: number };
type ProcessIdentity = { pid: number; started: string; commandHash: string };
type ProcessView = ProcessIdentity & { parent: number; group: number; state: string };
type ProcessLedger = { run: number; attempt: number; tokenHash: string; processes: ProcessIdentity[]; roots: number[]; finishedBeforeObservation?: number[];
  cancellingAt?: number; signals?: Record<string, 'SIGTERM' | 'SIGKILL'> };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sameProcess = (a: ProcessIdentity, b: ProcessIdentity) => a.pid === b.pid && a.started === b.started && a.commandHash === b.commandHash;

// Process listings use executable names without arguments or environment variables.
function processes(pid?: number): ProcessView[] {
  let value: string;
  try {
    value = execFileSync('ps', [...(pid ? ['-p', String(pid)] : ['-ax']), '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=',
      '-o', 'stat=', '-o', 'lstart=', '-o', 'comm='], { encoding: 'utf8', timeout: 3000,
      env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (pid && (error as { status?: number }).status === 1) return [];
    throw new Error('无法核对执行进程');
  }
  return value.trim().split('\n').filter(Boolean).map(line => {
    const row = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
    if (!row) throw new Error('执行进程状态无法解析');
    return { pid: Number(row[1]), parent: Number(row[2]), group: Number(row[3]), state: row[4]!,
      started: row[5]!.replace(/\s+/g, ' '), commandHash: hash(row[6]!) };
  });
}

function entryFor(run: number, home: string) {
  const base = path.join(home, 'worker', 'runs');
  const folder = readdirSync(base).filter(name => new RegExp('^' + run + '-[0-9]+$').test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .find(name => existsSync(path.join(base, name, 'entry.json')));
  if (!folder) return;
  const file = path.join(base, folder, 'entry.json');
  const entry = JSON.parse(readFileSync(file, 'utf8')) as NativeEntry;
  if (entry.run !== run || !Number.isInteger(entry.attempt) || typeof entry.token !== 'string') throw new Error('执行记录不匹配');
  return { file, entry };
}

function processLedger(file: string, entry: NativeEntry): ProcessLedger {
  const ledgerFile = path.join(path.dirname(file), 'contractor-processes.json');
  const former = path.join(path.dirname(file), formerName('contractor-processes.json'));
  const existing = existsSync(ledgerFile) ? ledgerFile : existsSync(former) ? former : undefined;
  const ledger: ProcessLedger = existing ? JSON.parse(readFileSync(existing, 'utf8'))
    : { run: entry.run, attempt: entry.attempt, tokenHash: hash(entry.token), processes: [], roots: [] };
  if (ledger.run !== entry.run || ledger.attempt !== entry.attempt || ledger.tokenHash !== hash(entry.token)
    || !Array.isArray(ledger.processes) || !Array.isArray(ledger.roots)) throw new Error('执行进程凭据不匹配');
  return ledger;
}

/** Observe from the native launch callback and every heartbeat, before any cancellation can reparent children. */
export function trackWorkerProcesses(run: number, cancel = false, home = runtime('autoloop')): boolean {
  try {
    const record = entryFor(run, home);
    if (!record) return true; // A queued run has no native process yet.
    const { file, entry } = record;
    if (!entry.pid) return entry.turn === 0 || !existsSync(path.join(path.dirname(file), 'command-' + entry.turn + '.sh'));
    const ledger = processLedger(file, entry);
    const snapshot = processes();
    const active = snapshot.filter(p => !p.state.startsWith('Z'));
    const known = new Set(ledger.processes.filter(p => active.some(current => sameProcess(p, current))).map(p => p.pid));
    const root = active.find(p => p.pid === entry.pid);
    let verifiedRoot = !!root && ledger.processes.some(p => sameProcess(p, root));
    if (root && !ledger.roots.includes(root.pid) && root.group === root.pid) {
      try {
        const marker = (entry.driver === 'contractor' ? 'contractor-run:' : 'agent-autoloop-run:') + entry.run + ':' + entry.attempt + ':' + entry.turn;
        if (process.platform === 'linux') {
          // AutoLoop passes the run marker and output paths as distinct shell arguments.
          // Match the exact wrapper because procps lstart rounds the wall-clock start time.
          const folder = path.dirname(file);
          const args = readFileSync('/proc/' + root.pid + '/cmdline', 'utf8').split('\0');
          verifiedRoot = args[0] === '/bin/sh' && args[1] === '-c' && args[3] === marker
            && args[4] === path.join(folder, 'stdout-' + entry.turn + '.log')
            && args[5] === path.join(folder, 'stderr-' + entry.turn + '.log')
            && args[6] === path.join(folder, 'exit-' + entry.turn);
        } else if (typeof entry.launchedAt === 'number' && Math.abs(Date.parse(root.started) - entry.launchedAt) <= 1000) {
          const command = execFileSync('ps', ['-p', String(root.pid), '-ww', '-o', 'command='],
            { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
          verifiedRoot = command.includes(marker);
        }
      } catch { verifiedRoot = false; }
    }
    if (root && verifiedRoot) {
      known.add(root.pid);
      if (!ledger.roots.includes(root.pid)) ledger.roots.push(root.pid);
    }
    if (!root && !ledger.roots.includes(entry.pid) && existsSync(path.join(path.dirname(file), 'exit-' + entry.turn))
      && !active.some(p => p.group === entry.pid)) {
      // A short CLI can finish before the launch callback's first ps snapshot. Keep this evidence distinct from observation.
      ledger.roots.push(entry.pid);
      (ledger.finishedBeforeObservation ??= []).push(entry.pid);
    }
    let added = true;
    while (added) {
      added = false;
      for (const p of active) if (!known.has(p.pid) && known.has(p.parent)) { known.add(p.pid); added = true; }
    }
    for (const p of active.filter(p => known.has(p.pid))) {
      const existing = ledger.processes.findIndex(item => item.pid === p.pid && item.started === p.started);
      const identity = { pid: p.pid, started: p.started, commandHash: p.commandHash };
      if (existing < 0) ledger.processes.push(identity); else ledger.processes[existing] = identity;
    }
    if (cancel || entry.stopping !== undefined) ledger.cancellingAt ??= Date.now();
    const destination = path.join(path.dirname(file), 'contractor-processes.json');
    const save = () => {
      const value = JSON.stringify(ledger);
      if (existsSync(destination) && readFileSync(destination, 'utf8') === value) return;
      writeFileSync(destination + '.tmp', value, { mode: 0o600 });
      renameSync(destination + '.tmp', destination);
    };
    save();
    if (ledger.cancellingAt) {
      const signal = Date.now() - ledger.cancellingAt > 10000 ? 'SIGKILL' : 'SIGTERM';
      if (entry.driver === 'contractor' && root && verifiedRoot) {
        const current = processes(root.pid)[0];
        if (current?.group === current.pid && sameProcess(root, current)) {
          const key = 'group:' + root.pid + ':' + root.started + ':' + root.commandHash;
          if (ledger.signals?.[key] !== signal) {
            try { process.kill(-root.pid, signal); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
            (ledger.signals ??= {})[key] = signal;
            save();
          }
        }
      }
      // The native worker signals the root group. Also signal verified descendants in detached groups.
      for (const identity of ledger.processes) {
        if (ledger.roots.includes(identity.pid)) continue;
        const current = processes(identity.pid)[0];
        if (!current || current.state.startsWith('Z') || current.started !== identity.started) continue;
        if (!sameProcess(identity, current)) return false;
        if (!entry.result && ledger.roots.includes(current.group) && (entry.driver !== 'contractor'
          || active.some(process => process.pid === current.group))) continue;
        const id = identity.pid + ':' + identity.started + ':' + identity.commandHash;
        if (ledger.signals?.[id] === signal) continue;
        try { process.kill(identity.pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
        (ledger.signals ??= {})[id] = signal;
        save();
      }
    }
    return ledger.roots.includes(entry.pid);
  } catch { return false; }
}

/** A finished native root group is insufficient: every observed descendant must have stopped, including detached children. */
export function workerStopped(run: number, attempt: number, token: string, home = runtime('autoloop'), stoppedReceipt?: unknown) {
  try {
    const file = path.join(home, 'worker', 'runs', run + '-' + attempt, 'entry.json');
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    if (entry.run !== run || entry.attempt !== attempt || entry.token !== token || (!entry.result && !(entry.driver === 'contractor' && entry.stopping && stoppedReceipt))) return false;
    if (!entry.pid) return entry.turn === 0 || !existsSync(path.join(path.dirname(file), 'command-' + entry.turn + '.sh'));
    // A completed turn also owns any subprocess it left behind. Stop those before accepting its receipt.
    if (!trackWorkerProcesses(run, true, home)) return false;
    const ledger = processLedger(file, entry);
    const active = processes().filter(p => !p.state.startsWith('Z'));
    return ledger.roots.includes(entry.pid) && !active.some(p => p.group === entry.pid)
      && !ledger.processes.some(p => active.some(current => current.pid === p.pid && current.started === p.started));
  } catch {
    return false;
  }
}
