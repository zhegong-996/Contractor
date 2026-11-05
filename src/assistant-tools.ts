import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID } from 'node:crypto';
import { runtimeToolInput } from './coordination.ts';
import { loadConfig, secrets } from './config.ts';
const [jobId, runId] = process.argv.slice(2), config = loadConfig(), key = config.assistant?.agentKey ?? 'workspace-assistant';
if (![jobId, runId].every(id => /^[a-f0-9-]{36}$/.test(id ?? ''))) throw new Error('A bound native job and run are required');
const descriptions: Record<string,string> = {
 reply_service:'用双方仍有权使用、且已列入交接范围的逐字来源回答协作 Agent 的澄清问题；不能自由复制其他上下文，最多三轮。',
 delegate_service:'使用负责人已配置的服务交接目标与资料范围，向同事的服务 Agent 发起一次原生子任务。没有范围配置不能派单，不自由复制原文，不启动第二个调度器。',
 read_service_network:'查看本任务委托服务的进度、澄清问题和双方仍有权使用的回传。需要人时结束本轮等待。',
 read_memory_dictionary:'读取当前获准资料所属知识空间的真实字典，先核对概念类型和关系字段再提出候选；不是预设岗位分类。',
 propose_memory:'为已确认来源提出有逐字引用依据的概念和关系候选，只保存候选，等人采用；不批准知识或扩大范围。',
 read_execution_evidence:'核对本任务此前的真实 Agent 工具调用、运行状态、关联交付和平台测试记录。先查系统已有证据，不能让人重复提供后台本来可获取的材料。',
 discover_services:'查看已上岗的个人及公共 Agent 的负责人、当前职责和可提供服务。目录不授予任何资料权限；可据此准备交接建议。',
 read_context:'读取当前任务的目标、获准上下文、事件、来源修订和缺口。先调用它，再判断工作范围。',
 assess_scope:'用 Super-agent 原版策略记录本轮判断。rule_assessments 只能且必须包含一项 rule_id="scoped-preparation"；接受只允许准备性工作，不批准任何权限、知识或验收。',
 search_context:'按需搜索当前执行身份原有可读的知识，返回匹配目录；不会授予新权限。',
 discover_context:'把与目标相关且原本有权的资料纳入上下文；遵守任务的自动检索设置。',
 read_record:'按需读取本任务的背景或工作记录，重新核对当前资料依赖。',
 expand_context:'需要未载入的内容时扩展已获准资料，最多两份。不能扩展没有授权的资料。',
 request_access:'为已经明确纳入任务的资料准备访问申请，等待人决定；已有拒绝或撤权不重新申请。',
 schedule_recheck:'对当前已委托任务约定一次复查；只核对现有资料或明确关联的交付。每次明确委托最多两次，等人授权时不轮询。',
 read_graph:'读取当前任务已获准且已确认的知识修订图谱。',
};
const server = new McpServer({name:'suitme-scoped-collaboration',version:'1.0.0'});
for(const option of runtimeToolInput.options){
 const name=option.shape.name.value;
 server.registerTool(name,{description:descriptions[name],inputSchema:(option as any).omit({name:true}).shape},async(args: Record<string,unknown>)=>{
  try{
   const response=await fetch(`http://127.0.0.1:${config.bridgePort}/workspace/assistant-tool`,{method:'POST',signal:AbortSignal.timeout(60000),
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+secrets().agentTokens[key]},body:JSON.stringify({jobId,runId,callId:randomUUID(),input:{...args,name}})});
   const result=await response.json() as any;if(!response.ok)throw new Error(result.error);
   return{content:[{type:'text' as const,text:JSON.stringify(result)}]};
  }catch(error){return{isError:true,content:[{type:'text' as const,text:String(error)}]};}
 });
}
await server.connect(new StdioServerTransport());
