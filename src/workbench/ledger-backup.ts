import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { credential, digest } from '../../upstream/autoloop/kernel/credentials.ts';
import { acquireStateLease, stateLeasePath } from './state-lease.ts';

const required = ['orchestrator.sqlite', 'autoloop/hub.db', 'autoloop/master.key', 'console/accounts.json',
  'workbench.json', 'secrets.json'];
const optional = ['console/rbac_policy.csv', 'console/console-audit.jsonl', 'devices/host.key', 'feishu-ingress/inbox.sqlite'];
const permitted = new Set([...required, ...optional]);
const manifestSchema = z.object({
  version: z.literal(1), at: z.iso.datetime(),
  files: z.array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict();

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function regular(root: string, name: string, needed = true) {
  const candidate = path.join(root, name);
  try {
    if (!(await lstat(candidate)).isFile() || await realpath(candidate) !== candidate)
      throw new Error('账本文件必须为运行目录内的常规文件：' + name);
    return candidate;
  } catch (error) {
    if (!needed && missing(error)) return;
    throw error;
  }
}

async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function ledger(file: string, secret: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  if (file.endsWith('/autoloop/hub.db')) {
    const card = (id: unknown, at: unknown) => credential({ secret, publicUrl: '' }, 'card', id, at);
    db.function('card_token', { deterministic: true }, card);
    db.function('card_hash', { deterministic: true }, (id, at) => digest(card(id, at)));
  }
  return db;
}

async function verifyDatabases(directory: string, entries: string[], requireIdle = false) {
  const key = (await readFile(path.join(directory, 'autoloop/master.key'), 'utf8')).trim();
  for (const name of entries.filter(name => /\.(db|sqlite)$/.test(name))) {
    const db = ledger(path.join(directory, name), key);
    try {
      const checks = db.prepare('PRAGMA integrity_check').all();
      if (checks.length !== 1 || checks[0]?.integrity_check !== 'ok') throw new Error('账本完整性检查失败：' + name);
      if (requireIdle && name === 'autoloop/hub.db' && db.prepare(
        "SELECT 1 FROM runs WHERE state IN ('queued','claimed','unknown') LIMIT 1").get())
        throw new Error('仍有排队、执行中或未确认停止的 AutoLoop 运行。');
      if (requireIdle && name === 'orchestrator.sqlite' && db.prepare(
        'SELECT 1 FROM workbench_receipt_journal WHERE draft IS NOT NULL LIMIT 1').get())
        throw new Error('仍有尚未结算的执行回执。');
    } finally { db.close(); }
  }
}

export async function destination(source: string, requested: string) {
  if (!path.isAbsolute(requested)) throw new Error('备份和恢复目的地须为绝对路径。');
  const result = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  if (result === source || result.startsWith(source + path.sep)) throw new Error('请选源目录之外的空目标。');
  const existing = await lstat(result).catch(error => { if (!missing(error)) throw error; });
  if (existing) throw new Error('目的地已存在，请选一个未创建的目录。');
  return result;
}

export async function staged(target: string, fill: (stage: string) => Promise<void>) {
  const stage = await mkdtemp(path.join(path.dirname(target), '.contractor-ledger-'));
  try {
    await fill(stage);
    const existing = await lstat(target).catch(error => { if (!missing(error)) throw error; });
    if (existing) throw new Error('目的地已被使用，请重试。');
    await rename(stage, target);
    return target;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function fileTarget(stage: string, name: string) {
  const file = path.join(stage, name);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  return file;
}

export async function withStoppedState<T>(source: string, action: () => Promise<T>) {
  // A directory from a pre-lease release cannot prove that its writer has stopped.
  await regular(source, path.basename(stateLeasePath(source, 'workbench')));
  const release = acquireStateLease(source, 'workbench');
  try {
    const inbox = await regular(source, 'feishu-ingress/inbox.sqlite', false);
    const config = JSON.parse(await readFile((await regular(source, 'workbench.json'))!, 'utf8'));
    if (inbox && config.feishu?.separateIngress)
      await regular(source, path.basename(stateLeasePath(source, 'feishu-ingress')));
    const stopIngress = acquireStateLease(source, 'feishu-ingress');
    try {
      return await action();
    } finally { stopIngress(); }
  } finally { release(); }
}

export async function copyLedgerFile(from: string, to: string, key = '') {
  if (/\.(db|sqlite)$/.test(from)) {
    const connection = ledger(from, key);
    try {
      const checks = connection.prepare('PRAGMA integrity_check').all();
      if (checks.length !== 1 || checks[0]?.integrity_check !== 'ok') throw new Error('账本完整性检查失败：' + path.basename(from));
      await writeFile(to, '', { flag: 'wx', mode: 0o600 });
      await backup(connection, to);
    } finally { connection.close(); }
  } else {
    await copyFile(from, to);
    await chmod(to, 0o600);
  }
}

export async function backupLedger(directory: string, output: string) {
  const source = await realpath(directory);
  const target = await destination(source, output);
  return withStoppedState(source, async () => {
    const entries = [...required];
    for (const name of optional) if (await regular(source, name, false)) entries.push(name);
    for (const name of required) await regular(source, name);
    await verifyDatabases(source, entries, true);
    const key = (await readFile(path.join(source, 'autoloop/master.key'), 'utf8')).trim();
    return staged(target, async stage => {
      for (const name of entries) {
        const from = path.join(source, name), to = await fileTarget(stage, name);
        await copyLedgerFile(from, to, key);
      }
      await verifyDatabases(stage, entries);
      const files = await Promise.all(entries.map(async file => ({ file, sha256: await checksum(path.join(stage, file)) })));
      await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ version: 1, at: new Date().toISOString(), files }, null, 2) + '\n',
        { mode: 0o600 });
    });
  });
}

export async function restoreLedger(directory: string, output: string) {
  const source = await realpath(directory);
  const target = await destination(source, output);
  const manifest = manifestSchema.parse(JSON.parse(await readFile((await regular(source, 'manifest.json'))!, 'utf8')));
  const entries = manifest.files.map(row => row.file);
  if (entries.length !== new Set(entries).size || !required.every(name => entries.includes(name)) || !entries.every(name => permitted.has(name)))
    throw new Error('备份清单中的文件范围无效。');
  return staged(target, async stage => {
    for (const row of manifest.files) {
      const from = (await regular(source, row.file))!, to = await fileTarget(stage, row.file);
      await copyFile(from, to);
      await chmod(to, 0o600);
      if (await checksum(to) !== row.sha256) throw new Error('备份校验不匹配：' + row.file);
    }
    await verifyDatabases(stage, entries);
  });
}
