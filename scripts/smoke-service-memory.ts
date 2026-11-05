import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { api } from '../src/client.ts';
import { runtime } from '../src/config.ts';
if(!process.argv.includes('--run'))throw new Error('Use --run for the explicitly scoped local integration journey');
const registry=await api('/workspace/agent-services',{});
let helper=registry.profiles.find((p:any)=>p.key==='handoff-review');
if(!helper){const profile={id:randomUUID(),key:'handoff-review',name:'交接审阅 Agent',kind:'shared',ownerUserId:'local-board',actorKey:'role-product',responsibilities:'审阅 SuitMe 平台本轮集成的交接稿与验收边界。只在明确任务和资料范围内准备，不批准权限、不采用知识、不代替最终验收。',offers:['review'],enabled:true};
 const next=await api('/workspace/save-agent-services',{profiles:[...registry.profiles.map(({version,editable,...p}:any)=>p),profile],revision:registry.revision});helper=next.profiles.find((p:any)=>p.key==='handoff-review');}
const status=await api('/workspace/memory-status',{}),record=status.records.find((s:any)=>s.title.includes('联调经验'))??status.records[0];
let recall;if(record){const index=await api('/workspace/memory-index',{sourceId:record.id});recall={index,result:await api('/workspace/memory-search',{query:'交接 资料 授权'})};}
const parent=await api('/workspace/start-collaboration',{task:{title:'服务网络与团队记忆适配：实际集成走查',goal:'针对当前 SuitMe 协作台升级，委托已配置的交接审阅服务准备一份集成边界检查稿；收到回传后归纳尚待负责人决定的事项。当前真实负责人仍为本机用户，不把两个服务身份说成两位员工。只处理平台集成，不读取旧 B2C 原文，不采用知识，不最终验收。',agent:'manual',sources:[],requestKey:'real-service-memory-adaptation-v1',autoDiscover:false},delegate:false});
await api('/workspace/network-route',{taskId:parent.id,serviceId:helper.id,expectedVersion:helper.version,goal:'为当前 SuitMe 平台的服务委托、澄清回传与知识记忆集成准备可审阅检查稿。先查看已有后台执行证据；区分已验证、未配置和需人决定。当前只证明本机同一负责人下的两个真实服务身份协作，不声称多位真实员工已登录。不读取额外资料、不采用知识、不最终验收。',sourceIds:[]});
const job=await api('/workspace/assistant-delegate',{taskId:parent.id,enabled:true,mode:'advance',instruction:'先核对范围，再调用 delegate_service 委托已配置的服务。派出后保存当前进度并结束，不轮询、不另建开发任务。服务回传后接续本任务，优先核对回传与后台证据，直接整理工作稿。',nonce:'real-service-memory-adaptation-v1'});
const evidence={at:new Date().toISOString(),parent:{id:parent.id,identifier:parent.identifier,jobId:job.id},helper:{id:helper.id,actor:helper.actorKey,ownerUserId:helper.ownerUserId},recall:recall?{index:recall.index,engine:recall.result.engine,hits:recall.result.hits.map((h:any)=>({sourceId:h.sourceId,revision:h.revision,chunkId:h.chunkId,score:h.score}))}:undefined};
writeFileSync(runtime('service-memory-journey.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
