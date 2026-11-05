import{z}from'zod';import{createHash,randomUUID}from'node:crypto';
import type{Workspaces,WorkspaceActor}from'./workspaces.ts';import type{Controller}from'./controller.ts';import type{WorkspaceAssistant}from'./assistant.ts';
import{ServiceNetwork}from'./service-network.ts';
export class Development{
 constructor(readonly w:Workspaces,readonly control:Controller,readonly assistant:WorkspaceAssistant){}
 async owner(taskId:string,actor:WorkspaceActor){const task=this.w.store.get(taskId),state=await this.w.state(task);if(!actor.admin&&task.agent!==actor.agent)throw new Error('Unauthorized: task owner');if(actor.userId&&(state.context?.requesterUserId??'local-board')!==actor.userId)throw new Error('开发委托及验收由需求发起人决定');return{task,state};}
 async view(taskId:string,actor:WorkspaceActor){const{task,state}=await this.owner(taskId,actor),tasks=[];for(const id of state.context?.linkedTasks??[]){const t=this.w.store.get(id);if(t.kind==='collaboration')continue;await this.w.reader(task.agent).get('/issues/'+id);tasks.push({id:t.id,identifier:t.identifier,phase:t.phase,delivery:t.delivery,acceptance:JSON.parse(t.context).businessAcceptance??[]});}return{repository:this.w.config.repository,engines:Object.entries(this.w.config.agents).filter(([,a])=>a.enabled&&a.mode==='managed'&&a.access==='edit').map(([key,a])=>({key,name:a.name})),tasks};}
 async start(input:unknown,actor:WorkspaceActor){
  const p=z.object({taskId:z.string(),instruction:z.string().trim().min(1).max(16000),agent:z.string(),requestKey:z.string().min(1).max(100)}).strict().parse(input),{task,state}=await this.owner(p.taskId,actor);
  if(task.phase==='accepted')throw new Error('任务已验收');const engine=this.w.config.agents[p.agent];if(!engine?.enabled||engine.mode!=='managed'||engine.access!=='edit')throw new Error('开发执行端尚未配置');
  const network=await new ServiceNetwork(this.w,this.assistant).view(task.id,{admin:true});if(network.some(l=>![3,4,5,7].includes(l.status?.state??0)))throw new Error('先完成当前服务协作，再核对开发范围');
  const nonce=createHash('sha256').update(task.id+':'+p.requestKey).digest('hex');
  const created=await this.control.createTask({triggerId:'workspace-development:'+nonce,chatId:'local-workspace',messageId:'workspace-development:'+task.id,senderId:actor.userId??'local-board',requesterUserId:actor.userId??'local-board',agent:p.agent,text:p.instruction});
  await this.w.nativeGrant(created.id,task.agent);const fresh=await this.w.state(task);fresh.context!.linkedTasks=[...new Set([...(fresh.context?.linkedTasks??[]),created.id])];fresh.context!.developmentTasks=[...new Set([...(fresh.context?.developmentTasks??[]),created.id])];await this.w.save(task,fresh,'context-linked',{linkedId:created.id,development:true});
  return this.view(task.id,actor);
 }
 async accept(input:unknown,actor:WorkspaceActor){const p=z.object({taskId:z.string(),developmentId:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/),cases:z.array(z.object({name:z.string(),passed:z.boolean()}).strict()).min(1).max(12)}).strict().parse(input);const{state}=await this.owner(p.taskId,actor);if(!state.context?.linkedTasks.includes(p.developmentId))throw new Error('交付不属于本任务');await this.control.accept(p.developmentId,p.sha,p.cases,actor.userId??'local-board','workspace:'+randomUUID());return this.view(p.taskId,actor);}
}
