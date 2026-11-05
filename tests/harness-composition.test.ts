import test from'node:test';import assert from'node:assert/strict';
import{compileAgent,executeComposedTool,harnessImplementation}from'../src/harness-composition.ts';
import{agentDefinitionInput,type AgentDefinition}from'../src/agent-definition.ts';
const definition:AgentDefinition={version:1,instructions:'按当前授权核对来源',capabilities:[],skills:['clarify'],contextMode:'task-only',maxToolCalls:3};
test('pinned Harness composes distinct scoped personas and actual callable tools without a model',async()=>{
 const a=await compileAgent({id:'requester',name:'甲的 Agent',responsibilities:'澄清需求',definition}),b=await compileAgent({id:'owner',name:'乙的 Agent',responsibilities:'资料管理',definition:{...definition,capabilities:['knowledge','memory'],skills:['memory-curation']}});
 assert.match(a.prompt,/甲的 Agent/);assert.doesNotMatch(a.prompt,/乙的 Agent|资料管理/);assert.deepEqual(new Set(a.toolNames),new Set(['read_context','assess_scope']));assert.ok(b.toolNames.includes('propose_memory'));assert.equal(a.grantsCreated,0);assert.equal(b.modelServicesEnabled,0);
});
test('original native executor rejects unselected tools and invalid parameters before the application handler',async()=>{
 let ran=0;const p={id:'reader',name:'只读 Agent',responsibilities:'读取本任务',definition};
 assert.deepEqual(await executeComposedTool(p,'read_context',{},'call-1',async()=>{ran++;return{ok:true};}),{ok:true});
 await assert.rejects(executeComposedTool(p,'request_access',{sourceId:'s',purpose:'x'},'call-2',async()=>{ran++;return{};}),/unknown tool/);
 await assert.rejects(executeComposedTool(p,'read_context',{forged:true},'call-3',async()=>{ran++;return{};}));assert.equal(ran,1);
});
test('failed native composition leaves no persona or capability registered for the next build',async()=>{
 await assert.rejects(compileAgent({id:'broken',name:'错误 {{unregistered}}',responsibilities:'管理',definition}));
 const next=await compileAgent({id:'next',name:'正常身份',responsibilities:'读取',definition});assert.doesNotMatch(next.prompt,/错误|unregistered/);assert.equal(next.toolNames.length,2);
 const native=await harnessImplementation();assert.match(native.entryListProblem([{config:{}}]),/names no plugin/);
});
test('skills cannot silently enable capabilities and configuration cannot add an arbitrary executable plugin',()=>{
 assert.equal(agentDefinitionInput.safeParse({...definition,skills:['memory-curation']}).success,false);assert.equal(agentDefinitionInput.safeParse({...definition,plugins:[{name:'file:///tmp/untrusted.js'}]}).success,false);
});
