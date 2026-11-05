import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { KnowledgeGraph } from './graph.ts';
import { reusable } from './knowledge.ts';
import { root, runtime, secrets } from './config.ts';
import { primeQueryTerms } from './vendor/prime-query.ts';
import { contractProof, type Workspaces, type WorkspaceActor } from './workspaces.ts';
import {memoryAnnotation} from './memory-contract.ts';
export {memoryAnnotation} from './memory-contract.ts';
export class TeamMemory {
  readonly graph: KnowledgeGraph;
  constructor(readonly w:Workspaces){this.graph=new KnowledgeGraph(w);}
  async folder(id:string,revision:string){const a=await this.annotations(id,revision);return runtime('knowledge-graph',createHash('sha256').update(id+'@'+revision+(a?'@'+a.proof:'')).digest('hex'));}
  async annotations(id:string,revision:string){
    const source=this.w.source(id);try{const d=await this.w.pc.get('/issues/'+source.ref.taskId+'/documents/memory-annotations'),v=JSON.parse(d.body);
      if(v.state==='confirmed'&&v.revision===revision&&v.proof===contractProof('memory',id,v,secrets().jwtSecret)){const {OntologyService}=await import('./ontology.ts');if((await new OntologyService(this.w).read(source.domain,{admin:true})).revision===v.ontologyRevision)return v;}
    }catch(e){if(!String(e).includes(': 404 '))throw e;}return undefined;
  }
  async inspect(id:string,actor:WorkspaceActor,taskId?:string){
    const {source,record}=await this.graph.source(id,actor,taskId);
    try{const doc=await this.w.pc.get('/issues/'+source.ref.taskId+'/documents/memory-annotations');const annotation=JSON.parse(doc.body);const {OntologyService}=await import('./ontology.ts');const dictionary=await new OntologyService(this.w).read(source.domain,{admin:true});return {annotation,documentRevision:doc.latestRevisionId,current:annotation.revision===record.revision&&annotation.ontologyRevision===dictionary.revision};}
    catch(e){if(String(e).includes(': 404 '))return {annotation:null,current:true};throw e;}
  }
  async propose(input:unknown,actor:WorkspaceActor,taskId?:string){
    const value=memoryAnnotation.parse(input),before=await this.graph.source(value.sourceId,actor,taskId);
    if(before.record.revision!==value.revision)throw new Error('来源修订已变化');
    const keys=new Set(value.concepts.map(c=>c.key));if(keys.size!==value.concepts.length||value.relations.some(r=>!keys.has(r.from)||!keys.has(r.to)))throw new Error('概念或关系引用无效');
    for(const item of [...value.concepts,...value.relations])if(!before.record.value.body.includes(item.quote))throw new Error('概念和关系必须有当前原文的逐字依据');
    const {OntologyService}=await import('./ontology.ts');const dictionary=await new OntologyService(this.w).read(before.source.domain,{admin:true});
    if(dictionary.schema.entities.length&&value.concepts.some(c=>!dictionary.schema.entities.some((t:any)=>t.name===c.type)))throw new Error('概念类型须使用当前知识字典中的定义');
    if(dictionary.schema.entities.length&&value.relations.some(r=>{const from=value.concepts.find(c=>c.key===r.from)!,to=value.concepts.find(c=>c.key===r.to)!;return !dictionary.schema.entities.find((e:any)=>e.name===from.type)?.fields.some((f:any)=>f.kind==='relation'&&f.name===r.predicate&&f.relation.targetEntityName===to.type);}))throw new Error('关系须符合当前知识字典的字段与目标类型');
    const record={...value,ontologyRevision:dictionary.revision,state:'candidate',proposedBy:actor.userId??actor.agent??'local-board',at:new Date().toISOString()};
    await this.w.pc.document(before.source.ref.taskId,'memory-annotations','知识概念与关系候选',JSON.stringify(record,null,2));
    const doc=await this.w.pc.get('/issues/'+before.source.ref.taskId+'/documents/memory-annotations');return{...record,documentRevision:doc.latestRevisionId};
  }
  async review(id:string,revision:string,documentRevision:string,confirmed:boolean,actor:WorkspaceActor){
    this.w.manager(actor);const {source,record}=await this.graph.source(id,actor);if(record.revision!==revision)throw new Error('来源已变化，重新审阅');
    const doc=await this.w.pc.get('/issues/'+source.ref.taskId+'/documents/memory-annotations');if(doc.latestRevisionId!==documentRevision)throw new Error('候选关系已变化');
    const value=JSON.parse(doc.body);const {OntologyService}=await import('./ontology.ts');if((await new OntologyService(this.w).read(source.domain,{admin:true})).revision!==value.ontologyRevision)throw new Error('知识字典已变化，请重新整理关系');memoryAnnotation.parse(Object.fromEntries(Object.entries(value).filter(([key])=>key in memoryAnnotation.shape)));
    if(value.revision!==revision)throw new Error('候选来源版本已变化');for(const item of [...value.concepts,...value.relations])if(!record.value.body.includes(item.quote))throw new Error('引用已变化');
    const next={...value,state:confirmed?'confirmed':'withdrawn',reviewedBy:actor.userId??'local-board'};next.proof=contractProof('memory',id,next,secrets().jwtSecret);
    await this.w.pc.request('PUT','/issues/'+source.ref.taskId+'/documents/memory-annotations',{title:'知识概念与关系候选',format:'markdown',body:JSON.stringify(next,null,2),baseRevisionId:documentRevision});
    // Keep the existing graph for audit; a changed annotation fingerprint forces a
    // new projection, and every read still checks the exact knowledge revision.
    const file=path.join(await this.folder(id,revision),'ready.json');if(existsSync(file)){const marker=JSON.parse(readFileSync(file,'utf8'));delete marker.memoryVersion;writeFileSync(file,JSON.stringify(marker),{mode:0o600});}
    return this.index(id,actor);
  }
  async index(id:string,actor:WorkspaceActor){
    this.w.manager(actor);const {record}=await this.graph.source(id,actor);
    if(!reusable(record.value,this.w.config,secrets().jwtSecret))throw new Error('只有已确认知识才能进入团队记忆');
    const result=await this.graph.run(id,record.revision,true,actor),file=path.join(await this.folder(id,record.revision),'ready.json');
    const marker=JSON.parse(readFileSync(file,'utf8'));marker.memoryVersion=2;writeFileSync(path.join(await this.folder(id,record.revision),'chunk-tokens.json'),JSON.stringify(Object.fromEntries(result.nodes.filter((n:any)=>n.type==='MemoryChunk'||n.type==='KnowledgeConcept').map((n:any)=>[n.id,primeQueryTerms(n.type==='MemoryChunk'?n.text:n.name+' '+n.concept_type+' '+n.evidence)]))),{mode:0o600});writeFileSync(file,JSON.stringify(marker),{mode:0o600});return{sourceId:id,revision:record.revision,chunks:result.nodes.filter((n:any)=>n.type==='MemoryChunk').length,concepts:result.nodes.filter((n:any)=>n.type==='KnowledgeConcept').length};
  }
  async status(actor:WorkspaceActor){
    const records=[];for(const s of this.w.catalog().sources.filter(s=>!s.external&&(actor.admin||this.w.members(s.domain).includes(actor.agent!)))){
      try{const r=await this.w.knowledge.read(s.ref,actor.admin?this.w.pc:this.w.reader(actor.agent!));if(!reusable(r.value,this.w.config,secrets().jwtSecret))continue;
        const file=path.join(await this.folder(s.id,r.revision),'ready.json');records.push({id:s.id,title:r.value.title,revision:r.revision,indexed:existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).memoryVersion===2});}catch{}
    }return{engine:'Cognee + Ladybug + BM25',modelCalls:0,semanticEmbedding:false,records};
  }
  async search(taskId:string|undefined,query:string,actor:WorkspaceActor){
    const task=taskId?this.w.store.get(taskId):undefined,state=task?await this.w.state(task):undefined;if(task&&(task.phase==='accepted'||!actor.admin&&actor.agent!==task.agent)||!task&&!actor.admin&&!actor.userId)throw new Error('Unauthorized: memory task scope');
    const sources:any[]=[];for(const source of this.w.catalog().sources.filter(s=>!s.external&&!state?.outcomes.some(o=>o.publicationId===s.id)&&(!state?.context?.networkParent||state.sources.includes(s.id)))){
      if(task){if(!state!.sources.includes(source.id)&&!this.w.members(source.domain).includes(task.agent))continue;if(!await this.w.allowed(task,source.id,task.agent,state))continue;}else if(!actor.admin&&!this.w.members(source.domain).includes(actor.agent!))continue;
      const principal=task?.agent??(!actor.admin?actor.agent:undefined),before=await this.w.readMaterial(source.id,principal);if(!reusable(before.value,this.w.config,secrets().jwtSecret))continue;
      const file=path.join(await this.folder(source.id,before.revision),'ready.json');
      if(!existsSync(file)||JSON.parse(readFileSync(file,'utf8')).memoryVersion!==2)continue;
      const tokens=JSON.parse(readFileSync(path.join(await this.folder(source.id,before.revision),'chunk-tokens.json'),'utf8'));
      sources.push({id:source.id,title:source.title,revision:before.revision,hash:before.hash,path:path.join(await this.folder(source.id,before.revision),'graph.ladybug'),tokens});
    }
    if(!sources.length)return{engine:'Cognee BM25',modelCalls:0,hits:[]};
    const result=await new Promise<any>((resolve,reject)=>{
      const child=spawn(runtime('cognee-venv','bin','python'),[path.join(root,'scripts/cognee-recall.py')],{cwd:root,env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',PYTHONPATH:path.join(root,'upstream/cognee'),TELEMETRY_DISABLED:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('知识检索超时'));},90000);
      child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err=(err+b).slice(-800);});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);const line=out.split('\n').findLast(l=>l.startsWith('SUITME_RECALL_RESULT='));if(code!==0||!line)return reject(new Error('Cognee 检索失败：'+err));try{resolve(JSON.parse(line.slice('SUITME_RECALL_RESULT='.length)));}catch(e){reject(e);}});child.stdin.end(JSON.stringify({sources,queryTokens:primeQueryTerms(z.string().min(1).max(3000).parse(query)),limit:8}));
    });
    for(const s of sources){const current=await this.w.readMaterial(s.id,task?.agent??(!actor.admin?actor.agent:undefined));if(!reusable(current.value,this.w.config,secrets().jwtSecret)||task&&!await this.w.allowed(task,s.id,task.agent)||!task&&!actor.admin&&!this.w.members(this.w.source(s.id).domain).includes(actor.agent!)||current.hash!==s.hash||path.join(await this.folder(s.id,s.revision),'graph.ladybug')!==s.path)throw new Error('检索期间来源、版本、字典或权限变化，结果已丢弃');}
    if(actor.userId&&actor.userId!=='local-board'){const {TeamMembers}=await import('./members.ts');const current=await new TeamMembers(this.w).resolve(actor.userId);if(current.agent!==actor.agent||current.admin!==actor.admin)throw new Error('成员身份或权限已经变化');}
    return result;
  }
  async tick(){
    for(const s of this.w.catalog().sources.filter(s=>!s.external)){
      try{const r=await this.w.readMaterial(s.id);if(!reusable(r.value,this.w.config,secrets().jwtSecret))continue;const file=path.join(await this.folder(s.id,r.revision),'ready.json');if(!existsSync(file)||JSON.parse(readFileSync(file,'utf8')).memoryVersion!==2){await this.index(s.id,{admin:true});break;}}
      catch(error){this.w.store.audit('memory.index-failed',s.id,{error:String(error).slice(0,200)});}
    }
  }
}
