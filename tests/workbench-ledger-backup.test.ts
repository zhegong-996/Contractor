import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { backupLedger, restoreLedger } from '../src/workbench/ledger-backup.ts';
import { acquireStateLease } from '../src/workbench/state-lease.ts';

test('备份拒绝活跃写入和未结算流程，恢复验证文件摘要与两份账本', async t => {
  const lab = await realpath(await mkdtemp(path.join(os.tmpdir(), 'contractor-ledger-')));
  t.after(() => rm(lab, { recursive: true, force: true }));
  const source = path.join(lab, 'state');
  for (const folder of ['autoloop', 'console']) await mkdir(path.join(source, folder), { recursive: true });
  for (const file of ['console/accounts.json', 'workbench.json', 'secrets.json'])
    await writeFile(path.join(source, file), '{}');
  await writeFile(path.join(source, 'autoloop/master.key'), 'a'.repeat(43));
  const business = new DatabaseSync(path.join(source, 'orchestrator.sqlite'));
  business.exec('PRAGMA journal_mode=WAL; CREATE TABLE workbench_receipt_journal(draft TEXT);'
    + "CREATE TABLE ticket (id TEXT); INSERT INTO ticket VALUES ('example');");
  business.close();
  const work = new DatabaseSync(path.join(source, 'autoloop/hub.db'));
  work.exec("CREATE TABLE runs(state TEXT); INSERT INTO runs VALUES ('claimed');");
  work.close();
  const target = path.join(lab, 'snapshot');
  const release = acquireStateLease(source, 'workbench');
  await assert.rejects(backupLedger(source, target), /正在写入/);
  release();
  const stopIngress = acquireStateLease(source, 'feishu-ingress');
  await assert.rejects(backupLedger(source, target), /feishu-ingress 正在写入/);
  stopIngress();
  await assert.rejects(backupLedger(source, target), /未确认停止/);
  const execute = (file: string, sql: string) => {
    const db = new DatabaseSync(path.join(source, file));
    try { db.exec(sql); } finally { db.close(); }
  };
  execute('autoloop/hub.db', "UPDATE runs SET state='done'");
  execute('orchestrator.sqlite', "INSERT INTO workbench_receipt_journal VALUES ('pending')");
  await assert.rejects(backupLedger(source, target), /尚未结算/);
  execute('orchestrator.sqlite', 'DELETE FROM workbench_receipt_journal');
  assert.equal(await backupLedger(source, target), target);
  const restored = path.join(lab, 'restored');
  assert.equal(await restoreLedger(target, restored), restored);
  await assert.rejects(restoreLedger(target, restored), /已存在/);
  const check = new DatabaseSync(path.join(restored, 'orchestrator.sqlite'), { readOnly: true });
  assert.equal(check.prepare('SELECT id FROM ticket').get()?.id, 'example');
  check.close();
  await writeFile(path.join(target, 'workbench.json'), '{"altered":true}');
  await assert.rejects(restoreLedger(target, path.join(lab, 'bad')), /校验不匹配/);
  await assert.rejects(readFile(path.join(lab, 'bad/workbench.json')), { code: 'ENOENT' });
});

test('Contractor 可恢复原执行、飞书收件箱和 AutoLoop 回滚账本', async t => {
  const lab = await realpath(await mkdtemp(path.join(os.tmpdir(), 'contractor-native-ledger-')));
  t.after(() => rm(lab, { recursive: true, force: true }));
  const source = path.join(lab, 'state');
  for (const folder of ['dispatch', 'console', 'feishu-ingress', 'runtime-archive/autoloop'])
    await mkdir(path.join(source, folder), { recursive: true });
  for (const file of ['console/accounts.json', 'secrets.json']) await writeFile(path.join(source, file), '{}');
  await writeFile(path.join(source, 'workbench.json'), JSON.stringify({ executionRuntime: 'contractor', feishu: { separateIngress: true } }));
  await writeFile(path.join(source, 'execution-driver'), 'contractor');
  const execute = (file: string, sql: string) => {
    const db = new DatabaseSync(path.join(source, file));
    try { db.exec(sql); } finally { db.close(); }
  };
  execute('orchestrator.sqlite', 'CREATE TABLE workbench_receipt_journal(draft TEXT);');
  execute('dispatch/hub.sqlite', "CREATE TABLE runs(id INTEGER, state TEXT); INSERT INTO runs VALUES (21,'unknown');");
  execute('feishu-ingress/inbox.sqlite', "CREATE TABLE inbox(id TEXT); INSERT INTO inbox VALUES ('thread-1');");
  acquireStateLease(source, 'workbench')();
  acquireStateLease(source, 'feishu-ingress')();
  await assert.rejects(backupLedger(source, path.join(lab, 'native')), /未确认停止/);
  execute('dispatch/hub.sqlite', "UPDATE runs SET state='done'");
  await backupLedger(source, path.join(lab, 'native'));
  await restoreLedger(path.join(lab, 'native'), path.join(lab, 'native-restored'));

  execute('runtime-archive/autoloop/hub.db', "CREATE TABLE runs(id INTEGER); INSERT INTO runs VALUES (20);");
  await assert.rejects(backupLedger(source, path.join(lab, 'snapshot')), /回滚材料缺失/);
  const connectionFile = 'assistant-deepseek.private.json';
  const connection = JSON.stringify({ model: 'test-model', revision: 'test-revision', key: 'test-only' });
  await writeFile(path.join(source, connectionFile), connection, { mode: 0o600 });
  await writeFile(path.join(source, 'runtime-archive/autoloop/master.key'), 'a'.repeat(43));
  await backupLedger(source, path.join(lab, 'snapshot'));
  const restored = await restoreLedger(path.join(lab, 'snapshot'), path.join(lab, 'restored'));
  assert.equal(await readFile(path.join(restored, connectionFile), 'utf8'), connection);
  assert.equal((await stat(path.join(restored, connectionFile))).mode & 0o777, 0o600);
  for (const [file, table, expected] of [
    ['dispatch/hub.sqlite', 'runs', { id: 21, state: 'done' }],
    ['runtime-archive/autoloop/hub.db', 'runs', { id: 20 }],
    ['feishu-ingress/inbox.sqlite', 'inbox', { id: 'thread-1' }],
  ] as const) {
    const db = new DatabaseSync(path.join(restored, file), { readOnly: true });
    try { assert.deepEqual({ ...db.prepare('SELECT * FROM ' + table).get() }, expected); }
    finally { db.close(); }
  }
  assert.equal(await readFile(path.join(restored, 'execution-driver'), 'utf8'), 'contractor');
});
