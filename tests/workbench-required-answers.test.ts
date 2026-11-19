import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('必答全部答复前保留同一待执行轮，定时事件不绕过，告知卡片与其他工单不受阻', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-required-'));
  process.env.COLLAB_STATE_DIR = dir;
  const fixture = path.join(dir, 'agent.mjs');
  const trace = path.join(dir, 'trace.jsonl');
  const forged = path.join(dir, 'forged-card.json');
  await mkdir(path.join(dir, 'console'));
  await writeFile(fixture, [
    "import {readFileSync,appendFileSync} from 'node:fs';",
    "const c = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "appendFileSync(process.argv[2], JSON.stringify(c)+'\\n');",
    "const task = c.events.find(e=>e.type==='task.request');",
    "if(task.detail.includes('必答') && !c.answers.length) {",
    " console.log('待确认推荐理由验收范围');",
    " console.log('```agent-autoloop\\n'+JSON.stringify({ask:[{key:'scope',title:'确认门店范围',text:'试点哪家门店？',options:['测试门店','另定范围']},{key:'width',title:'确认屏幕宽度',text:'按哪个宽度验收？',options:['360px','另定宽度']}],later:[{key:'review',at:new Date(Date.now()+3000).toISOString(),about:'定时复查'}]})+'\\n```');",
    "} else {const resolve=task.detail.includes('独立')?[{card:JSON.parse(readFileSync(process.argv[3],'utf8')),reason:'尝试代替另一个工单结清'}]:[];console.log('已根据完整答复整理建议');console.log('```agent-autoloop\\n'+JSON.stringify({resolve,notice:[{key:'fyi',title:'核对完成',text:'本轮材料已整理，无需答复。'}]})+'\\n```');}",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('owner', 'test-only-password');
  const owned = process.env.CONTRACTOR_TEST_EXECUTION === 'contractor';
  const cfg = settingsSchema.parse({ executionRuntime: owned ? 'contractor' : 'autoloop', projects: [{ id:'store',title:'门店推荐理由',members:['owner'],maintainers:['owner'],
    dispatch:[{function:'review',agent:'reviewer'}] }],functions:[{id:'review',title:'验收核对'}], agents:[{
    id:'reviewer',title:'核对 Agent',kind:'personal',owner:'owner',function:'review',projects:['store'],
    execution: { kind: 'test', provider: 'fixture' }, engine: 'command',command:[process.execPath,fixture,trace,forged],active:true,capability:'核对推荐理由',skill:'按工单整理',
  }] });
  const work = await openCollaboration(cfg,auth);
  const db = new DatabaseSync(path.join(dir, ...(owned ? ['dispatch', 'hub.sqlite'] : ['autoloop', 'hub.db'])), { readOnly:true });
  t.after(async()=>{db.close();await work.close();await rm(dir,{recursive:true,force:true});});
  async function wait<T>(fn:()=>T|undefined|Promise<T|undefined>):Promise<T> {
    for(let i=0;i<160;i++){const value=await fn();if(value)return value;await delay(100);}
    assert.fail('等待状态超时');
  }
  const start=async(request:string)=>{
    const result=work.start('owner',{project:'store',title:request,request,nonce:randomUUID(),material:[],priority:'normal'});
    return wait(()=>work.resolveStart('owner',result.trigger)??undefined);
  };
  const ticket=await start('门店推荐理由有两项必答');
  const questions=await wait(()=>work.detail('owner',ticket).questions.length===2 ? work.detail('owner',ticket).questions : undefined);
  work.reply('owner',ticket,{card:questions[0]!.id,choice:0,nonce:'answer-one'});
  await wait(()=>work.detail('owner',ticket).questions.length===1 || undefined);
  await delay(4300);
  assert.equal(work.detail('owner',ticket).runs.filter(r=>r.state==='done').length,1);
  assert.throws(()=>work.handoff('owner',ticket,{agent:'reviewer',reason:'尝试换执行端跳过未答问题'}),
    /必答|答复|回答/,'交接也不能结清未答事项');
  const queued=db.prepare("SELECT id FROM runs WHERE lane=? AND state='queued'").get(ticket);
  assert.ok(queued,'定时事件与第一条答复合入原生待执行轮');
  const sequence = db.prepare(owned ? 'SELECT value AS n FROM lease_sequence' : 'SELECT MAX(seq) AS n FROM facts');
  const quietSeq = sequence.get()!.n;
  await delay(1200);
  assert.equal(sequence.get()!.n, quietSeq,
    '等待期间不能因临时过滤反复删除和重建原生due事实');
  await writeFile(forged, JSON.stringify(questions[1]!.id));
  const other=await start('门店推荐理由独立资料整理');
  await wait(()=>work.detail('owner',other).result);
  assert.equal(work.detail('owner',ticket).questions.length,1,'等人的工单不阻塞独立工单');
  const persistedCard = db.prepare(owned ? 'SELECT state FROM cards WHERE id=?'
    : "SELECT json_extract(data,'$.state') AS state FROM projections WHERE collection='cards' AND key=?");
  assert.equal(persistedCard.get(String(questions[1]!.id))?.state, 'open',
    '另单 Agent 即便提供真实卡号，也不能代替人结清必答');
  assert.equal(work.detail('owner',ticket).result,undefined);
  work.reply('owner',ticket,{card:questions[1]!.id,choice:0,nonce:'answer-two'});
  await wait(()=>work.detail('owner',ticket).result);
  const runs=work.detail('owner',ticket).runs;
  assert.equal(runs.length,2);
  assert.equal(runs[1]!.id,queued.id,'恢复原生已排队轮，不另派一次');
  const contexts=(await readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const independent=contexts.find(c=>c.events.some((e:{type:string;detail:string})=>e.type==='task.request'&&e.detail.includes('独立')));
  assert.deepEqual(independent.open, [], '原生同组的另张工单也不得拿到待答正文');
  const resumed=contexts.find(c=>c.answers.length===2);
  assert.ok(resumed,'两份答复都进入下一轮上下文');
  assert.equal(resumed.answers.filter((a:{by:string})=>a.by==='owner').length,2);
  assert.ok(resumed.events.some((e:{type:string})=>e.type==='timer.due'));
});
