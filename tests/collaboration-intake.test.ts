import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { CollaborationIntake } from '../src/collaboration-intake.ts';
import { askHuman, MemoryHitlSink } from '../src/step-hitl.ts';
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-im-context-')), store = new Store(path.join(dir, 'state.sqlite'));
  const task: any = { id: 'task-one', identifier: 'SUI-1', triggerId: 'private-task', chatId: 'local', messageId: 'local', senderId: 'local-operator',
    agent: 'executor', generation: 1, phase: 'ready', kind: 'collaboration', context: '{}', workspace: '', branch: '' }; store.save(task);
  const state: any = { sources: ['approved-source'], requests: ['approved-request'], history: [], imBinding: { senderId: 'ou_owner', chatId: 'oc_test' } };
  const calls: string[] = []; const w: any = { config: { feishu: { allowedSenders: ['ou_owner'], allowedChats: ['oc_test'], botId: 'ou_bot', appId: 'cli_test' }, paperclipUrl: 'http://localhost:3100' },
    store, state: async () => state, save: async (t: any) => { store.save(t); }, manager: (a: any) => { if (!a.admin) throw new Error('Unauthorized'); } };
  const assistant: any = { delegate: async (_id: string, enabled: boolean) => { calls.push(enabled ? 'resume' : 'pause'); }, taskContext: { note: async () => { calls.push('note'); } } };
  const event = { message_id: 'om_resume', chat_id: 'oc_test', chat_type: 'p2p', sender_id: 'ou_owner', sender_type: 'user', content: '/collab SUI-1 接续', create_time: '1793800000000' };
  return { store, task, state, calls, event, intake: new CollaborationIntake(w, assistant), close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('a real IM command resumes the same pre-bound task once without adding sources or permissions', async () => {
  const f = fixture(); try {
    await f.intake.ingest(f.event); await f.intake.ingest({ ...f.event, event_id: 'another-delivery' });
    assert.equal(f.store.list().length, 1); assert.deepEqual(f.calls, ['resume']); assert.equal(f.store.get(f.task.id).messageId, 'om_resume');
    assert.deepEqual(f.state.sources, ['approved-source']); assert.deepEqual(f.state.requests, ['approved-request']);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get()?.n, 1);
  } finally { f.close(); }
});
test('a whitelist alone cannot control another task that was not bound to this chat and sender', async () => {
  const f = fixture(); try { f.state.imBinding = undefined; await assert.rejects(f.intake.ingest(f.event), /binding/); assert.equal(f.calls.length, 0); }
  finally { f.close(); }
});
test('unapproved senders cannot resume, append background or change a task', async () => {
  const f = fixture(); try { await assert.rejects(f.intake.ingest({ ...f.event, sender_id: 'ou_stranger', content: '/collab SUI-1 authorize everyone' }), /Unauthorized/); assert.equal(f.calls.length, 0); }
  finally { f.close(); }
});
test('pause does not create another task or treat IM text as permission approval', async () => {
  const f = fixture(); try { await f.intake.ingest({ ...f.event, content: '/collab SUI-1 暂停' }); assert.deepEqual(f.calls, ['pause']); assert.equal(f.store.list().length, 1); }
  finally { f.close(); }
});

test('a natural follow-up resumes only the unique bound task and does not acknowledge every message',async()=>{
 const f=fixture();try{await f.intake.ingest({...f.event,content:'刚补充了验收要求，请继续核对'});assert.deepEqual(f.calls,['note','resume']);assert.equal(f.store.list().length,1);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get()?.n,0);}finally{f.close();}
});
test('an ambiguous discussion is not attached to an arbitrary task',async()=>{
 const f=fixture();try{f.store.save({...f.task,id:'task-two',identifier:'SUI-2',triggerId:'second'});const result=await f.intake.ingest({...f.event,content:'继续刚才的工作'});assert.equal(result?.needsTaskReference,true);assert.equal(f.calls.length,0);}finally{f.close();}
});

test('an explicit IM answer routes into the paired HITL ledger and stays advisory (P-10)',async()=>{
 const f=fixture();
 const dir=mkdtempSync(path.join(tmpdir(),'suitme-im-hitl-'));
 const previousLedgerEnv=process.env.COLLAB_HITL_LEDGER;
 process.env.COLLAB_HITL_LEDGER=path.join(dir,'events.jsonl');
 try{
  const sink=new MemoryHitlSink();
  const question=askHuman({runId:'RUN-28',stepNo:1,asker:'step-runner',prompt:'发布前需要真人选择发布窗口',choices:['立即发布','周五低峰发布']});
  sink.append(question);
  const intake=new CollaborationIntake(f.intake.w,f.intake.assistant,undefined,()=>sink);
  const result=await intake.ingest({...f.event,content:'回答 '+question.id+' 立即发布',event_id:'om-answer-1'});
  assert.equal(result?.resumed,true,'补充说明语义不变：仍真实唤醒下一轮');
  const responses=sink.read().filter(e=>e.type==='human_response');
  assert.equal(responses.length,1,'回答已成对写入台账');
  assert.equal(responses[0]!.payload.via,'feishu-im');
  assert.equal(responses[0]!.payload.acceptance,false,'回答绝不冒充验收');
  assert.equal(responses[0]!.to,'step-runner','答案送回提问者（Runner 语义）');
  const loops=f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='loop.downstream'").get() as{n:number};
  assert.equal(loops.n,0,'路由成功时台账是规范留痕，不再重复写 loop.downstream 观察');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get()?.n,1,'给人一条只读回执通知');
  assert.deepEqual(f.calls,['note','resume'],'回答不排后续步骤、不改任务状态');
  // 同一问题第二次回答必须被拒（append-only，不回溯改写）。
  const again=await intake.ingest({...f.event,message_id:'om-answer-2',event_id:'om-answer-2',content:'回答 '+question.id+' 周五低峰发布'});
  assert.equal(again?.resumed,true,'拒绝路由不影响 IM 语义');
  assert.equal(sink.read().filter(e=>e.type==='human_response').length,1);
  const observed=f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='loop.downstream'").get() as{n:number};
  assert.equal(observed.n,1,'路由失败时退回观察留痕，如实可查');
 }finally{
  if(previousLedgerEnv===undefined)delete process.env.COLLAB_HITL_LEDGER;else process.env.COLLAB_HITL_LEDGER=previousLedgerEnv;
  f.close();rmSync(dir,{recursive:true,force:true});
 }
});

test('an IM service request preserves its real origin and delivery retries do not create another task',async()=>{
 const f=fixture();let starts=0;
 try{
  const {serviceProfileInput}=await import('../src/agent-services.ts');const {randomUUID}=await import('node:crypto');
  const p=serviceProfileInput.parse({id:randomUUID(),key:'my-agent',name:'我的协作 Agent',kind:'personal',ownerUserId:'local-board',actorKey:'executor',responsibilities:'评估与交接',offers:['feasibility'],enabled:true});
  const services:any={profile:async(key:string)=>{assert.equal(key,'my-agent');return p;},start:async(request:any,_actor:any,_assistant:any,origin:any)=>{starts++;assert.equal(request.serviceId,p.id);assert.equal(request.goal,'请核对需求');assert.deepEqual(origin,{messageId:'om_resume',chatId:'oc_test',senderId:'ou_owner'});return f.task;}};
  const intake=new CollaborationIntake(f.intake.w,f.intake.assistant,services),message={...f.event,content:'/agent my-agent 请核对需求'};
  await intake.ingest(message);await intake.ingest(message);assert.equal(starts,1);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get()?.n,1);
  await assert.rejects(intake.ingest({...message,message_id:'om_other',sender_id:'ou_stranger'}),/Unauthorized/);assert.equal(starts,1);
 }finally{f.close();}
});
