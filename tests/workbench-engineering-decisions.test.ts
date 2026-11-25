import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { engineeringDecisions, type DecisionScope } from '../src/workbench/engineering-decisions.ts';

test('项目决策保留原提交，重启后仍需现任负责人答复，回执重放只回传一次', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'engineering-decisions-'));
  const file = path.join(dir, 'state.db');
  let db = new DatabaseSync(file);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const notifications: string[] = [];
  const ports = { notify: (_p: string, _t: string, _s: string, to: string) => { notifications.push(to); }, close: () => {} };
  let ledger = engineeringDecisions(db, ports);
  const before: DecisionScope = { project: 'store', ticket: 'screen', version: 2, sha: 'a'.repeat(40), developer: 'dev',
    requester: 'product', lead: 'lead', maintain: false, active: true, writable: true };
  const input = { action: 'open' as const, direction: 'escalate' as const, nonce: randomUUID(),
    version: before.version, sha: before.sha, text: '小屏布局需要什么改动？' };
  const { id } = ledger.apply('dev', before, input);
  db.close();
  db = new DatabaseSync(file);
  ledger = engineeringDecisions(db, ports);
  assert.deepEqual(ledger.apply('dev', before, input), { id });
  const answer = { action: 'answer' as const, id, text: '保留三档视口验收。' };
  const changed = { ...before, sha: 'b'.repeat(40) };
  assert.equal(ledger.view('dev', changed).records[0]?.stale, true);
  assert.throws(() => ledger.apply('lead', changed, answer), { status: 409 });
  const successor = { ...before, lead: 'next' };
  assert.throws(() => ledger.apply('lead', successor, answer), { status: 403 });
  ledger.apply('next', successor, answer);
  ledger.apply('next', successor, answer);
  assert.deepEqual(notifications, ['lead', 'dev']);
  ledger.apply('dev', successor, { action: 'received', id });
  assert.equal(ledger.forExecution('screen', changed, () => true).length, 0);
  assert.equal(ledger.forExecution('screen', successor, member => member !== 'next').length, 0);
  assert.equal(ledger.forExecution('screen', successor, () => true).length, 1);
});
