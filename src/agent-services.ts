import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import type { Workspaces, WorkspaceActor, State } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';
import {agentDefinitionInput,capabilityCatalog,skillCatalog,defaultAgentDefinition} from './agent-definition.ts';
import {compileAgent} from './harness-composition.ts';
export const serviceProfileInput = z.object({
 id:z.string().uuid(),key:z.string().regex(/^[a-z][a-z0-9-]{1,50}$/),name:z.string().trim().min(1).max(100),
 kind:z.enum(['personal','shared']),ownerUserId:z.string().min(1).max(100),actorKey:z.string(),
 responsibilities:z.string().trim().min(1).max(3000),offers:z.array(z.enum(['feasibility','draft','review'])).min(1).max(3),enabled:z.boolean(),definition:agentDefinitionInput.optional(),resources:z.array(z.string()).max(16).optional(),
}).strict();
export type AgentServiceProfile=z.infer<typeof serviceProfileInput>;
export const serviceVersion=(p:AgentServiceProfile)=>createHash('sha256').update(JSON.stringify(serviceProfileInput.parse(p))).digest('hex');
const offerInstructions={feasibility:'先评估需求是否清楚、现有证据和实现可行性。缺少关键条件时提出一个具体问题并结束本轮，补充后接续同一任务；条件齐备再准备开发交接和验收范围。',draft:'直接完成当前资料足以支持的可审阅工作稿，标明依据和缺口。',review:'核对当前成果、约束和执行证据，给出待负责人决定的审阅意见；不代替最终验收。'};
export class AgentServices{
 constructor(readonly w:Workspaces){}
 async build(input:unknown,actor:WorkspaceActor){const p=serviceProfileInput.parse(input);if((!actor.admin||actor.scopedHuman)&&p.ownerUserId!==actor.userId)throw new Error('只能构建自己的 Agent');if(actor.agent&&p.actorKey!==actor.agent)throw new Error('Agent 必须使用本人的资料身份');this.w.participant(p.actorKey);for(const id of p.resources??[]){const s=this.w.source(id);if(!this.w.members(s.domain).includes(p.actorKey))throw new Error('只能列出本人负责的资料');await this.w.reader(p.actorKey).get('/issues/'+s.ref.taskId);}return {...await compileAgent(p),execution:{engine:this.w.config.assistant?.engine??'codex',model:this.w.config.assistant?.model??'当前 CLI 配置',newService:false}};}
 async resources(){const result=[];for(const p of (await this.read()).profiles.filter(p=>p.enabled&&p.resources?.length)){try{await this.profile(p.id);for(const id of p.resources??[]){const s=this.w.source(id);if(!this.w.members(s.domain).includes(p.actorKey))continue;await this.w.reader(p.actorKey).get('/issues/'+s.ref.taskId);result.push({id:s.id,title:s.title,domain:s.domain,serviceId:p.id,ownerUserId:p.ownerUserId});}}catch{}}return result;}
 async read(){
  const id=this.w.catalog().serviceRegistryIssueId;
  if(!id)return{profiles:[] as AgentServiceProfile[],revision:null as string|null,issueId:null as string|null};
  const issue=await this.w.issue(id);if(issue.projectId!==this.w.config.assistant?.projectId||issue.visibility!=='private')throw new Error('Agent 服务目录存储范围已变化');
  const doc=await this.w.pc.get('/issues/'+id+'/documents/agent-services');
  return{profiles:z.array(serviceProfileInput).max(40).parse(JSON.parse(doc.body).profiles),revision:doc.latestRevisionId as string,issueId:id};
 }
 async view(actor:WorkspaceActor){if(!actor.admin&&!actor.userId)throw new Error('Unauthorized');const value=await this.read();return{...value,definitions:{capabilities:capabilityCatalog,skills:skillCatalog,defaults:defaultAgentDefinition},execution:{engine:this.w.config.assistant?.engine??'codex',model:this.w.config.assistant?.model??'当前 CLI 配置'},ownerUserId:actor.userId??'local-board',currentAgent:actor.agent??'manual',profiles:value.profiles.map(p=>({...p,definition:p.ownerUserId===(actor.userId??'local-board')||actor.admin&&!actor.scopedHuman?p.definition:undefined,version:serviceVersion(p),editable:p.ownerUserId===(actor.userId??'local-board')}))};}
 async save(input:unknown,revision:string|null,actor:WorkspaceActor){
  this.w.manager(actor);const profiles=z.array(serviceProfileInput).max(40).parse(input),current=await this.read(),owner=actor.userId??'local-board';
  if(current.revision!==revision)throw new Error('Agent 职责配置已变化，请重新载入');
  if(new Set(profiles.map(p=>p.id)).size!==profiles.length||new Set(profiles.map(p=>p.key)).size!==profiles.length)throw new Error('Agent 标识不能重复');
  const personal=profiles.filter(p=>p.kind==='personal');if(new Set(personal.map(p=>p.ownerUserId)).size!==personal.length)throw new Error('每位成员保留一个个人 Agent，其他专业服务使用公共 Agent');
  for(const [index,p] of profiles.entries()){const old=current.profiles.find(v=>v.id===p.id);if(old&&old.ownerUserId!==p.ownerUserId)throw new Error('不能更改既有 Agent 的负责人或接管其他成员身份');if(p.ownerUserId!==owner){const publicOld=old?{...old,definition:undefined}:undefined;if(!old||JSON.stringify(old)!==JSON.stringify(p)&&JSON.stringify(publicOld)!==JSON.stringify(p))throw new Error('只能修改自己的 Agent，不能虚构员工归属');profiles[index]=old;}else if(actor.scopedHuman&&p.actorKey!==actor.agent)throw new Error('Agent 必须使用本人的资料权限身份');this.w.participant(p.actorKey);}if(current.profiles.some(p=>p.ownerUserId!==owner&&!profiles.some(n=>n.id===p.id)))throw new Error('不能移除其他成员的 Agent');
  for(const p of profiles)if((p.definition||p.resources?.length)&&JSON.stringify(current.profiles.find(v=>v.id===p.id))!==JSON.stringify(p))await this.build(p,actor);
  const c=this.w.catalog();if(!current.issueId){const issue=await this.w.pc.post('/companies/'+this.w.config.companyId+'/issues',{projectId:this.w.config.assistant!.projectId,title:'团队 Agent 服务目录',visibility:'private',status:'backlog',allowDuplicate:true,idempotencyKey:'agent-service-registry'});c.serviceRegistryIssueId=issue.id;this.w.saveCatalog(c);}
  await this.w.pc.request('PUT','/issues/'+c.serviceRegistryIssueId+'/documents/agent-services',{title:'个人与公共 Agent 服务',format:'markdown',body:JSON.stringify({version:1,profiles},null,2),baseRevisionId:revision});
  this.w.store.audit('agent-services.updated',c.serviceRegistryIssueId!,{profiles:profiles.length});return this.view(actor);
 }
 async profile(id:string){const p=(await this.read()).profiles.find(p=>p.id===id||p.key===id);if(!p?.enabled)throw new Error('Agent 服务未上岗或已暂停');
  if(p.ownerUserId!=='local-board'){const value=await this.w.pc.get('/companies/'+this.w.config.companyId+'/members');if(!value.members.some((m:any)=>m.principalId===p.ownerUserId&&m.status==='active'&&m.user?.id===p.ownerUserId))throw new Error('Agent 负责人不是有效成员');if(p.kind==='personal'&&this.w.catalog().memberAgents?.[p.ownerUserId]!==p.actorKey)throw new Error('个人 Agent 归属绑定已变化');}
  return p;}
 async current(state:State){const bound=state.context?.service;if(!bound)return true;try{return serviceVersion(await this.profile(bound.id))===bound.version;}catch{return false;}}
 async assertCurrent(state:State){if(!await this.current(state))throw new Error('Agent 当前职责已改变，须负责人核对本任务范围后继续');}
 async start(input:unknown,actor:WorkspaceActor,assistant:WorkspaceAssistant,origin?:{messageId:string;chatId:string;senderId:string}){
  this.w.manager(actor);const request=z.object({serviceId:z.string(),expectedVersion:z.string(),offer:z.enum(['feasibility','draft','review']),title:z.string().min(1).max(120),goal:z.string().min(1).max(5000),requestKey:z.string().min(1).max(100)}).strict().parse(input);
  const eventId='agent-service-request:'+request.requestKey,inputHash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const prior=this.w.store.db.prepare('SELECT state,value FROM events WHERE id=?').get(eventId) as {state:string;value:string}|undefined;
  if(prior){const value=JSON.parse(prior.value);if(value.inputHash!==inputHash)throw new Error('同一次发起不能更换需求或 Agent，请先核对已创建任务');if(prior.state==='done')return this.w.store.get(value.taskId);}
  const p=await this.profile(request.serviceId);if(serviceVersion(p)!==request.expectedVersion)throw new Error('Agent 职责已更新，请重新核对后发起');if(!p.offers.includes(request.offer))throw new Error('此 Agent 未提供这项服务');
  if(actor.scopedHuman&&actor.agent&&actor.agent!==p.actorKey){
    const task=await this.w.createTask({title:request.title,goal:request.goal,agent:actor.agent,sources:[],requestKey:'service:'+request.requestKey,autoDiscover:true},actor);
    const own=(await this.read()).profiles.find(v=>v.enabled&&v.kind==='personal'&&v.ownerUserId===(actor.userId??'local-board')&&v.actorKey===actor.agent),state=await this.w.state(task);
    if(own)state.context!.service={id:own.id,version:serviceVersion(own),ownerUserId:own.ownerUserId,name:own.name,responsibilities:own.responsibilities,offer:own.offers[0]!,...own.definition?{definition:own.definition}:{}};
    await this.w.save(task,state,'service-invoked',{serviceId:p.id,ownerUserId:p.ownerUserId,delegation:true});
    const {ServiceNetwork}=await import('./service-network.ts');await new ServiceNetwork(this.w,assistant).route({taskId:task.id,serviceId:p.id,expectedVersion:serviceVersion(p),goal:request.goal,sourceIds:[]},actor);
    await assistant.delegate(task.id,true,'advance','核对当前范围，使用 delegate_service 委托已明确目标的服务；只共享本次目标，不转发未授权资料。'+offerInstructions[request.offer],actor,'service:'+request.requestKey);
    this.w.store.db.prepare('INSERT OR REPLACE INTO events(id,state,value) VALUES(?,?,?)').run(eventId,'done',JSON.stringify({taskId:task.id,inputHash}));return task;
  }
  const task=await this.w.createTask({title:request.title,goal:request.goal,agent:p.actorKey,sources:[],requestKey:'service:'+request.requestKey,autoDiscover:true},actor);
  this.w.store.db.prepare('INSERT OR IGNORE INTO events(id,state,value) VALUES(?,?,?)').run(eventId,'created',JSON.stringify({taskId:task.id,inputHash}));
  const state=await this.w.state(task);if(origin){task.messageId=origin.messageId;task.chatId=origin.chatId;task.senderId=origin.senderId;state.imBinding={senderId:origin.senderId,chatId:origin.chatId};}
  state.context!.service={id:p.id,version:serviceVersion(p),ownerUserId:p.ownerUserId,name:p.name,responsibilities:p.responsibilities,offer:request.offer,...p.definition?{definition:p.definition}:{}};
  await this.w.save(task,state,'service-invoked',{serviceId:p.id,ownerUserId:p.ownerUserId,offer:request.offer});
  await assistant.delegate(task.id,true,'advance',offerInstructions[request.offer],actor,'service:'+request.requestKey);this.w.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('done',eventId);return task;
 }
 async rebind(taskId:string,version:string,actor:WorkspaceActor,assistant:WorkspaceAssistant){
  this.w.manager(actor);const task=this.w.store.get(taskId),state=await this.w.state(task),bound=state.context?.service;if(!bound)throw new Error('任务未关联个人 Agent');
  const p=await this.profile(bound.id);if(serviceVersion(p)!==version)throw new Error('职责再次变化，请重新核对');if(p.actorKey!==task.agent)throw new Error('服务身份已改变，须通过任务交接核对资料权限');
  state.context!.service={...bound,version,name:p.name,responsibilities:p.responsibilities,ownerUserId:p.ownerUserId,definition:p.definition};await this.w.save(task,state,'service-reconfirmed',{serviceId:p.id});
  await assistant.delegate(task.id,true,state.delegation?.mode??'advance',state.delegation?.instruction??'',actor,randomUUID());return{reconfirmed:true};
 }
}
