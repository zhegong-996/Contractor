// Failures guarded: an event is not authority; inferred work needs a written rule;
// machine progress must not produce another task or another model round.
import test from 'node:test';import assert from 'node:assert/strict';import { Store } from '../src/store.ts';
import {admitPreparation,assessPreparation,subscribedEvents,runtimeToolInput} from '../src/coordination.ts';
const assessment={decision:'accept',direction:{implementation_requested:true,target_basis:'specified',requires_design_decision:false,evidence:'用户委托整理当前任务的验收清单'},rule_assessments:[{rule_id:'scoped-preparation',matched:true,reason:'仅检索已有权限并准备草稿'}],title:'整理验收材料',scope:'现有任务',reason:'可逆的准备工作',intent_evidence:'用户明确要求整理验收清单'};
test('the pinned Super-agent policy gates current delegated work and preserves observation mode',()=>{
 assert.equal(admitPreparation('task',true,'ready').admissible,true);assert.equal(admitPreparation('task',false,'ready').admissible,false);assert.equal(admitPreparation('task',true,'accepted').admissible,false);
 assert.equal(assessPreparation(assessment).kind,'accept');const observed=assessPreparation(assessment,'observe');assert.equal(observed.kind,'ignore');assert.equal(observed.audit.would_accept,true);
 assert.equal(assessPreparation({...assessment,direction:{...assessment.direction,requires_design_decision:true}}).kind,'ignore');
 assert.throws(()=>assessPreparation({...assessment,rule_assessments:[{...assessment.rule_assessments[0],rule_id:'invented'}]}),/every enabled rule/);
});
test('event batches follow only task subscriptions, merge arrivals and exclude self generated progress',()=>{
 const s=new Store(':memory:');try{s.audit('workspace.context-note','task',{});s.audit('workspace.context-note','foreign',{});s.audit('workspace.assistant-prepared','task',{});s.audit('knowledge.content-updated','source',{});
 const events=subscribedEvents(s,{id:'task'} as any,{sources:['source']} as any);assert.equal(events.length,2);assert.deepEqual(events.map(x=>x.id),['1','4']);assert.equal(subscribedEvents(s,{id:'task'} as any,{sources:['source']} as any,4).length,0);
 }finally{s.close();}
});
test('the autonomous tool contract has no approval, publication or arbitrary command escape hatch',()=>{
 for(const name of ['approve_access','accept_task','publish','execute','read_file'])assert.equal(runtimeToolInput.safeParse({name}).success,false);
 assert.equal(runtimeToolInput.safeParse({name:'request_access',sourceId:'source',purpose:'草拟交接',agent:'admin'}).success,false);
});

test('a due check is consumed once, bounded across rounds, and cannot resume a paused mandate',async()=>{
 const {consumeDueRecheck}=await import('../src/coordination.ts');const d:any={enabled:true,recheck:{at:'2026-11-05T00:00:00Z',kind:'context',reason:'核对现有资料'}};
 assert.ok(consumeDueRecheck(d,Date.parse('2026-11-05T00:01:00Z')));assert.equal(consumeDueRecheck(d),undefined);assert.equal(d.recheckCount,1);
 d.recheck={at:'2026-11-05T00:00:00Z'};d.enabled=false;assert.equal(consumeDueRecheck(d),undefined);d.enabled=true;d.recheckCount=2;assert.equal(consumeDueRecheck(d),undefined);
});
