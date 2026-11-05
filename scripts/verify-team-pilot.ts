import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
if(!process.argv.includes('--run'))throw new Error('Use --run for the isolated three-user simulation');
const dir=path.resolve('.runtime/team-pilot'),fixture=JSON.parse(readFileSync(path.join(dir,'journey.json'),'utf8'));
process.env.COLLAB_STATE_DIR=dir;process.env.COLLAB_CONFIG=path.join(dir,'config.json');
process.env.COLLAB_PAPERCLIP_BOARD_TOKEN=JSON.parse(readFileSync(path.join(dir,'pilot-secrets.json'),'utf8')).boardToken;
const{loadConfig}=await import('../src/config.ts'),{Store}=await import('../src/store.ts'),{Workspaces}=await import('../src/workspaces.ts'),{TeamMembers}=await import('../src/members.ts'),{AgentServices}=await import('../src/agent-services.ts'),{TaskContext}=await import('../src/context.ts');
const config=loadConfig();assert.equal(config.paperclipUrl,'http://127.0.0.1:3110');assert.equal(config.companyId,fixture.companyId);
const store=new Store(path.join(dir,'bridge.sqlite')),w=new Workspaces(config,store),members=new TeamMembers(w),services=new AgentServices(w),checks:any[]=[];
const record=(name:string,details:unknown)=>checks.push({name,passed:true,details});
try{
 const actors:any={};for(const[key,user]of Object.entries(fixture.users)as any){actors[key]=await members.resolve(user.id);assert.equal(actors[key].admin,false);assert.equal(actors[key].agent,user.agent);record(key+' native operator identity',{userId:user.id,agent:user.agent});}
 assert.equal(new Set(Object.values(actors).map((a:any)=>a.agent)).size,3);
 const root=store.list().find(t=>t.kind==='collaboration'&&t.agent===actors.requester.agent&&!JSON.parse(t.context).networkParent);assert.ok(root,'Create the pilot parent task through the frontend first');
 const state=await w.state(root),requests=await Promise.all(state.requests.map(id=>w.access(id)));
 for(const[key,owner]of [['goal','requester'],['policy','owner'],['private','owner'],['technical','specialist']]as const){const s=fixture.sources[key];for(const[actorKey,actor]of Object.entries(actors)as any){let allowed=actorKey===owner;if(actorKey==='requester'&&key!=='private')allowed=allowed||requests.some(r=>r.sourceId===s.id&&r.agent===actor.agent&&r.state==='approved'&&Date.parse(r.expiresAt)>Date.now());const r:Response=await fetch(config.paperclipUrl+'/api/issues/'+s.id+'/documents/'+s.ref.key,{headers:{Authorization:'Bearer '+JSON.parse(readFileSync(path.join(dir,'secrets.json'),'utf8')).paperclipTokens[actor.agent]}});assert.equal(r.ok,allowed,actorKey+' / '+key);assert.ok(r.ok||[403,404].includes(r.status));record(actorKey+' native source ACL '+key,{status:r.status,allowed});}}
 for(const actor of Object.values(actors)as any){const directory=await services.view(actor);for(const p of directory.profiles)if(p.ownerUserId!==actor.userId)assert.equal(p.definition,undefined);record(actor.userId+' private definition isolation',true);}
 for(const[key,sourceKey]of [['requester','policy'],['specialist','policy'],['owner','technical']]as const){const request=requests.find(r=>r.sourceId===fixture.sources[sourceKey].id);assert.ok(request);await assert.rejects(members.gate('decide',{id:request.id},actors[key]),/资料授权只能/);record(key+' cannot approve '+sourceKey,true);}
 const view=await w.view(actors.requester);assert.ok(!view.sources.some(s=>s.id===fixture.sources.private.id));
 const pack=await new TaskContext(w).collect(root);assert.ok(!JSON.stringify(pack).includes('SIM-INTERNAL-COST-73'));assert.ok(!pack.layers.sources.some(s=>s.id===fixture.sources.private.id));record('private fixture absent from requester context',true);
 for(const[key,actor]of Object.entries(actors)as any)if(key!=='requester'){await assert.rejects(w.reader(actor.agent).get('/issues/'+root.id),/403|404/);record(key+' cannot read requester task natively',true);}
 const result={kind:'simulated-business-real-native-identities',at:new Date().toISOString(),taskId:root.id,task:root.identifier,requests:requests.map(r=>({sourceId:r.sourceId,state:r.state,agent:r.agent,grantId:r.grantId})),checks};
 const suffix=requests.some(r=>r.sourceId===fixture.sources.policy.id&&r.state==='revoked')?'revoked':'granted';writeFileSync(path.join(dir,'permissions-'+suffix+'.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({stage:suffix,checks:checks.length,passed:true,task:root.identifier}));
}finally{store.close();}
