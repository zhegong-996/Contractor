import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('原生 CLI 的脱离进程组子进程退出后才确认停止并交接', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'suitme-descendants-'));
  process.env.COLLAB_STATE_DIR = directory;
  await mkdir(path.join(directory, 'console'));
  const marks = path.join(directory, 'marks.jsonl');
  const child = path.join(directory, 'child.mjs');
  const fixture = path.join(directory, 'parent.mjs');
  await writeFile(child, [
    "import {appendFileSync} from 'node:fs';",
    "const mark = event => appendFileSync(process.argv[2], JSON.stringify({event,pid:process.pid,at:Date.now()}) + '\\n');",
    "mark('child.started');",
    "let stopping = false;process.on('SIGTERM',()=>{if(stopping)return;stopping=true;mark('child.stopping');setTimeout(()=>{mark('child.stopped');process.exit(0)},1800)});",
    'setInterval(()=>{},100);',
  ].join('\n'));
  await writeFile(fixture, [
    "import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';",
    'const [mode,marks,child] = process.argv.slice(2);',
    "const mark = event => appendFileSync(marks, JSON.stringify({event,pid:process.pid,at:Date.now()}) + '\\n');",
    "if(mode==='old'){spawn(process.execPath,[child,marks],{detached:true,stdio:'ignore'}).unref();mark('parent.started');process.on('SIGTERM',()=>{mark('parent.stopped');process.exit(0)});setInterval(()=>{},100)}",
    "else {mark('replacement.started');console.log('门店推荐理由核对完成')}",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'only-for-unit-test');
  for (const name of ['maker', 'replacement']) await auth.createAccount(name, 'only-for-unit-test', 'operator', 'owner');
  const agent = (id: string, owner: string) => ({ id, title: id, owner, projects: ['store'], kind: 'personal', engine: 'command',
    command: [process.execPath, fixture, id, marks, child], function: 'review', capability: '核对门店理由', skill: '核对试点要求', active: true });
  const config = settingsSchema.parse({ projects: [{ id: 'store', title: '门店推荐理由', members: ['owner', 'maker', 'replacement'],
    maintainers: ['owner'], dispatch: [{ agent: 'old', function: 'review' }] }], functions: [{ id: 'review', title: '需求核对' }],
    agents: [agent('old', 'maker'), agent('replacement', 'replacement'), { ...agent('quick', 'maker'), command: ['/usr/bin/printf', '快速完成\n'] }] });
  const work = await openCollaboration(config, auth);
  let childPid: number | undefined;
  t.after(async () => {
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
    await work.close();
    await rm(directory, { recursive: true, force: true });
  });
  const records = async (): Promise<{ event: string; pid: number; at: number }[]> =>
    (await readFile(marks, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const wait = async <T>(fn: () => T | undefined | Promise<T | undefined>) => {
    for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await delay(100); }
    assert.fail('等待进程或交接状态超时');
  };
  const opening = work.start('owner', { project: 'store', agent: 'old', title: '门店推荐理由停止验证', request: '核对门店推荐理由',
    nonce: 'detached-child', material: [], priority: 'normal' });
  const ticket = await wait(() => work.resolveStart('owner', opening.trigger) ?? undefined);
  const started = await wait(async () => (await records()).find(record => record.event === 'child.started'));
  childPid = started.pid;
  const group = Number(execFileSync('ps', ['-p', String(childPid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
  assert.equal(group, childPid, '子进程确实创建独立进程组');
  const runDirectory = path.join(directory, 'autoloop', 'worker', 'runs');
  const ledger = await wait(async () => {
    for (const item of await readdir(runDirectory)) {
      const value = await readFile(path.join(runDirectory, item, 'suitme-processes.json'), 'utf8').catch(() => 'null');
      const parsed = JSON.parse(value);
      if (parsed?.processes.some((p: { pid: number }) => p.pid === childPid)) return parsed;
    }
  });
  assert.ok(!ledger.roots.includes(childPid), '子进程不在原生根组内');
  assert.ok(!JSON.stringify(ledger).includes(child), '追踪文件不保存命令参数或路径正文');
  work.handoff('owner', ticket, { agent: 'replacement', reason: '由另一成员接续' });
  await wait(async () => (await records()).find(record => record.event === 'parent.stopped'));
  assert.equal(work.detail('owner', ticket).work.agent, 'old');
  assert.ok(!(await records()).some(record => record.event === 'replacement.started'));
  await wait(() => work.detail('owner', ticket).result);
  const final = await records();
  assert.ok(final.find(record => record.event === 'child.stopped')!.at < final.find(record => record.event === 'replacement.started')!.at);
  assert.equal(final.filter(record => record.event === 'replacement.started').length, 1);
  assert.deepEqual(work.detail('owner', ticket).runs.map(run => run.state), ['cancelled', 'done']);
  for (let i = 0; i < 3; i++) {
    const quick = work.start('owner', { project: 'store', agent: 'quick', title: '短命令退出验证', request: '运行一个立即退出的受托命令',
      nonce: 'quick-' + i, material: [], priority: 'normal' });
    const quickTicket = await wait(() => work.resolveStart('owner', quick.trigger) ?? undefined);
    await wait(() => work.detail('owner', quickTicket).runs.find(run => run.state === 'done' || run.state === 'nothing'));
    work.stop('owner', quickTicket);
  }
});
