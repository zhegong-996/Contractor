import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DefaultRequestHandler, JsonRpcTransportHandler, ServerCallContext, AgentEvent, type TaskStore, type AgentExecutor } from '@a2a-js/sdk/server';
import { TaskState, Role, type Task as A2ATask, type AgentCard } from '@a2a-js/sdk';
import { AgentServices, serviceVersion } from './agent-services.ts';
import { contractProof, type Workspaces, type WorkspaceActor } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';
import { secrets } from './config.ts';
import { getRouter } from './router.ts';

const routeInput = z.object({ taskId: z.string(), serviceId: z.string(), expectedVersion:z.string(), goal: z.string().trim().min(1).max(3000), sourceIds: z.array(z.string()).max(8) }).strict();
type Link = { childId: string; parentId: string; serviceId: string; serviceVersion: string; sourceIds: string[]; caller: string; ownerUserId: string; goal: string; createdAt: string; generation?: number; cancelled?: boolean; returnedJobId?: string; proof?: string };
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class ServiceNetwork {
  constructor(readonly w: Workspaces, readonly assistant: WorkspaceAssistant) {}
  async links(parentId: string): Promise<Link[]> {
    try { const doc = await this.w.pc.get('/issues/' + parentId + '/documents/service-network');
      const list: Link[] = JSON.parse(doc.body);
      for (const link of list) if (link.parentId !== parentId || link.proof !== contractProof('service-link', link.childId, link, secrets().jwtSecret)) throw new Error('服务交接合同已变化');
      return list;
    } catch (e) { if (String(e).includes(': 404 ')) return []; throw e; }
  }
  async save(parentId: string, list: Link[]) {
    for (const link of list) link.proof = contractProof('service-link', link.childId, link, secrets().jwtSecret);
    await this.w.pc.document(parentId, 'service-network', '服务 Agent 委托与回传', JSON.stringify(list, null, 2));
  }
  async authorize(parentId: string, actor: WorkspaceActor, mutable=true) {
    const task = this.w.store.get(parentId); if (!actor.admin && actor.agent !== task.agent) throw new Error('Unauthorized: service caller');
    if (mutable&&task.phase === 'accepted') throw new Error('任务已结束');
    return { task, state: await this.w.state(task) };
  }
  async route(input: unknown, actor: WorkspaceActor) {
    this.w.manager(actor); const p = routeInput.parse(input), { task, state } = await this.authorize(p.taskId, actor);
    const profile = await new AgentServices(this.w).profile(p.serviceId);
    if(serviceVersion(profile)!==p.expectedVersion)throw new Error('服务职责已变化，请核对后配置');
    if (profile.actorKey === task.agent) throw new Error('不能把任务再次委托给同一个资料身份');
    if (p.sourceIds.some(id => !state.sources.includes(id))) throw new Error('交接资料必须已明确属于当前任务');
    state.context!.serviceRoutes ??= [];
    const routes = state.context!.serviceRoutes.filter(r => r.serviceId !== profile.id);
    if (routes.length >= 3) throw new Error('本任务最多配置三个协作服务');
    state.context!.serviceRoutes = [...routes, { serviceId: profile.id, serviceVersion:serviceVersion(profile), goal: p.goal, sourceIds: p.sourceIds }];
    await this.w.save(task, state, 'service-route-configured', { serviceId: profile.id, sourceIds: p.sourceIds });
    getRouter().route({
      taskId: p.taskId, stage: 'delegation',
      caller: { actor: actor.userId ?? task.agent, role: 'supervisor', source: 'a2a-sdk' },
      target: { role: 'worker', serviceId: profile.id, agentKey: profile.actorKey },
      basis: { kind: 'service-route', evidence: ['goal:' + p.goal.slice(0, 80), 'version:' + serviceVersion(profile)] },
      scope: { sourceIds: p.sourceIds, visibility: 'space' },
      outcome: 'pending',
      causedBy: p.taskId + ':' + profile.id,
      idempotencyKey: 'service-route:' + p.taskId + ':' + profile.id + ':' + serviceVersion(profile),
    });
    return { configured: true };
  }
  async start(parentId: string, serviceId: string, actor: WorkspaceActor) {
    const { task, state } = await this.authorize(parentId, actor), service = await new AgentServices(this.w).profile(serviceId);
    const route = state.context?.serviceRoutes?.find(r => r.serviceId === service.id);
    if (!route) throw new Error('先由负责人明确协作对象、交接目标与资料范围');
    if(route.serviceVersion!==serviceVersion(service))throw new Error('协作服务的职责已变化，请负责人重新核对交接范围');
    if (state.context?.networkParent) throw new Error('本轮不再转委托，避免循环派单');
    const list = await this.links(parentId), prior = list.find(l => (l.generation??1)===task.generation&&l.caller===task.agent&&l.serviceId === service.id && l.goal === route.goal && digest(l.sourceIds) === digest(route.sourceIds) && l.serviceVersion === serviceVersion(service));
    if (prior){const cs=await this.w.state(this.w.store.get(prior.childId));if(!prior.cancelled&&!cs.delegation?.jobId)await this.dispatch(prior);return this.render(prior, true);}
    if (list.length >= 3) throw new Error('本任务的服务委托预算已用完');
    for (const id of route.sourceIds) if (!await this.w.allowed(task, id, task.agent, state)) throw new Error('交接方无权使用所选资料，请先处理授权');
    const child = await this.w.createTask({ title: '协作评估：' + route.goal.slice(0, 90), goal: route.goal, agent: service.actorKey,
      sources: route.sourceIds, autoDiscover: false, requestKey: 'network:' + digest({ parentId, generation: task.generation, route, version: serviceVersion(service) }) }, { admin: true, userId: state.context?.requesterUserId ?? actor.userId });
    const childState = await this.w.state(child);
    childState.context!.networkParent = parentId;
    childState.context!.service = { id: service.id, name: service.name, version: serviceVersion(service), ownerUserId: service.ownerUserId, responsibilities: service.responsibilities, offer: service.offers[0]!,...service.definition?{definition:service.definition}:{} };
    await this.w.save(child, childState, 'service-invoked', { parentId, serviceId: service.id });
    const link: Link = { childId: child.id, parentId, serviceId: service.id, serviceVersion: serviceVersion(service), sourceIds: route.sourceIds, caller: task.agent,
      goal: route.goal, ownerUserId: state.context?.requesterUserId ?? actor.userId ?? 'local-board', createdAt: new Date().toISOString(),generation:task.generation };
    list.push(link); await this.save(parentId, list);
    await this.dispatch(link);
    this.w.store.audit('service.delegated', parentId, { childId: child.id, serviceId: service.id });
    getRouter().route({
      taskId: parentId, stage: 'delegation',
      caller: { actor: task.agent, role: 'supervisor', source: 'a2a-sdk' },
      target: { role: 'worker', serviceId: service.id, agentKey: service.actorKey },
      basis: { kind: 'service-route', evidence: ['child:' + child.id, 'generation:' + task.generation,
        'version:' + serviceVersion(service), 'goal:' + route.goal.slice(0, 80)], policyVersion: 'a2a-1.0' },
      scope: { sourceIds: route.sourceIds, visibility: 'space' },
      outcome: 'committed',
      causedBy: child.id,
      idempotencyKey: 'service-start:' + parentId + ':' + child.id,
    });
    return this.render(link, true);
  }
  async dispatch(link:Link){
    return this.protocol(link).sendMessage({tenant:this.w.config.companyId!,message:{messageId:'native-'+link.childId,taskId:link.childId,contextId:link.parentId,role:Role.ROLE_USER,
      parts:[{content:{$case:'text',value:link.goal},metadata:undefined,filename:'',mediaType:'text/plain'}],metadata:undefined,extensions:[],referenceTaskIds:[]},
      configuration:{acceptedOutputModes:['text/plain'],returnImmediately:false,taskPushNotificationConfig:undefined},metadata:undefined},this.context(link));
  }
  context(link: Link) { return new ServerCallContext({ tenant: this.w.config.companyId, requestedVersion: '1.0', user: { isAuthenticated: true, userName: link.caller } }); }
  protocol(link: Link) {
    const net = this;
    const store: TaskStore = {
      async load(id, context) { if (id !== link.childId || context.tenant !== net.w.config.companyId || context.user?.userName !== link.caller) return undefined; return net.render(link, true); },
      async save(task, context) { if (task.id !== link.childId || task.contextId !== link.parentId || context.tenant !== net.w.config.companyId || context.user?.userName !== link.caller) throw new Error('Unauthorized: A2A task binding');
        if(task.status?.state===TaskState.TASK_STATE_CANCELED&&!link.cancelled){await net.assistant.delegate(link.childId,false,'advance','服务委托已取消',{admin:true});link.cancelled=true;const links=await net.links(link.parentId);const current=links.find(l=>l.childId===link.childId);if(current){current.cancelled=true;await net.save(link.parentId,links);}}
        await net.w.pc.document(link.childId, 'a2a-state', 'A2A 协作状态', JSON.stringify({id:task.id,contextId:task.contextId,status:{state:task.status?.state,timestamp:task.status?.timestamp},protocol:'A2A 1.0'})); },
      async list() { throw new Error('A2A task discovery is scoped to the native parent task'); },
    };
    const executor: AgentExecutor = {
      async execute(request, bus) {
        if (request.taskId !== link.childId || request.contextId !== link.parentId) throw new Error('A2A 上下文绑定已变化');
        await net.assistant.delegate(link.childId, true, 'advance', '只在本次交接目标和明确资料范围内评估、澄清和准备工作稿。需要条件时提出一个具体问题并结束本轮；不批准授权，不采用知识，不代替验收。', { admin: true }, 'a2a:' + request.userMessage.messageId);
        bus.publish(AgentEvent.task(await net.render(link, false))); bus.finished();
      },
      async cancelTask(_id, bus) { await net.assistant.delegate(link.childId, false, 'advance', '', { admin: true });link.cancelled=true;const links=await net.links(link.parentId);const current=links.find(l=>l.childId===link.childId);if(current){current.cancelled=true;await net.save(link.parentId,links);} bus.publish(AgentEvent.task(await net.render({ ...link, cancelled: true }, false))); bus.finished(); },
    };
    const card = { name: 'SuitMe 服务协作', description: '原生任务上的 A2A 委托、澄清与回传', version: '1.0.0', supportedInterfaces: [{ url: 'http://127.0.0.1:' + this.w.config.bridgePort + '/a2a/'+link.parentId+'/'+link.childId, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: this.w.config.companyId! }], defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [], signatures: [], securitySchemes: {nativeBearer:{scheme:{$case:'httpAuthSecurityScheme',value:{scheme:'bearer',bearerFormat:'SuitMe scoped token',description:'Native caller identity bound to this parent task'}}}}, securityRequirements: [{schemes:{nativeBearer:{list:[]}}}], provider: undefined, capabilities: undefined } as AgentCard;
    return new DefaultRequestHandler(card, store, executor);
  }
  async render(link: Link, includeResult: boolean): Promise<A2ATask> {
    const child=this.w.store.get(link.childId),state=await this.w.state(child),parent=this.w.store.get(link.parentId);
    let status=link.cancelled?TaskState.TASK_STATE_CANCELED:TaskState.TASK_STATE_SUBMITTED;
    let result:any,nativeStatus:string|undefined,blockedBy:string|undefined;
    const currentService=await new AgentServices(this.w).current(state);
    if(state.delegation?.jobId){
      const job=await this.assistant.job(state.delegation.jobId);nativeStatus=job.status;
      if(!link.cancelled){
        status=job.status==='cancelled'?TaskState.TASK_STATE_CANCELED:['failed','stale'].includes(job.status)?TaskState.TASK_STATE_FAILED:job.status==='completed'?(job.receipt?.ask?.length?TaskState.TASK_STATE_INPUT_REQUIRED:TaskState.TASK_STATE_COMPLETED):TaskState.TASK_STATE_WORKING;
        if(status===TaskState.TASK_STATE_FAILED)blockedBy='execution';
        let shared=true;
        for(const id of state.sources){if(!link.sourceIds.includes(id)||!await this.w.allowed(child,id,child.agent,state)||!await this.w.allowed(parent,id,link.caller))shared=false;}
        if(!shared){blockedBy='authorization';status=TaskState.TASK_STATE_AUTH_REQUIRED;}
        if(job.status==='completed'&&includeResult&&shared&&currentService&&parent.phase!=='accepted'&&parent.agent===link.caller){const bundle=await this.assistant.bundle(child,job);if(bundle.basis===job.basis)result={jobId:job.id,output:job.output,questions:job.receipt?.ask??[]};}
      }
    }
    if(!link.cancelled&&!currentService){status=TaskState.TASK_STATE_INPUT_REQUIRED;blockedBy='scope';}
    return {id:child.id,contextId:link.parentId,status:{state:status,timestamp:new Date().toISOString(),message:undefined},
      artifacts:result?.output?.workProducts?.map((p:any,i:number)=>({artifactId:result.jobId+':'+i,name:p.title,description:'待负责人审阅的工作稿',parts:[{content:{$case:'text' as const,value:p.body},filename:'',mediaType:'text/plain',metadata:undefined}],metadata:{jobId:result.jobId,reviewState:'pending'},extensions:[]}))??[],history:[],
      metadata:{protocol:'A2A 1.0',nativeStatus,blockedBy,nativeIdentifier:child.identifier,serviceId:link.serviceId,result:result??null,sharing:result?'shared':'status-only',isBusinessAcceptance:false}};
  }
  async rpc(parentId:string,childId:string,request:any,actor:WorkspaceActor){
    await this.authorize(parentId,actor,request?.method!=='GetTask');const link=(await this.links(parentId)).find(l=>l.childId===childId);if(!link)throw new Error('Unauthorized: A2A parent binding');
    if(request.params?.tenant&&request.params.tenant!==this.w.config.companyId)throw new Error('Unauthorized: A2A company boundary');
    const wireContext=new ServerCallContext({requestedVersion:'1.0',user:{isAuthenticated:true,userName:link.caller}});
    request={...request,params:{...request.params,tenant:this.w.config.companyId}};
    if(!['GetTask','SendMessage','CancelTask'].includes(request?.method))throw new Error('只开放当前原生任务的接单、查询与取消');
    if(request.method==='SendMessage'){
      const message=request.params?.message;
      if(message?.taskId!==childId||message?.contextId!==parentId||message?.parts?.length!==1||message.parts[0]?.text!==link.goal)throw new Error('A2A 接单只能使用已批准的交接包');
      const state=await this.w.state(this.w.store.get(childId));if(!state.delegation?.jobId&&!link.cancelled)await this.dispatch(link);
      return new JsonRpcTransportHandler(this.protocol(link)).handle({...request,method:'GetTask',params:{id:childId,tenant:this.w.config.companyId}},wireContext);
    }
    if(request.params?.id!==childId)throw new Error('Unauthorized: A2A task binding');
    return new JsonRpcTransportHandler(this.protocol(link)).handle(request,wireContext);
  }
  async view(parentId: string, actor: WorkspaceActor) { await this.authorize(parentId, actor,false); return Promise.all((await this.links(parentId)).map(l => this.render(l, true))); }
  async answer(parentId: string, childId: string, text: string, actor: WorkspaceActor) {
    this.w.manager(actor); await this.authorize(parentId, actor); const link = (await this.links(parentId)).find(l => l.childId === childId);
    if (!link || link.cancelled) throw new Error('服务委托不存在或已取消');
    await this.assistant.taskContext.note(childId, z.string().trim().min(1).max(3000).parse(text), { admin: true }); await this.assistant.tick(); return { continued: childId };
  }
  async replyFromSource(parentId:string,childId:string,sourceId:string,quote:string,actor:WorkspaceActor){
    const {task,state}=await this.authorize(parentId,actor),link=(await this.links(parentId)).find(l=>l.childId===childId&&!l.cancelled);
    if(!link||!link.sourceIds.includes(sourceId)||quote.length<4||quote.length>1800)throw new Error('只能用明确交接范围内的原文回答');
    const child=this.w.store.get(childId),childState=await this.w.state(child);
    if(!await this.w.allowed(task,sourceId,task.agent,state)||!await this.w.allowed(child,sourceId,child.agent,childState))throw new Error('双方资料权限不足');
    const record=await this.w.readMaterial(sourceId,task.agent);if(!record.value.body.includes(quote))throw new Error('回答必须逐字出自当前获准资料');
    const receipt='service-answer:'+digest({childId,sourceId,quote,job:childState.delegation?.jobId});
    if(childState.snapshots.some(s=>s.receiptId===receipt))return {replayed:true};
    if(childState.snapshots.filter(s=>s.receiptId?.startsWith('service-answer:')).length>=3)throw new Error('澄清轮次已达上限，请负责人接手');
    const snap=await this.w.snapshot(child,'context-note','协作 Agent 提供的来源依据',quote,[sourceId],receipt);
    snap.receiptId=receipt;snap.systemEvidence=true;snap.inputManifest=[{kind:'knowledge',id:sourceId,revision:record.revision,hash:record.hash}];childState.snapshots.push(snap);
    await this.w.save(child,childState,'service-answer',{parentId,sourceId});return {continued:childId};
  }
  async cancel(parentId: string, childId: string, actor: WorkspaceActor) {
    this.w.manager(actor); await this.authorize(parentId, actor); const list = await this.links(parentId), link = list.find(l => l.childId === childId);
    if (!link) throw new Error('服务委托不存在'); if(link.cancelled)return {cancelled:true};
    await this.protocol(link).cancelTask({ id: childId, tenant: this.w.config.companyId!, metadata:undefined }, this.context(link));
    link.cancelled = true; await this.save(parentId, list); return { cancelled: true };
  }
  async tick() {
    for (const task of this.w.store.list().filter(t => t.kind === 'collaboration')) {
      const list = await this.links(task.id); if(!list.length)continue;let changed = false;
      const parentState=await this.w.state(task);if(task.phase==='accepted'||parentState.delegation?.enabled===false){for(const link of list.filter(l=>!l.cancelled)){await this.assistant.delegate(link.childId,false,'advance','父任务已停止或结束',{admin:true});link.cancelled=true;changed=true;}if(changed)await this.save(task.id,list);continue;}
      for (const link of list.filter(l => !l.cancelled)) {
        if(link.caller!==task.agent||(link.generation??1)!==task.generation){await this.assistant.delegate(link.childId,false,'advance','父任务已交接到新的资料身份',{admin:true});link.cancelled=true;changed=true;continue;}
        const childState=await this.w.state(this.w.store.get(link.childId));
        if(!childState.delegation?.jobId&&await new AgentServices(this.w).current(childState)){let permitted=true;for(const id of link.sourceIds)if(!await this.w.allowed(task,id,link.caller,parentState))permitted=false;if(permitted)await this.dispatch(link);}
        const result = await this.render(link, true), value = result.metadata?.result;
        if(!value&&[4,6,7,8].includes(result.status!.state)){
          const fresh=await this.w.state(task),receipt='service-status:'+link.childId+':'+result.status!.state+':'+childState.delegation?.jobId;
          if(!fresh.snapshots.some(s=>s.receiptId===receipt)){const snap=await this.w.snapshot(task,'context-note','协作服务待处理',JSON.stringify({childId:link.childId,serviceId:link.serviceId,state:result.status!.state,reason:result.metadata?.blockedBy??'需要补充条件',at:new Date().toISOString()}),[],receipt);snap.receiptId=receipt;snap.systemEvidence=true;fresh.snapshots.push(snap);await this.w.save(task,fresh,'service-state-changed',{childId:link.childId,state:result.status!.state});}
        }
        if (!value || link.returnedJobId === value.jobId) continue;
        const state = await this.w.state(task), receiptId = 'service-response:' + link.childId + ':' + value.jobId;
        if (!state.snapshots.some(s => s.receiptId === receiptId)) {
          const snap = await this.w.snapshot(task, 'context-note', '协作服务回传', JSON.stringify({ serviceId: link.serviceId, nativeTask: result.metadata!.nativeIdentifier, ...value }), link.sourceIds, receiptId);
          snap.receiptId = receiptId; snap.inputManifest=[{kind:'service',id:link.childId,key:'assistant-result',revision:value.jobId,hash:digest(value.output)}]; state.snapshots.push(snap); await this.w.save(task, state, 'service-response', { childId: link.childId, jobId: value.jobId });
        }
        link.returnedJobId = value.jobId; changed = true;
      }
      if (changed) await this.save(task.id, list);
    }
  }
}
