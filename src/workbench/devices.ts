import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runtime } from '../config.ts';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';

type Binding = { owner: string; agent: string; projects: string[] };
export type Device = Binding & { id: string; name: string; active: boolean; lastSeen: number | null };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const onlineWindow = 10_000;

export const deviceHome = (id: string) => runtime('devices', id, 'autoloop');

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
      CREATE TABLE IF NOT EXISTS workbench_device_run (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, device TEXT NOT NULL,
        PRIMARY KEY(run,attempt)
      );
      CREATE TABLE IF NOT EXISTS workbench_device_claim (
        device TEXT PRIMARY KEY, claim TEXT NOT NULL, run INTEGER NOT NULL, attempt INTEGER NOT NULL, value TEXT
      );
    `);
  }

  begin(binding: Binding) {
    const code = randomBytes(12).toString('hex');
    const expires = this.now() + 10 * 60_000;
    this.db.prepare('DELETE FROM workbench_device_pair WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO workbench_device_pair VALUES(?,?,?)').run(hash(code), JSON.stringify(binding), expires);
    return { code, expires };
  }

  pair(code: string, name: string, permitted: (binding: Binding) => boolean) {
    const row = this.db.prepare('DELETE FROM workbench_device_pair WHERE hash=? AND expires>? RETURNING binding')
      .get(hash(code), this.now());
    if (!row) return;
    const binding = JSON.parse(String(row.binding)) as Binding;
    if (!permitted(binding)) return;
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const device = { ...binding, id, name, active: true };
    this.db.prepare('INSERT INTO workbench_device VALUES(?,?,?,NULL)').run(id, hash(token), JSON.stringify(device));
    return { id, token };
  }

  private decode(row: Record<string, unknown>): Device {
    return { ...JSON.parse(String(row.value)), lastSeen: row.seen === null ? null : Number(row.seen) };
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

  online(device: Device) {
    return device.active && device.lastSeen !== null && this.now() - device.lastSeen < onlineWindow;
  }

  heartbeat(id: string, online = true) {
    this.db.prepare('UPDATE workbench_device SET seen=? WHERE id=?').run(online ? this.now() : null, id);
  }

  active(id: string, active: boolean) {
    this.db.prepare("UPDATE workbench_device SET value=json_set(value,'$.active',json(?)) WHERE id=?").run(JSON.stringify(active), id);
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
    this.db.prepare('INSERT OR REPLACE INTO workbench_device_claim VALUES(?,?,?,?,NULL)').run(device, claim, job.run, job.attempt);
  }

  prepared(device: string, job: Job) {
    this.db.prepare('UPDATE workbench_device_claim SET value=? WHERE device=? AND run=? AND attempt=?')
      .run(JSON.stringify(job), device, job.run, job.attempt);
  }

  held(device: string) {
    const row = this.db.prepare('SELECT claim,run,attempt,value FROM workbench_device_claim WHERE device=?').get(device);
    return row && { claim: String(row.claim), run: Number(row.run), attempt: Number(row.attempt),
      job: row.value && JSON.parse(String(row.value)) as Job | null };
  }

  clear(device: string, run: number, attempt: number) {
    this.db.prepare('DELETE FROM workbench_device_claim WHERE device=? AND run=? AND attempt=?').run(device, run, attempt);
  }
}
