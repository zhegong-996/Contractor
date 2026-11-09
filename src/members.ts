import {randomBytes,createHash} from 'node:crypto';
import { z } from 'zod';
import {writeFileSync,renameSync} from 'node:fs';
import {configPath,runtime,secrets,type Config} from './config.ts';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';

// Paperclip remains the source of user identities, membership and invitations.
// This is only a binding from an authenticated human to a private Agent principal.
export class TeamMembers {
  constructor(readonly w: Workspaces,readonly identityFiles={read:secrets,write:(auth:ReturnType<typeof secrets>)=>{const file=runtime('secrets.json');writeFileSync(file+'.tmp',JSON.stringify(auth,null,2),{mode:0o600});renameSync(file+'.tmp',file);},save:(config:Config)=>{writeFileSync(configPath+'.tmp',JSON.stringify(config,null,2),{mode:0o600});renameSync(configPath+'.tmp',configPath);}}) {}
  async directory():Promise<{id:string;name:string;status:string}[]> {
    const result = await this.w.pc.get('/companies/' + this.w.config.companyId + '/user-directory');
    return result.users.filter((u:any)=>u.principalId!=='local-board'&&u.user?.id===u.principalId).map((u:any)=>({id:u.principalId,name:u.user?.name??u.principalId,status:u.status}));
  }
  async resolve(userId: string): Promise<WorkspaceActor> {
    if (userId === 'local-board') {
      const health = await this.w.pc.get('/health');
      if (health.deploymentMode !== 'local_trusted') throw new Error('Unauthorized: local operator is disabled');
      return { admin: true, userId };
    }
    const members = await this.w.pc.get('/companies/' + this.w.config.companyId + '/members');
    const member = members.members.find((m: any) => m.principalId === userId && m.status === 'active' && m.user?.id===userId);
    if (!member) throw new Error('Unauthorized: active native membership required');
    const role=member.membershipRole??'viewer',agent = this.w.catalog().memberAgents?.[userId],isAdmin=['owner','admin'].includes(role);
    if (!agent&&!isAdmin) throw new Error('请先由管理员绑定你的个人 Agent 资料身份');
    if(agent)this.w.participant(agent);
    return { admin: isAdmin, userId, agent, humanRole:role };
  }
  async view(actor: WorkspaceActor) {
    if (!actor.admin && !actor.userId) throw new Error('Unauthorized');
    return { users: (await this.directory()).map(u => ({ id: u.id, name: u.name ?? u.id })),
      bindings: this.w.catalog().memberAgents ?? {}, currentUserId: actor.userId ?? 'local-board',
      nativeMembersPath: '/company/settings/members' };
  }
  async bind(input: unknown, actor: WorkspaceActor) {
    this.w.manager(actor);
    const p = z.object({ userId: z.string().min(1), agent: z.string() }).strict().parse(input);
    const users = await this.directory();
    if (!users.some(u => u.id === p.userId&&u.status==='active')) throw new Error('只能绑定原生通讯录中的真实成员');
    this.w.participant(p.agent);
    const c = this.w.catalog();
    c.memberAgentOwners={...Object.fromEntries(Object.entries(c.memberAgents??{}).map(([uid,key])=>[key,uid])),...c.memberAgentOwners};
    if(c.memberAgentOwners[p.agent]&&c.memberAgentOwners[p.agent]!==p.userId)throw new Error('每位成员须使用独立资料身份，不能复用其他成员的历史身份');
    if (Object.entries(c.memberAgents ?? {}).some(([id, agent]) => id !== p.userId && agent === p.agent)) throw new Error('每位成员须使用独立资料身份，不能合并权限');
    c.memberAgents = { ...c.memberAgents, [p.userId]: p.agent };c.memberAgentOwners[p.agent]=p.userId; this.w.saveCatalog(c);
    this.w.store.audit('member.agent-bound', this.w.config.companyId!, p);
    return this.view(actor);
  }
  async provision(input:unknown,actor:WorkspaceActor){
    this.w.manager(actor);const {userId}=z.object({userId:z.string().min(1)}).strict().parse(input),user=(await this.directory()).find(u=>u.id===userId&&u.status==='active');
    if(!user)throw new Error('只能为原生通讯录中的在职成员开通');
    if(this.w.catalog().memberAgents?.[userId])return this.view(actor);
    const key='member-'+createHash('sha256').update(userId).digest('hex').slice(0,20),agents=await this.w.pc.get('/companies/'+this.w.config.companyId+'/agents');
    // Native metadata lets an interrupted provisioning resume without creating a second principal.
    let native=(Array.isArray(agents)?agents:agents.agents).find((a:any)=>a.metadata?.suitmeMemberUserId===userId);
    if(!native)native=await this.w.pc.post('/companies/'+this.w.config.companyId+'/agents',{name:user.name+'的个人 Agent',role:'general',runner:'legacy',adapterType:'process',capabilities:'独立成员资料身份；执行使用已配置的协作执行端。',metadata:{suitmeMemberUserId:userId},adapterConfig:{command:process.execPath,args:['-e','console.log("请通过 SuitMe 服务 Agent 接单")']},runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:false,maxConcurrentRuns:1}},permissions:{canCreateAgents:false,canCreateSkills:false}});
    const auth=this.identityFiles.read();auth.agentTokens[key]??=randomBytes(32).toString('hex');auth.paperclipTokens??={};
    if(!auth.paperclipTokens[key])auth.paperclipTokens[key]=(await this.w.pc.post('/agents/'+native.id+'/keys',{name:'SuitMe personal workspace native ACL',scope:{kind:'standard'}})).token;
    this.identityFiles.write(auth);this.w.config.agents[key]={name:user.name+'的个人 Agent',mode:'manual',use:'command',access:'read',enabled:true,paperclipId:native.id};this.identityFiles.save(this.w.config);
    const c=this.w.catalog();c.participants=[...new Set([...(c.participants??this.w.participantKeys()),key])];this.w.saveCatalog(c);
    // Creating an isolated principal does not grant any project or source access.
    return this.bind({userId,agent:key},actor);
  }
  async pairCode(actor:WorkspaceActor){
    if(!actor.admin&&!actor.userId)throw new Error('Unauthorized');const userId=actor.userId??'local-board';await this.resolve(userId);
    const token=randomBytes(16).toString('hex'),id='member-pair:'+createHash('sha256').update(token).digest('hex'),expiresAt=new Date(Date.now()+5*60*1000).toISOString();
    this.w.store.db.prepare('INSERT INTO events(id,state,value) VALUES(?,?,?)').run(id,'pending',JSON.stringify({userId,expiresAt}));return{command:'/member-pair '+token,expiresAt};
  }
  async acceptPair(token:string,senderId:string,chatId:string){
    if(!/^[a-f0-9]{32}$/.test(token))throw new Error('配对码无效');const id='member-pair:'+createHash('sha256').update(token).digest('hex');
    const row=this.w.store.db.prepare('SELECT state,value FROM events WHERE id=?').get(id)as any;if(!row)throw new Error('配对码无效');const value=JSON.parse(row.value);
    if(Date.parse(value.expiresAt)<=Date.now())throw new Error('配对码已过期，请从本人工作台重新生成');
    if(row.state==='done'){if(value.senderId!==senderId||value.chatId!==chatId)throw new Error('配对码已使用');return{paired:true,replayed:true};}
    await this.resolve(value.userId);const catalog=this.w.catalog();catalog.imMembers={...catalog.imMembers,[senderId]:{userId:value.userId,chatId}};this.w.saveCatalog(catalog);
    this.w.store.db.prepare('UPDATE events SET state=?,value=? WHERE id=?').run('done',JSON.stringify({...value,senderId,chatId}),id);
    this.w.store.audit('member.im-paired',this.w.config.companyId!,{userId:value.userId});return{paired:true};
  }
  async checkAgentOwner(agent:string){
    const c=this.w.catalog(),owner=c.memberAgentOwners?.[agent]??Object.entries(c.memberAgents??{}).find(([,key])=>key===agent)?.[0];if(owner){const current=await this.resolve(owner);if(current.agent!==agent)throw new Error('Unauthorized: personal Agent ownership changed');}
  }
  async inbox(actor:WorkspaceActor){
    if(actor.admin||!actor.userId)return[];const result=[];
    for(const task of this.w.store.list().filter(t=>t.kind==='collaboration')){const state=await this.w.state(task);for(const id of state.requests){const request=await this.w.access(id);const source=this.w.source(request.sourceId);if(!this.w.members(source.domain).includes(actor.agent!))continue;try{await this.w.reader(actor.agent!).get('/issues/'+source.ref.taskId);result.push({task:{id:task.id,identifier:task.identifier},request:{...request,canReview:actor.humanRole!=='viewer'}});}catch{}}}return result;
  }
  async gate(action: string, payload: any, actor: WorkspaceActor): Promise<WorkspaceActor> {
    if(actor.agent&&!actor.userId)await this.checkAgentOwner(actor.agent);
    if (actor.admin || !actor.userId) return actor;
    // P-5：view-summary 是 view 的服务端裁剪版，同样是只读、同样按身份过滤，
    // 因此与 view 走同一条成员读取放行链，不新增任何写入口。
    const reads = ['view', 'view-summary', 'agent-services', 'agent-build', 'development-view', 'delivery-status', 'service-status', 'routing-status', 'memory-replay', 'memory-guard', 'loop-guard', 'trace-view', 'team-members', 'member-pair-code', 'network-view', 'memory-search', 'memory-status', 'memory-annotations', 'context-pack', 'context-record', 'context-search', 'knowledge-graph', 'knowledge-list', 'knowledge-get', 'knowledge-wiki'];
    if (reads.includes(action)) return actor;
    // v0.6: owner-level permissions are enforced inside V06Services (org owner /
    // workspace owner / function owner). Keep the original admin flag intact so
    // the org-only config guard cannot be bypassed by an elevated actor here.
    if (action.startsWith('v06-')) {
      const v06Reads = ['roles-view', 'role-route', 'role-hints', 'role-snapshot', 'transfer-view', 'transfer-policy',
        'dispatch-guard', 'grant-widen', 'grant-check', 'edges-view', 'edge-impact', 'label-check',
        'policy-view', 'verification-level', 'topology-advice', 'inflight-policy', 'signals', 'review-readiness',
        'ontology-meta', 'ontology-view', 'ontology-query', 'attention-policy', 'attention-filter', 'watchdog-policy', 'watchdog-inspect',
        'plan-view', 'round-view', 'acceptance-export', 'acceptance-discussion-list', 'acceptance-report-view', 'org-overview', 'org-mapping-view',
        'context-pack', 'l2-status', 'l2-edges-view', 'l2-graph-view'];
      if (actor.humanRole === 'viewer' && !v06Reads.includes(action.slice(4))) throw new Error('只读成员不能修改职能、授权或策略');
      return actor;
    }
    if(actor.humanRole==='viewer')throw new Error('只读成员不能修改任务、权限或知识');
    if(action==='request')return actor;
    if(['decide','revoke'].includes(action)){const r=await this.w.access(payload.id),source=this.w.source(r.sourceId);if(action==='revoke'&&this.w.store.get(r.taskId).agent===actor.agent)return {...actor,admin:true,scopedHuman:true};if(!this.w.members(source.domain).includes(actor.agent!))throw new Error('资料授权只能由该空间负责人处理');await this.w.reader(actor.agent!).get('/issues/'+source.ref.taskId);return {...actor,admin:true,scopedHuman:true};}
    if(['memory-review','memory-index'].includes(action)){const source=this.w.source(payload.sourceId);if(!this.w.members(source.domain).includes(actor.agent!))throw new Error('只能维护本人知识空间的记忆');await this.w.reader(actor.agent!).get('/issues/'+source.ref.taskId);return {...actor,admin:true,scopedHuman:true};}
    if(['create-source','update-source','review-source'].includes(action)){const domain=action==='create-source'?payload.domain:this.w.source(payload.id).domain;if(!this.w.members(domain).includes(actor.agent!))throw new Error('只能维护本人有权负责的知识空间');return {...actor,admin:true,scopedHuman:true};}
    const elevated = { ...actor, admin: true, scopedHuman: true };
    if (['save-agent-services', 'invoke-agent-service'].includes(action)) return elevated;
    if (['start-collaboration', 'create-task'].includes(action)) {
      const request = payload.task ?? payload;
      if (request.agent !== actor.agent) throw new Error('不能冒用其他成员的资料身份');
      for (const id of request.sources ?? []) {try{await this.w.reader(actor.agent!).get('/issues/' + this.w.source(id).ref.taskId);}catch{const{AgentServices}=await import('./agent-services.ts');if(!(await new AgentServices(this.w).resources()).some(s=>s.id===id))throw new Error('只能引用本人可读或负责人已列为可申请的资料');}}
      return elevated;
    }
    if (['network-delegate', 'network-answer', 'network-cancel', 'network-route','development-start','development-accept'].includes(action)) {
      const task = this.w.store.get(payload.taskId); if (task.agent !== actor.agent) throw new Error('Unauthorized: task owner');
      return elevated;
    }
    if (['assistant-delegate', 'rebind-agent-service', 'context-note', 'context-discover', 'context-link', 'context-expand', 'context-include', 'context-exclude', 'checkpoint', 'handoff', 'complete', 'review', 'publish','adopt', 'memory-propose', 'memory-review'].includes(action)) {
      const task = this.w.store.get(payload.taskId); if (task.agent !== actor.agent) throw new Error('Unauthorized: task owner');
      if(action==='memory-review'&&!this.w.members(this.w.source(payload.sourceId).domain).includes(actor.agent!))throw new Error('只能采用本人知识空间的概念关系');
      if(['publish','adopt'].includes(action)){const state=await this.w.state(task);if(!this.w.members(this.w.targetSpace(task,state)).includes(actor.agent!))throw new Error('不能向无权限知识空间发布');}
      if(action==='complete'&&(await this.w.state(task)).context?.requesterUserId!==actor.userId)throw new Error('最终验收由任务发起人决定');
      if (action === 'handoff') throw new Error('跨成员服务请使用服务委托，保留双方责任与权限');
      return elevated;
    }
    throw new Error('Unauthorized: this operation requires the company operator');
  }
}
