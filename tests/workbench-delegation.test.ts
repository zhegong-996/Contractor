import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import type { CardTransport } from '../src/workbench/feishu-cards.ts';

test('受托 Agent 提子任务：负责人确认、独立子单、验收回流与稳定标识去重', {timeout: 20000}, async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'contractor-delegation-'));
  process.env.COLLAB_STATE_DIR=dir;
  await mkdir(path.join(dir,'console'));
  const parent=path.join(dir,'parent.mjs'),child=path.join(dir,'child.mjs');
  const request={id:'store-reason-review',type:'contractor.delegate',subject:'',summary:'请研发核对',
    detail:JSON.stringify({function:'engineering',title:'核对推荐理由',request:'检查推荐理由是否具体到穿着场景。'})};
  await writeFile(parent,'console.log('+JSON.stringify('已整理门店反馈。\n```agent-autoloop\n'+JSON.stringify({events:[request]})+'\n```')+');');
  await writeFile(child,'console.log("已核对，推荐理由应写明通勤场景。");');
  const [{openCollaboration},{settingsSchema},{ConsoleAuth},{feishuTrigger},{discussionInput}]=await Promise.all([
    import('../src/workbench/collaboration.ts'),import('../src/workbench/config.ts'),import('../src/console-auth.ts'),
    import('../src/upstream.ts'),import('../src/workbench/discussion-intake.ts')]);
  const auth=new ConsoleAuth();await auth.ready();await auth.bootstrapOwner('product','fixture-password-only');
  await auth.createAccount('engineering','fixture-password-only','operator','product');
  const agent=(id:string,owner:string,fn:string,file:string)=>({id,owner,function:fn,projects:['store'],title:id,kind:'specialist',engine:'command',command:[process.execPath,file],
    execution:{kind:'test',provider:'fixture'},active:true,capability:'门店反馈',skill:'依据当前资料执行'});
  const config=settingsSchema.parse({workbenchPublicUrl:'https://suite.example',crossChannel:{},
    feishu:{profile:'fixture',appId:'app',botId:'ou_bot',allowedGroups:['oc_store'],decisionCards:true},
    projects:[{id:'store',title:'门店推荐理由',members:['product','engineering'],maintainers:['product'],
    topics:[{id:'reasons',title:'推荐理由'}],resources:[{source:'feishu',externalId:'oc_store',state:'bound',
      purpose:'discussion',topic:'reasons',feishuTopicRoots:{reasons:'om_root'}}],
    dispatch:[{function:'product',agent:'product-agent'},{function:'engineering',agent:'engineering-agent'}],
    delegations:[{from:'product-agent',to:'engineering',maxChildren:1,maxDepth:1}]}],
    functions:[{id:'product',title:'明确口径'},{id:'engineering',title:'核对实现'},{id:'other-review',title:'额外核对'}],
    agents:[agent('product-agent','product','product',parent),agent('engineering-agent','engineering','engineering',child)]});
  const group: { ref:string; message:string; payload:string }[]=[];
  const messages: string[]=[];
  const updatedGroup=new Map<string,string>();
  const cards: CardTransport = {
    async send(target,_key,payload) {
      if ('user' in target) return {ref:'om_inbox_'+target.user,chat:'oc_private'};
      const ref='om_group_'+group.length;
      group.push({ref,message:target.message,payload});
      return {ref,chat:'oc_store'};
    },
    async update(ref,payload) { if (ref.startsWith('om_group_')) updatedGroup.set(ref,payload); },
  };
  const work=await openCollaboration(config,auth,async message=>{messages.push(message.text);return 'sent';},cards);
  t.after(async()=>{await work.close();await rm(dir,{recursive:true,force:true})});
  async function wait<T>(fn:()=>T|undefined){for(let i=0;i<180;i++){const r=fn();if(r)return r;await delay(60)}assert.fail('等待超时')}
  for (const member of ['product','engineering']) {
    const identity={provider:'feishu' as const,namespace:'app',id:'ou_'+member,label:member};
    assert.ok(work.proveAccount(work.accountProof(member,'feishu').command.split(' ')[1]!,identity));
    work.confirmAccount(member,'feishu',identity);
  }
  const trigger=feishuTrigger({message_id:'om_new',root_id:'om_root',parent_id:'om_root',chat_id:'oc_store',chat_type:'group',
    sender_id:'ou_product',sender_type:'user',content:'核对推荐理由',create_time:String(Date.now()),mentions:[]},'ou_bot','app') as Trigger;
  assert.equal(work.receiveChannel({...discussionInput(trigger,'app'),project:'store',topic:'reasons',
    agent:'product-agent',request:'核对推荐理由'}).status,'pending');
  const id=work.resolveChannel('product',trigger.id,{action:'create',separate:true,agent:'product-agent'}).ticket!;
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
  const groupCard=await wait(()=>group[0]);
  assert.equal(group.length,1);
  assert.equal(groupCard.message,'om_root');
  assert.match(groupCard.payload,/子任务已汇总/);
  assert.match(groupCard.payload,/在工作台查看汇总/);
  assert.doesNotMatch(groupCard.payload,/通勤场景|核对推荐理由/);
  const click=JSON.parse(groupCard.payload).body.elements.find((item: {tag:string})=>item.tag==='interactive_container').behaviors[0].value;
  const callback={...click,ref:groupCard.ref,chat:'oc_store',nonce:'real-group-card'};
  await assert.rejects(work.clickFeishuCard({...callback,operator:'ou_engineering'}),{status:403});
  assert.deepEqual(await work.clickFeishuCard({...callback,operator:'ou_product'}),{changed:true});
  assert.deepEqual(await work.clickFeishuCard({...callback,operator:'ou_product'}),{changed:false});
  const closed=JSON.parse(await wait(()=>updatedGroup.get(groupCard.ref)));
  assert.equal(closed.header.title.content,'已验收');
  assert.ok(!closed.body.elements.some((item: {tag:string})=>item.tag==='interactive_container'));
  const summaryCandidate=work.browse('product','store','').find(row=>row.id===id)!;
  assert.ok('acceptedSource' in summaryCandidate);
  assert.equal(summaryCandidate.acceptedSource?.revision,done.revision);
  assert.deepEqual(summaryCandidate.acceptedSource?.children,[{ticket:opened.ticket,function:'engineering',version:1,
    revision:ready.revision,url:'https://suite.example/#/store/work/'+opened.ticket+'?tab=delivery&revision='+ready.revision}]);
  assert.ok(!messages.some(text=>text.includes('专业意见已准备好')));
  assert.equal(group.length,1);
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

  const stopped=work.start('product',{project:'store',agent:'product-agent',title:'子单停止时不放行主单',
    request:'核对场景',material:[],nonce:randomUUID(),priority:'normal'});
  const stoppedParent=await wait(()=>work.resolveStart('product',stopped.trigger)??undefined);
  const stopDecision=await wait(()=>work.needsYou('product').find(d=>d.kind==='intake'&&d.ticket===stoppedParent));
  const stoppedChild=work.resolveIntake('product',stopDecision.subject,{action:'create',agent:'engineering-agent'}).ticket!;
  work.stop('product',stoppedChild);
  await wait(()=>work.detail('product',stoppedParent).recovery?.kind==='child-result-missing' || undefined);
  assert.equal(work.detail('product',stoppedParent).runs.length,1);
  assert.equal(work.detail('product',stoppedParent).result,undefined);
  assert.ok(!work.needsYou('product').some(d=>d.kind==='acceptance'&&d.ticket===stoppedParent));
  await assert.rejects(work.accept('product',stoppedParent,'a'.repeat(64),'只应等待必需结果',''),{status:409});

  config.projects[0]!.delegations = [...rules,{from:'product-agent',to:'other-review',maxChildren:2,maxDepth:1,
    scope:{title:'另一项必需核对',request:'核对另一个维度',material:[]}}];
  const missing=work.start('product',{project:'store',agent:'product-agent',title:'缺少其中一项必需子任务',
    request:'核对场景',material:[],nonce:randomUUID(),priority:'normal'});
  const missingParent=await wait(()=>work.resolveStart('product',missing.trigger)??undefined);
  const requestMissing=await wait(()=>work.needsYou('product').find(d=>d.kind==='intake'&&d.ticket===missingParent));
  const onlyChild=work.resolveIntake('product',requestMissing.subject,{action:'create',agent:'engineering-agent'}).ticket!;
  const onlyResult=await wait(()=>work.detail('product',onlyChild).result);
  await work.accept('product',onlyChild,onlyResult.revision,'只验收一项','');
  await wait(()=>work.detail('product',missingParent).recovery?.kind==='child-result-missing' || undefined);
  assert.equal(work.detail('product',missingParent).runs.length,1);
  assert.equal(work.detail('product',missingParent).result,undefined);
});
