import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runtime } from '../config.ts';
import type { Job } from './execution/protocol.ts';
import type { CodeBundle, CodeDelta } from './code-bundle.ts';
import type { RunnerAgent } from './runner-profile.ts';
import { enrollmentToken, type RunnerConnectInput, type RunnerWorker } from './runner-connection.ts';

type Binding = { owner: string; agent: string; projects: string[]; remote?: RunnerAgent; worker?: RunnerWorker };
type Enrollment = RunnerConnectInput & { expires: number; approved?: { actor: string; project?: string; agent?: string } };
export type DeviceState = 'active' | 'suspended' | 'lost' | 'retired';
export type Device = Binding & { id: string; name: string; active: boolean; state: DeviceState; lastSeen: number | null;
  accepting?: boolean; readyEngines?: RunnerWorker['engines'] };
export type DeviceJob = Job & { remote?: { authority: string; code?: CodeBundle; profile?: RunnerAgent } };
export const isRemoteDevice = (row?: Pick<Device, 'remote' | 'worker'>) => !!(row?.remote || row?.worker);
export type ReleasedLease = { run: number; attempt: number; lease: string };
export type RemoteStop = { attempt: number; state: 'exited' | 'not-launched'; model?: string; code?: CodeDelta; usageCoverage?: 'partial' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const onlineWindow = 10_000;

export const deviceHome = (id: string, driver: 'autoloop' | 'contractor' = 'autoloop') =>
  runtime('devices', id, driver === 'contractor' ? 'dispatch' : 'autoloop');

export async function localDeviceKey() {
  const dir = runtime('devices');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'host.key');
  await writeFile(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
  return (await readFile(file, 'utf8')).trim();
}

export class Devices {
  constructor(private readonly db: DatabaseSync, private readonly now = Date.now) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_device_pair (
        hash TEXT PRIMARY KEY, binding TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbench_device (
        id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, value TEXT NOT NULL, seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS workbench_device_enrollment (
        id TEXT PRIMARY KEY, proof TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbench_device_run (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, device TEXT NOT NULL,
        PRIMARY KEY(run,attempt)
      );
      CREATE TABLE IF NOT EXISTS workbench_device_claim (
        device TEXT PRIMARY KEY, claim TEXT NOT NULL, run INTEGER NOT NULL, attempt INTEGER NOT NULL, value TEXT
      );
      CREATE TABLE IF NOT EXISTS workbench_device_stop (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, device TEXT NOT NULL, lease_hash TEXT NOT NULL,
        result_hash TEXT NOT NULL, state TEXT NOT NULL, confirmed INTEGER NOT NULL, PRIMARY KEY(run,attempt)
      );
    `);
    if (!db.prepare('PRAGMA table_info(workbench_device_claim)').all().some(column => column.name === 'lease'))
      db.exec('ALTER TABLE workbench_device_claim ADD COLUMN lease TEXT');
  }

  begin(binding: Binding) {
    const code = randomBytes(12).toString('hex');
    const expires = this.now() + 10 * 60_000;
    this.db.prepare('DELETE FROM workbench_device_pair WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO workbench_device_pair VALUES(?,?,?)').run(hash(code), JSON.stringify(binding), expires);
    return { code, expires };
  }

  pair(code: string, name: string, permitted: (binding: Binding) => boolean, remote = false) {
    const row = this.db.prepare(`DELETE FROM workbench_device_pair WHERE hash=? AND expires>?
      AND COALESCE(json_type(binding,'$.remote')='object',0)=? RETURNING binding`)
      .get(hash(code), this.now(), Number(remote));
    if (!row) return;
    const binding = JSON.parse(String(row.binding)) as Binding;
    if (!permitted(binding)) return;
    return this.register(binding, name, randomUUID(), randomBytes(32).toString('base64url'));
  }

  private register(binding: Binding, name: string, id: string, token: string) {
    const device = { ...binding, id, name, active: true };
    this.db.prepare('INSERT INTO workbench_device VALUES(?,?,?,NULL)').run(id, hash(token), JSON.stringify(device));
    return { id, token, ...(binding.remote && { profile: binding.remote }), ...(binding.worker && { worker: binding.worker }) };
  }

  beginEnrollment(input: RunnerConnectInput, secret: string) {
    this.db.prepare('DELETE FROM workbench_device_enrollment WHERE expires<=?').run(this.now());
    const row = this.db.prepare('SELECT proof,value FROM workbench_device_enrollment WHERE id=?').get(input.id);
    if (row) return row.proof === hash(secret) ? JSON.parse(String(row.value)) as Enrollment : undefined;
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM workbench_device_enrollment').get();
    if (Number(total?.n) >= 500 || this.get(input.id)) return;
    const entry = { ...input, expires: this.now() + 10 * 60_000 };
    this.db.prepare('INSERT INTO workbench_device_enrollment VALUES(?,?,?,?)')
      .run(input.id, hash(secret), JSON.stringify(entry), entry.expires);
    return entry;
  }

  enrollment(id: string) {
    const row = this.db.prepare('SELECT value FROM workbench_device_enrollment WHERE id=? AND expires>?').get(id, this.now());
    return row ? JSON.parse(String(row.value)) as Enrollment : undefined;
  }

  approveEnrollment(id: string, actor: string, project?: string, agent?: string) {
    const current = this.enrollment(id);
    if (!current || current.approved) return false;
    this.db.prepare('UPDATE workbench_device_enrollment SET value=? WHERE id=?')
      .run(JSON.stringify({ ...current, approved: { actor, project, agent } }), id);
    return true;
  }

  finishEnrollment(id: string, secret: string, authorize: (entry: Enrollment) => Binding | undefined) {
    let token = enrollmentToken(id, secret);
    let current = this.byToken(token);
    if (!current) {
      const previous = enrollmentToken(id, secret, true);
      current = this.byToken(previous);
      if (current) token = previous;
    }
    if (current?.id === id && current.worker && current.active) {
      const binding = authorize({ id, name: current.name, engines: current.worker.engines, mode: 'worker', expires: 0,
        approved: { actor: current.owner } });
      if (binding?.worker) return { id, token, worker: binding.worker };
      return;
    }
    if (current?.id === id && current.active && current.projects.length === 1
      && (current.remote?.engine === 'codex' || current.remote?.engine === 'claude')) {
      const binding = authorize({ id, name: current.name, engines: [current.remote.engine], expires: 0,
        approved: { actor: current.owner, project: current.projects[0]!, agent: current.agent } });
      if (binding?.remote && JSON.stringify(current.remote) === JSON.stringify(binding.remote))
        return { id, token, profile: binding.remote };
      return;
    }
    const row = this.db.prepare('SELECT proof,value FROM workbench_device_enrollment WHERE id=? AND expires>?').get(id, this.now());
    if (!row || row.proof !== hash(secret)) return;
    const entry: Enrollment = JSON.parse(String(row.value));
    if (!entry.approved) return { pending: true as const };
    const binding = authorize(entry);
    if (!binding || !isRemoteDevice(binding)) return;
    if (this.get(id)) return;
    return this.register(binding, entry.name, id, token);
  }

  private decode(row: Record<string, unknown>): Device {
    const value = JSON.parse(String(row.value));
    return { ...value, state: value.state ?? (value.active ? 'active' : 'suspended'), lastSeen: row.seen === null ? null : Number(row.seen) };
  }

  get(id: string) {
    const row = this.db.prepare('SELECT value,seen FROM workbench_device WHERE id=?').get(id);
    return row && this.decode(row);
  }

  byToken(token: string) {
    const row = this.db.prepare('SELECT value,seen FROM workbench_device WHERE token=?').get(hash(token));
    return row && this.decode(row);
  }

  list() {
    return this.db.prepare('SELECT value,seen FROM workbench_device ORDER BY rowid').all().map(row => this.decode(row));
  }

  setProjects(id: string, projects: string[]) {
    this.db.prepare("UPDATE workbench_device SET value=json_set(value,'$.projects',json(?)) WHERE id=?")
      .run(JSON.stringify(projects), id);
  }

  private connected(device: Device) {
    return device.active && device.lastSeen !== null && this.now() - device.lastSeen < onlineWindow;
  }

  online(device: Device) {
    return this.connected(device) && device.accepting !== false;
  }

  claimsPaused(device: Device) {
    return this.connected(device) && device.accepting === false;
  }

  heartbeat(id: string, online = true, accepting = true, engines?: RunnerWorker['engines']) {
    this.db.prepare("UPDATE workbench_device SET seen=?,value=json_set(value,'$.accepting',json(?),'$.readyEngines',json(?)) WHERE id=?")
      .run(online ? this.now() : null, JSON.stringify(accepting), JSON.stringify(engines ?? []), id);
  }

  active(id: string, active: boolean) {
    return this.transition(id, active ? 'active' : 'suspended');
  }

  transition(id: string, state: DeviceState) {
    const old = this.get(id);
    if (!old) throw new Error('找不到执行端');
    if (old.state === 'retired' && state !== 'retired') throw new Error('已退役执行端不能恢复接单，请重新配对');
    this.db.prepare("UPDATE workbench_device SET value=json_set(value,'$.active',json(?),'$.state',?) WHERE id=?")
      .run(JSON.stringify(state === 'active'), state, id);
  }

  leasedTo(run: number, attempt?: number): string | undefined {
    const row = attempt === undefined
      ? this.db.prepare('SELECT device FROM workbench_device_run WHERE run=? ORDER BY attempt DESC LIMIT 1').get(run)
      : this.db.prepare('SELECT device FROM workbench_device_run WHERE run=? AND attempt=?').get(run, attempt);
    return typeof row?.device === 'string' && row.device ? row.device : undefined;
  }

  bindRun(run: number, attempt: number, device?: string) {
    this.db.prepare('INSERT OR IGNORE INTO workbench_device_run VALUES(?,?,?)').run(run, attempt, device ?? '');
  }

  hold(device: string, claim: string, job: Job) {
    this.db.prepare('INSERT OR REPLACE INTO workbench_device_claim(device,claim,run,attempt,lease) VALUES(?,?,?,?,?)')
      .run(device, claim, job.run, job.attempt, job.token);
  }

  prepared(device: string, job: DeviceJob) {
    this.db.prepare('UPDATE workbench_device_claim SET value=? WHERE device=? AND run=? AND attempt=?')
      .run(JSON.stringify(job), device, job.run, job.attempt);
  }

  held(device: string) {
    const row = this.db.prepare('SELECT claim,run,attempt,value,lease FROM workbench_device_claim WHERE device=?').get(device);
    return row && { claim: String(row.claim), run: Number(row.run), attempt: Number(row.attempt),
      lease: typeof row.lease === 'string' ? row.lease : undefined,
      job: row.value ? JSON.parse(String(row.value)) as DeviceJob : undefined };
  }

  verifyStop(device: string, run: number, lease: string, stop: RemoteStop, receipt: unknown) {
    if (this.leasedTo(run, stop.attempt) !== device) return false;
    const receiptHash = hash(JSON.stringify({ stop, receipt }));
    const leaseHash = hash(lease);
    const prior = this.db.prepare('SELECT * FROM workbench_device_stop WHERE run=? AND attempt=?').get(run, stop.attempt);
    if (prior) return prior.device === device && prior.lease_hash === leaseHash && prior.result_hash === receiptHash;
    const held = this.held(device);
    if (held?.run !== run || held.attempt !== stop.attempt || held.lease !== lease) return false;
    this.db.prepare('INSERT INTO workbench_device_stop VALUES(?,?,?,?,?,?,?)')
      .run(run, stop.attempt, device, leaseHash, receiptHash, stop.state, this.now());
    return true;
  }

  clear(device: string, run: number, attempt: number) {
    this.db.prepare('DELETE FROM workbench_device_claim WHERE device=? AND run=? AND attempt=?').run(device, run, attempt);
  }
}
