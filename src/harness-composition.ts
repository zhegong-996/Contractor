import {build} from 'esbuild';
import path from 'node:path';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {root,runtime} from './config.ts';
import {runtimeToolInput} from './coordination.ts';
import {definitionOf,definitionTools,skillCatalog,type AgentDefinition} from './agent-definition.ts';

let implementation:Promise<any>|undefined;
export function harnessImplementation(){return implementation??=(async()=>{
  const base=path.join(root,'upstream/deepseek-harness');
  const alias:Record<string,string>={
    '@deepseek-ai/cordis':path.join(base,'vendor/cordis/src/index.ts'),
    '@deepseek-ai/cosmokit':path.join(base,'vendor/cosmokit/src/index.ts'),
    '@deepseek-ai/schemastery':path.join(base,'vendor/schemastery/src/index.ts'),
    '@deepseek-ai/dsh-scope':path.join(base,'packages/core/scope/src/index.ts'),
    '@deepseek-ai/dsh-system-prompt':path.join(base,'packages/core/system-prompt/src/index.ts'),
    '@deepseek-ai/dsh-tools/pipeline':path.join(base,'packages/core/tools/src/pipeline.ts'),
    '@deepseek-ai/dsh-tools':path.join(base,'packages/core/tools/src/index.ts'),
    '@deepseek-ai/dsh-tool-executor-native':path.join(base,'packages/core/tool-executor-native/src/index.ts'),
    '@deepseek-ai/dsh-persona':path.join(base,'packages/preset/persona/src/index.ts'),
    '@deepseek-ai/dsh-llm':path.join(root,'integrations/deepseek/messages.ts'),
    '@deepseek-ai/dsh-util-crypto':path.join(base,'packages/util/crypto/src/index.ts'),
    '@deepseek-ai/dsh-brand':path.join(base,'packages/util/brand/src/index.ts'),
    '@deepseek-ai/dsh-util-values':path.join(base,'packages/util/values/src/index.ts'),
  };
  const result=await build({entryPoints:[path.join(root,'integrations/deepseek/runtime.ts')],bundle:true,write:false,platform:'node',format:'esm',target:'node24',alias,logLevel:'silent'});
  const code=result.outputFiles[0]!.text,folder=runtime('compiled');mkdirSync(folder,{recursive:true,mode:0o700});
  const file=path.join(folder,'deepseek-'+createHash('sha256').update(code).digest('hex')+'.mjs');writeFileSync(file,code,{mode:0o600});return import(pathToFileURL(file).href);
})();}
export type ComposableAgent={id:string;name:string;responsibilities:string;definition?:AgentDefinition};
async function mounted(profile:ComposableAgent,run?:(name:string,args:any)=>Promise<any>){
  const native=await harnessImplementation(),ctx=new native.Context(),definition=definitionOf(profile);
  try{
    await ctx.plugin(native.SystemPrompt,{includeHarnessIdentity:false,personaPrefix:'',includeRuntimeContext:true});
    await ctx.plugin(native.ToolsService);await ctx.plugin(native.NativeExecutor);
    for(const option of runtimeToolInput.options){const name=option.shape.name.value;
      ctx.tools.register({name,description:name,parameters:JSON.parse(JSON.stringify(z.toJSONSchema((option as any).omit({name:true})))),
        output:{schema:{type:'object',properties:{value:{}},required:['value'],additionalProperties:false},render:(_args:any,value:any)=>[{type:'text',text:JSON.stringify(value.value)}]},
        execute:async(args:any)=>{if(!run)throw new Error('构建预览不执行工具');const parsed=(option as any).omit({name:true}).parse(args);return JSON.parse(JSON.stringify({value:await run(name,parsed)}));}});
    }
    const scopeKey={agent:profile.id},allowed=definitionTools(definition);let scope:any;
    await ctx.plugin({inject:['systemPrompt','tools'],apply(parent:any){scope=native.createScope(parent,scopeKey);scope.ctx.tools.restrict({allow:allowed});}});
    await scope.ctx.plugin(native.Persona,{prefix:profile.name+'\n职责：'+profile.responsibilities+'\n'+definition.instructions,complete:false,includeRuntimeContext:true});
    for(const id of definition.skills){const skill=skillCatalog.find(s=>s.id===id)!;scope.ctx.systemPrompt.section({name:'suitme:skill:'+id,order:100+skillCatalog.indexOf(skill),text:skill.instruction,interpolate:false});}
    scope.ctx.systemPrompt.section({name:'suitme:human-boundaries',order:900,text:'只在当前任务和现有权限内工作。资料授权、知识采用与最终验收由人决定。配置能力不授予资料权限。',interpolate:false});
    return{ctx,native,scopeKey,definition,allowed};
  }catch(error){await ctx.fiber.dispose();throw error;}
}
export async function compileAgent(profile:ComposableAgent){
  const m=await mounted(profile);try{
    const plugins=[{name:'@deepseek-ai/dsh-persona',config:{prefix:profile.name+'\n'+profile.responsibilities}},...m.definition.skills.map(id=>({name:'suitme-skill',config:{id}})),{name:'suitme-capabilities',config:{allow:m.allowed}}];
    const problem=m.native.entryListProblem(plugins);if(problem)throw new Error(problem);
    const assembly=await m.ctx.systemPrompt.assemble({scope:m.scopeKey});
    return{engine:'DeepSeek Harness',sourceCommit:'fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159',definition:m.definition,plugins,prompt:m.native.renderPrompt(assembly),tools:assembly.tools??assembly.schemas,toolNames:m.ctx.tools.schemas(m.scopeKey).map((t:any)=>t.name),grantsCreated:0,modelServicesEnabled:0};
  }finally{await m.ctx.fiber.dispose();}
}
export async function executeComposedTool(profile:ComposableAgent,name:string,args:unknown,callId:string,run:(name:string,args:any)=>Promise<any>){
  const m=await mounted(profile,run);try{
    const batch=await m.ctx.tools.execute({agent:m.scopeKey,signal:new AbortController().signal,calls:[{type:'tool-call',id:callId,name,arguments:JSON.stringify(args)}],maxParallelToolCalls:1});
    const result=batch.results[0]?.result;if(!result||result.isError)throw new Error(result?.error?.message??'Agent 能力不包含此工具');return result.value.value;
  }finally{await m.ctx.fiber.dispose();}
}
