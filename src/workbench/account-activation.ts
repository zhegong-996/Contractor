import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConsoleRole } from '../console-auth.ts';
import { command } from '../commands.ts';
import type { PlatformActor } from './channel-links.ts';
import { WorkbenchError } from './errors.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Activation = {
  id: string; username: string; issued: number; expires: number; sender: string | null;
  approver: string | null; role: ConsoleRole | null;
};

export async function feishuActivationName(profile: string, sender: PlatformActor): Promise<string | undefined> {
  const response = await command('lark-cli', ['--profile', profile, 'contact', '+get-user', '--as', 'bot', '--user-id', sender.id])
    .then(raw => JSON.parse(raw)).catch(() => undefined);
  const user = response?.data?.user;
  if (response?.ok !== true || response.identity !== 'bot' || user?.open_id !== sender.id || typeof user.name !== 'string'
    || user.is_agent || user.is_cross_tenant === true || user.status?.is_resigned || user.status?.is_frozen || user.status?.is_activated === false) return;
  return user.name.trim().slice(0, 120) || undefined;
}

export class AccountActivation {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_account_activation (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, code TEXT UNIQUE NOT NULL, verifier TEXT NOT NULL,
      issued INTEGER NOT NULL, expires INTEGER NOT NULL, sender TEXT, approver TEXT, role TEXT
    )`);
  }

  begin(username: string) {
    const issued = Date.now();
    this.db.prepare('DELETE FROM workbench_account_activation WHERE expires<=?').run(issued);
    if (Number(this.db.prepare('SELECT count(*) AS n FROM workbench_account_activation').get()?.n) >= 1000)
      throw new WorkbenchError('开通请求较多，请稍后再试。', 429);
    const id = randomBytes(16).toString('hex');
    const code = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('hex');
    const expires = issued + 10 * 60_000;
    this.db.prepare('INSERT INTO workbench_account_activation VALUES (?,?,?,?,?,?,NULL,NULL,NULL)')
      .run(id, username, hash(code), hash(token), issued, expires);
    return { id, token, command: '/开通协作 ' + code, expires };
  }

  awaiting(code: string, sender: PlatformActor, sentAt: string) {
    const at = Date.parse(sentAt);
    return sender.provider === 'feishu' && /^ou_[a-zA-Z0-9_-]{1,140}$/.test(sender.id) && Number.isFinite(at)
      && !!this.db.prepare('SELECT 1 FROM workbench_account_activation WHERE code=? AND issued<=? AND expires>? AND expires>? AND sender IS NULL')
        .get(hash(code), at, at, Date.now());
  }

  verify(code: string, sender: PlatformActor, sentAt: string) {
    if (!this.awaiting(code, sender, sentAt)) return;
    this.db.prepare('UPDATE workbench_account_activation SET sender=?,expires=? WHERE code=? AND sender IS NULL')
      .run(JSON.stringify(sender), Date.now() + 24 * 3600_000, hash(code));
  }

  private read(id: string, token: string) {
    const row = this.db.prepare('SELECT * FROM workbench_account_activation WHERE id=? AND verifier=? AND expires>?')
      .get(id, hash(token), Date.now()) as Activation | undefined;
    if (!row) throw new WorkbenchError('开通请求已失效，请重新发起。', 409);
    return row;
  }

  status(id: string, token: string) {
    const row = this.read(id, token);
    const sender = row.sender ? JSON.parse(row.sender) as PlatformActor : undefined;
    return { state: row.approver ? 'approved' as const : row.sender ? 'verified' as const : 'waiting' as const,
      expires: row.expires, feishuName: sender?.label };
  }

  pending() {
    return (this.db.prepare('SELECT * FROM workbench_account_activation WHERE expires>? AND sender IS NOT NULL AND approver IS NULL ORDER BY issued LIMIT 200')
      .all(Date.now()) as Activation[]).map(row => ({ id: row.id, username: row.username, expires: row.expires,
        sender: JSON.parse(row.sender!) as PlatformActor }));
  }

  approve(id: string, approver: string, role: ConsoleRole) {
    const row = this.db.prepare('SELECT * FROM workbench_account_activation WHERE id=? AND expires>? AND sender IS NOT NULL AND approver IS NULL')
      .get(id, Date.now()) as Activation | undefined;
    if (!row) throw new WorkbenchError('申请已处理或失效。', 409);
    const sender = JSON.parse(row.sender!) as PlatformActor;
    const prior = this.db.prepare(`SELECT 1 FROM workbench_account_activation WHERE expires>? AND approver IS NOT NULL
      AND (username=? OR json_extract(sender,'$.namespace')=? AND json_extract(sender,'$.id')=?)`)
      .get(Date.now(), row.username, sender.namespace, sender.id);
    if (prior) throw new WorkbenchError('这个账号名或飞书身份已有等待本人完成的开通申请。', 409);
    this.db.prepare('UPDATE workbench_account_activation SET approver=?,role=? WHERE id=?').run(approver, role, id);
    return row.username;
  }

  approved(id: string, token: string) {
    const row = this.read(id, token);
    if (!row.sender || !row.approver || !row.role) throw new WorkbenchError('账号开通仍在等待验证或批准。', 409);
    return { username: row.username, sender: JSON.parse(row.sender) as PlatformActor, approver: row.approver, role: row.role };
  }

  consume(id: string) {
    this.db.prepare('DELETE FROM workbench_account_activation WHERE id=?').run(id);
  }
}
