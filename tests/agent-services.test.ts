// Service ownership is not a department enum or a CLI name. Role changes must
// invalidate old work; profile registration must never grant material access.
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';
import {AgentServices,serviceProfileInput,serviceVersion}from'../src/agent-services.ts';
const profile={id:randomUUID(),key:'my-agent',name:'我的研发 Agent',kind:'personal' as const,ownerUserId:'owner-a',actorKey:'executor',responsibilities:'本阶段负责移动端需求评估',offers:['feasibility'] as const,enabled:true};
test('personal service roles are versioned independently from execution tools and organization names',async()=>{
 const p=serviceProfileInput.parse(profile);assert.equal(p.actorKey,'executor');assert.notEqual(serviceVersion(p),serviceVersion({...p,responsibilities:'本阶段负责支付'}));
 const service=new AgentServices({config:{companyId:'c'},catalog:()=>({memberAgents:{'owner-a':'executor'}}),pc:{get:async()=>({members:[{principalId:'owner-a',status:'active',user:{id:'owner-a'}}]})}}as any);service.read=async()=>({profiles:[p],revision:'r',issueId:'i'});
 assert.equal(await service.current({context:{service:{id:p.id,version:serviceVersion(p)}}}as any),true);
 assert.equal(await service.current({context:{service:{id:p.id,version:'old'}}}as any),false);
});
test('a stale profile version cannot silently change the specialist chosen for a request',async()=>{
 const service=new AgentServices({manager:()=>{},store:{db:{prepare:()=>({get:()=>undefined})}}}as any);service.profile=async()=>serviceProfileInput.parse(profile);
 await assert.rejects(service.start({serviceId:profile.id,expectedVersion:'old',offer:'feasibility',title:'评估需求',goal:'明确已有约束',requestKey:'one'}, {admin:true},{}as any),/职责已更新/);
});
test('service registration cannot claim another employee identity or grant private resource membership',async()=>{
 let memberWrites=0;const w:any={manager:()=>{},participant:()=>{},pc:{post:async()=>{memberWrites++;}},config:{},catalog:()=>({})};
 const service=new AgentServices(w);service.read=async()=>({profiles:[],revision:null,issueId:null});
 await assert.rejects(service.save([profile],null,{admin:true,userId:'owner-b'}),/不能虚构员工/);assert.equal(memberWrites,0);
});

test('a lost service response resumes the same task and binds the IM origin before waking its Agent',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');const {Store}=await import('../src/store.ts');
 const dir=mkdtempSync(path.join(tmpdir(),'service-retry-')),store=new Store(path.join(dir,'state.sqlite'));
 let creates=0,wakes=0;const state:any={context:{},snapshots:[],requests:[],history:[],sources:[]};
 const task:any={id:randomUUID(),identifier:'SUI-1',triggerId:'service-one',agent:'executor',generation:1,phase:'ready',kind:'collaboration',messageId:'local',chatId:'local',senderId:'local',workspace:'',branch:'',context:'{}'};
 const w:any={store,manager:()=>{},createTask:async()=>{if(!store.byTrigger(task.triggerId)){creates++;store.save(task);}return store.get(task.id);},state:async()=>state,save:async(t:any)=>store.save(t)};
 const services=new AgentServices(w);const p=serviceProfileInput.parse(profile);services.profile=async()=>p;
 const request={serviceId:p.id,expectedVersion:serviceVersion(p),offer:'feasibility',title:'评估需求',goal:'核对范围与交接',requestKey:'retry-one'};
 const assistant:any={delegate:async()=>{assert.deepEqual(state.imBinding,{chatId:'oc_owner',senderId:'ou_owner'});if(++wakes===1)throw new Error('temporary wakeup failure');}};
 try{
  await assert.rejects(services.start(request,{admin:true},assistant,{messageId:'om_one',chatId:'oc_owner',senderId:'ou_owner'}),/temporary/);
  const retry=await services.start(request,{admin:true},assistant);const duplicate=await services.start(request,{admin:true},assistant);
  assert.equal(retry.id,task.id);assert.equal(duplicate.id,task.id);assert.equal(creates,1);assert.equal(wakes,2);
  assert.equal(state.context.service.version,request.expectedVersion);assert.equal(state.requests.length,0);
  await assert.rejects(services.start({...request,goal:'different'},{admin:true},assistant),/不能更换需求/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('service version is independent of JSON field insertion order',()=>{const p=serviceProfileInput.parse(profile);assert.equal(serviceVersion(p),serviceVersion(Object.fromEntries(Object.entries(p).reverse())as any));});
