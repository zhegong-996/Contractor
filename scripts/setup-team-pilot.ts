import{mkdirSync,readFileSync,writeFileSync,existsSync}from'node:fs';
import{randomBytes}from'node:crypto';import{spawnSync}from'node:child_process';import path from'node:path';
import{root}from'../src/config.ts';
if(!process.argv.includes('--run'))throw new Error('Use --run for the explicitly authorized three-user simulation');
const dir=path.join(root,'.runtime/team-pilot'),base='http://127.0.0.1:3110';mkdirSync(dir,{recursive:true,mode:0o700});
const file=path.join(dir,'pilot-secrets.json'),state:any=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
const save=()=>writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
state.admin??={key:'system',name:'SuitMe 模拟环境管理员',email:'pilot-system@suitme-pilot.invalid',password:randomBytes(24).toString('base64url')};
state.users??=['requester','owner','specialist'].map((key,i)=>({key,name:['陈禾（模拟需求方）','林知（模拟资料负责人）','周行（模拟交付协作）'][i],email:key+'@suitme-pilot.invalid',password:randomBytes(24).toString('base64url')}));save();
async function request(route:string,method='GET',body?:any,user=state.admin,attempt=0){
 const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:base,...user.cookie?{Cookie:user.cookie}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});
 if(r.status===429&&attempt<3){await r.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(60000,Number(r.headers.get('retry-after')??60)*1000))));return request(route,method,body,user,attempt+1);}
 const text=await r.text();let value:any;try{value=JSON.parse(text);}catch{throw new Error('Pilot returned non-JSON at '+route);}
 if(!r.ok)throw Object.assign(new Error('Pilot '+method+' '+route+': '+r.status+' '+JSON.stringify(value).slice(0,400)),{status:r.status});
 const cookies=r.headers.getSetCookie();if(cookies.length){user.cookie=cookies.map(c=>c.split(';')[0]).join('; ');save();}return value;
}
async function login(user:any){if(!user.id){const r=await request('/api/auth/sign-up/email','POST',{email:user.email,password:user.password,name:user.name},user);user.id=r.user.id;save();return;}try{const r=await request('/api/auth/sign-in/email','POST',{email:user.email,password:user.password},user);user.id=r.user.id;}
 catch(e:any){if(![400,401,404].includes(e.status))throw e;const r=await request('/api/auth/sign-up/email','POST',{email:user.email,password:user.password,name:user.name},user);user.id=r.user.id;}save();}
const health=await request('/api/health');if(health.deploymentMode!=='authenticated')throw new Error('Pilot must use native authenticated mode');
await login(state.admin);if(health.bootstrapStatus==='bootstrap_pending')await request('/api/bootstrap/claim','POST',{});
if(!state.boardToken){const key=await request('/api/board-api-keys','POST',{name:'SuitMe isolated pilot control plane'});state.boardToken=key.token;save();if(!state.boardToken)throw new Error('Native board key missing');}
const configFile=path.join(dir,'config.json');let config:any=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')):{
 paperclipUrl:base,bridgePort:4181,repository:'zhegong-996/desktop-tutorial',checkout:path.join(root,'workspaces/desktop-tutorial'),allowedPaths:['collab-pilot/','.github/workflows/collab-pilot.yml'],defaultAgent:'codex',pollMs:15000,
 agents:{codex:{name:'Codex',mode:'managed',use:'codex',access:'edit',enabled:true},manual:{name:'模拟环境接续身份',mode:'manual',use:'command',access:'read',enabled:true}},
 feishu:{profile:'ai-native-collab',enabled:false,appId:'',botId:'',allowedSenders:[],allowedChats:[]},assistant:{agentKey:'workspace-assistant',engine:'codex',enabled:true}};
if(config.bridgePort===4190)config.bridgePort=4181;
writeFileSync(configFile,JSON.stringify(config,null,2),{mode:0o600});
const env={...process.env,COLLAB_STATE_DIR:dir,COLLAB_CONFIG:configFile,COLLAB_PAPERCLIP_BOARD_TOKEN:state.boardToken,COLLAB_PLUGIN_INSTALL_DIR:path.join(dir,'plugin')};
function run(script:string,...args:string[]){const r=spawnSync(process.execPath,['--import',path.join(root,'node_modules/tsx/dist/loader.mjs'),path.join(root,script),...args],{cwd:root,env,stdio:'inherit'});if(r.status!==0)throw new Error(script+' failed');}
run('scripts/setup.ts');config=JSON.parse(readFileSync(configFile,'utf8'));state.companyId=config.companyId;
const catalog=path.join(dir,'knowledge-workspaces.json');if(!existsSync(catalog))writeFileSync(catalog,JSON.stringify({companyId:config.companyId,coordinationProject:'',vaultProject:'',spaces:{pilot:{name:'模拟场景资料',agent:'manual',projectId:'',members:['manual']}},sources:[]},null,2),{mode:0o600});
run('scripts/setup-workspaces.ts');run('scripts/setup-assistant.ts');
for(const user of state.users){await login(user);await request('/api/admin/users/'+user.id+'/company-access','PUT',{companyIds:[config.companyId]});}
const roster=await request('/api/companies/'+config.companyId+'/members');
for(const user of state.users){const m=roster.members.find((m:any)=>m.principalId===user.id);if(!m)throw new Error('Native membership missing');await request('/api/companies/'+config.companyId+'/members/'+m.id+'/role-and-grants','PATCH',{membershipRole:'operator',status:'active',grants:[]});}
save();run('scripts/seed-team-pilot.ts','--run');run('scripts/install-workspace-plugin.ts');console.log(JSON.stringify({kind:'isolated-simulation',url:base,companyId:state.companyId,users:state.users.map((u:any)=>({id:u.id,name:u.name})),notRealEmployees:true}));
