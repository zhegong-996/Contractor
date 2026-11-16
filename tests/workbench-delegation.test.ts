import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

test('受托 Agent 提子任务：负责人确认、独立子单、验收回流与稳定标识去重', {timeout: 20000}, async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'suitme-delegation-'));
  process.env.COLLAB_STATE_DIR=dir;
  await mkdir(path.join(dir,'console'));
  const parent=path.join(dir,'parent.mjs'),child=path.join(dir,'child.mjs');
  const request={id:'store-reason-review',type:'suitme.delegate',subject:'',summary:'请研发核对',
    detail:JSON.stringify({function:'engineering',title:'核对推荐理由',request:'检查推荐理由是否具体到穿着场景。'})};
  await writeFile(parent,'console.log('+JSON.stringify('已整理门店反馈。\n```agent-autoloop\n'+JSON.stringify({events:[request]})+'\n```')+');');
  await writeFile(child,'console.log("已核对，推荐理由应写明通勤场景。");');
  const [{openCollaboration},{settingsSchema},{ConsoleAuth}]=await Promise.all([
    import('../src/workbench/collaboration.ts'),import('../src/workbench/config.ts'),import('../src/console-auth.ts')]);
  const auth=new ConsoleAuth();await auth.ready();await auth.bootstrapOwner('product','fixture-password-only');
  await auth.createAccount('engineering','fixture-password-only','operator','product');
  const agent=(id:string,owner:string,fn:string,file:string)=>({id,owner,function:fn,projects:['store'],title:id,kind:'specialist',engine:'command',command:[process.execPath,file],
    execution:{kind:'test',provider:'fixture'},active:true,capability:'门店反馈',skill:'依据当前资料执行'});
  const config=settingsSchema.parse({projects:[{id:'store',title:'门店推荐理由',members:['product','engineering'],maintainers:['product'],
    dispatch:[{function:'product',agent:'product-agent'},{function:'engineering',agent:'engineering-agent'}],
    delegations:[{from:'product-agent',to:'engineering',maxChildren:1,maxDepth:1}]}],
    functions:[{id:'product',title:'明确口径'},{id:'engineering',title:'核对实现'}],
    agents:[agent('product-agent','product','product',parent),agent('engineering-agent','engineering','engineering',child)]});
  const work=await openCollaboration(config,auth);
  t.after(async()=>{await work.close();await rm(dir,{recursive:true,force:true})});
  async function wait<T>(fn:()=>T|undefined){for(let i=0;i<180;i++){const r=fn();if(r)return r;await delay(60)}assert.fail('等待超时')}
  const first=work.start('product',{project:'store',agent:'product-agent',title:'门店反馈',request:'核对推荐理由',material:[],nonce:randomUUID(),priority:'normal'});
  const id=await wait(()=>work.resolveStart('product',first.trigger)??undefined);
  const decision=await wait(()=>work.needsYou('product').find(d=>d.kind==='intake'&&d.ticket===id));
  assert.equal(work.detail('product',id).result,undefined,'提出转委托不算父单交付');
  assert.throws(()=>work.resolveIntake('engineering',decision.subject,{action:'create'}),{status:403});
  const opened=work.resolveIntake('product',decision.subject,{action:'create',agent:'engineering-agent'});
  assert.ok(opened.ticket);
  assert.deepEqual(work.resolveIntake('product',decision.subject,{action:'create',agent:'engineering-agent'}),opened);
  const ready=await wait(()=>work.detail('product',opened.ticket!).result);
  assert.equal(work.detail('product',opened.ticket!).work.parent,id);
  assert.equal(work.detail('product',opened.ticket!).work.delegatedVia?.agent,'product-agent');
  await delay(400);
  assert.equal(work.detail('product',id).runs.length,1,'子单未验收时不唤醒父 Agent');
  const rules = config.projects[0]!.delegations;
  config.projects[0]!.delegations = [];
  await assert.rejects(work.accept('product',opened.ticket!,ready.revision,'只验收口径核对',''), {status:409});
  config.projects[0]!.delegations = rules;
  await work.accept('product',opened.ticket!,ready.revision,'只验收口径核对','');
  const done=await wait(()=>work.detail('product',id).result);
  assert.ok(done);
  assert.equal(work.overview('product').tickets.length,2,'重复转委托标识不会再开单');
  assert.equal(work.detail('product',id).runs.length,2);
  const source=work.addKnowledge('product','store',{title:'试点口径',body:'通勤场景是本次测试的口径',kind:'decision',visibility:'project',conditions:'仅试点'});
  const entry=work.browse('product','store','',true).find(e=>e.id===source)!;
  assert.ok('revision' in entry);
  const next=work.start('product',{project:'store',agent:'product-agent',title:'核对后续口径',request:'检查试点口径',material:[source],nonce:randomUUID(),priority:'normal'});
  const nextId=await wait(()=>work.resolveStart('product',next.trigger)??undefined);
  const pending=await wait(()=>work.needsYou('product').find(d=>d.kind==='intake'&&d.ticket===nextId));
  work.invalidateKnowledge('product',source,entry.revision,'测试口径已失效');
  assert.equal(work.needsYou('product').find(d=>d.id===pending.id)?.request,undefined,'依据失效后不再展示提案正文');
  assert.throws(()=>work.resolveIntake('product',pending.subject,{action:'create',agent:'engineering-agent'}),{status:409});
  assert.equal(work.overview('product').tickets.length,3,'失效提案没有生成子单');
});
