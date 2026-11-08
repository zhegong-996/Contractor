import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, runtime, root, secrets } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { nativeWorkGate } from './native-worker.ts';
import { driveLegacyLoop, driveSteppedPump } from './loop-pump.ts';

const config=loadConfig(),runId=process.env.PAPERCLIP_RUN_ID,runToken=process.env.PAPERCLIP_API_KEY;
if(!runId||!runToken||!config.assistant?.enabled)throw new Error('A native assistant run is required');
const pc=new Paperclip(config.paperclipUrl,runToken,runId),run=await pc.get('/heartbeat-runs/'+runId),jobId=run.contextSnapshot?.issueId;
if(!/^[a-f0-9-]{36}$/.test(jobId??''))throw new Error('Native run has no job binding');
const key=config.assistant.agentKey;
async function bridge(action:string,data:unknown){
 const response=await fetch(`http://127.0.0.1:${config.bridgePort}/workspace/assistant-${action}`,{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+secrets().agentTokens[key]},body:JSON.stringify({jobId,runId,...data as object})});
 const value=await response.json() as any;if(!response.ok)throw Object.assign(new Error(value.error),{status:response.status});return value;
}
// A native run supplies exactly one job. Autoloop owns process/result recovery;
// Paperclip continues to own task assignment, concurrency and all wakeups.
process.env.AGENT_AUTOLOOP_HOME=runtime('autoloop-native',jobId);
const {createWorker}=await import(pathToFileURL(path.join(root,'upstream/autoloop/worker/worker.ts')).href);
for(const name of Object.keys(process.env))if(!['PATH','HOME','TMPDIR','LANG','LC_ALL','SHELL','CODEX_HOME','AGENT_AUTOLOOP_HOME','COLLAB_STATE_DIR','COLLAB_CONFIG'].includes(name))delete process.env[name];
let settled=false,cancelled=false,failed=false;
const id=parseInt(createHash('sha256').update(jobId).digest('hex').slice(0,12),16),token=createHash('sha256').update(jobId+runId).digest('hex');
const claim = nativeWorkGate(id);
const input=await bridge('context',{});
const worker=createWorker({name:'paperclip:'+jobId,capacity:1,wait:0,log:(line:string)=>console.error(line),hub:{
 async work(request: { running?: number[]; capacity?: boolean }){
  const action=claim(request,settled,cancelled);if(action==='cancel')return{cancel:[id]};if(action!=='offer')return{};
  return{job:{run:id,token,attempt:1,session:null,
   rule:{name:'推进当前已委托任务',cwd:root,prompt:input.rule.instruction},
   agent:{id:key,name:'协作事务 Agent',use:'command',access:'read',timeout:5,command:[process.execPath,'--import',path.join(root,'node_modules/tsx/dist/loader.mjs'),path.join(root,'src/assistant-turn.ts'),jobId,runId,'{prompt}']},
   askFirst:['批准资料访问','采用知识','最终验收','改变目标','对外发布'],
   context:{events:(input.events??[]).map((e:any)=>({id:e.id,source:'paperclip',sourceName:'任务订阅',type:e.kind,subject:e.subject,summary:e.kind,detail:'',link:'',receivedAt:e.at})),answers:[],timers:[],waiting:[],open:[],decided:[]}}};
 },
 async started(){return{};},
 async result(_id:number,received:string,result:any){
  if(received!==token)throw new Error('Worker receipt binding changed');
  if(cancelled){settled=true;return{};}
  if(result.outcome==='failed'||result.outcome==='cancelled'){
   await bridge('failed',{error:result.error??'执行未完成'});failed=true;
  }else{
   const file=runtime('assistant-runs',jobId,runId,'assistant-output.json'),output=JSON.parse(await readFile(file,'utf8'));
   try {
    await bridge('receipt',{receipt:{ask:result.ask,later:result.later}});
    await bridge('result',output);
   } catch (error) {
    const status=(error as {status?:number}).status;
    if(!status || status>=500) throw error;
    await bridge('failed',{error:'成果未通过当前上下文校验：'+String(error).slice(0,400)}).catch(()=>{}); failed=true;
   }
  }
  settled=true;return{};
 }
}});
process.on('SIGTERM',()=>{cancelled=true;});process.on('SIGINT',()=>{cancelled=true;});
// P-1：loop 与改造前逐字等价；step 由状态外置队列每激活一棒跑一次 tick。
const pump={tick:()=>worker.tick(),settled:()=>settled};
try{
 if(config.execution.mode==='step'){
  const stepped=await driveSteppedPump({config,runId,taskId:jobId,principal:key,...pump,
   snapshot:()=>({settled,cancelled,failed,jobId})});
  console.log(JSON.stringify({jobId,runtime:'stepped-worker',steps:stepped.steps,stoppedBy:stepped.stoppedBy}));
 }else{
  await driveLegacyLoop(pump);
  console.log(JSON.stringify({jobId,runtime:'autoloop-worker',cancelled,failed}));
 }
 if(failed)process.exitCode=1;
}catch(error){console.error(String(error).slice(0,600));process.exitCode=1;}
