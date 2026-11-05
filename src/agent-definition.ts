import {z} from 'zod';

export const capabilityCatalog=[
  {id:'knowledge',name:'检索与理解知识',tools:['search_context','discover_context','read_record','expand_context','read_graph','read_memory_dictionary']},
  {id:'access',name:'准备访问申请',tools:['request_access']},
  {id:'collaboration',name:'委托与接续协作',tools:['discover_services','delegate_service','read_service_network','reply_service']},
  {id:'memory',name:'整理知识关系候选',tools:['propose_memory']},
  {id:'evidence',name:'核对交付证据',tools:['read_execution_evidence']},
  {id:'follow-up',name:'有界复查',tools:['schedule_recheck']},
] as const;
export const skillCatalog=[
  {id:'clarify',name:'需求澄清',capabilities:[],instruction:'先核对目标、使用者、约束与验收标准。查阅可获得的依据后，再对确实缺失的事实提一个具体问题；有缺口时保留成果并结束本轮。'},
  {id:'source-review',name:'来源与知识整理',capabilities:['knowledge'],instruction:'引用当前原文及修订，分开已确认事实、推断与缺口。一次任务中的说法不自动成为长期知识。'},
  {id:'handoff',name:'协作交接',capabilities:['collaboration'],instruction:'先核对接收服务的当前职责和明确交接范围。传递来源引用与待解决事项，不能通过摘要绕开接收者权限。'},
  {id:'delivery-review',name:'交付验收准备',capabilities:['evidence'],instruction:'分别核对需求、提交、CI、环境和待验收项。Agent 完成只表示成果已准备，最终验收由人决定。'},
  {id:'memory-curation',name:'概念关系整理',capabilities:['knowledge','memory'],instruction:'核对当前知识字典，只为当前来源中有逐字证据的概念和关系准备候选。保持来源版本，不自动采用或跨来源合并事实。'},
] as const;
const capabilityId=z.enum(['knowledge','access','collaboration','memory','evidence','follow-up']);
const skillId=z.enum(['clarify','source-review','handoff','delivery-review','memory-curation']);
export const agentDefinitionInput=z.object({
  version:z.literal(1),instructions:z.string().trim().max(6000),
  capabilities:z.array(capabilityId).max(6),skills:z.array(skillId).max(5),
  contextMode:z.enum(['task-only','owned-and-task']),maxToolCalls:z.number().int().min(2).max(12),
}).strict().superRefine((d,ctx)=>{
  if(new Set(d.capabilities).size!==d.capabilities.length||new Set(d.skills).size!==d.skills.length)ctx.addIssue({code:'custom',message:'能力和工作方法不能重复'});
  for(const id of d.skills){const skill=skillCatalog.find(s=>s.id===id)!;if(skill.capabilities.some(c=>!d.capabilities.includes(c as any)))ctx.addIssue({code:'custom',message:skill.name+'需要对应能力，不能隐式扩大工具范围'});}
});
export type AgentDefinition=z.infer<typeof agentDefinitionInput>;
export const defaultAgentDefinition:AgentDefinition={version:1,instructions:'',capabilities:capabilityCatalog.map(c=>c.id),skills:['clarify','source-review','handoff','delivery-review'],contextMode:'owned-and-task',maxToolCalls:12};
export function definitionOf(profile?:{definition?:AgentDefinition}):AgentDefinition{return profile?.definition?agentDefinitionInput.parse(profile.definition):structuredClone(defaultAgentDefinition);}
export function definitionTools(definition:AgentDefinition){return ['read_context','assess_scope',...capabilityCatalog.filter(c=>definition.capabilities.includes(c.id)).flatMap(c=>[...c.tools])];}
export function taskOnlyContext(state:any){return state.context?.networkParent||state.context?.service?.definition?.contextMode==='task-only';}
