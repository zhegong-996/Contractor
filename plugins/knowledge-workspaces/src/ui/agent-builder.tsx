import{useState}from'react';

export function AgentBuilder({ui,profile,registry,change}:{ui:any;profile:any;registry:any;change:(value:any)=>void}){
 const [preview,setPreview]=useState<any>(),[building,setBuilding]=useState(false),[error,setError]=useState('');
 const d=profile.definition??registry.definitions.defaults,catalog=registry.definitions;
 function edit(next:any){setPreview(undefined);change({definition:{...d,...next}});}
 async function build(){setBuilding(true);setError('');try{setPreview(await ui.read('agent-build',{profile}));}catch(e:any){setError(e.message);}finally{setBuilding(false);}}
 const resources=ui.data.sources.filter((s:any)=>s.canMaintain&&ui.data.spaces.find((p:any)=>p.domain===s.domain)?.members?.includes(profile.actorKey));
 return <div className="sm-stack sm-agent-builder">
  <fieldset className="sm-choices"><legend>可用能力</legend>{catalog.capabilities.map((c:any)=><label className="sm-check" key={c.id}><input type="checkbox" checked={d.capabilities.includes(c.id)} onChange={e=>{const capabilities=e.target.checked?[...d.capabilities,c.id]:d.capabilities.filter((id:string)=>id!==c.id);edit({capabilities,skills:d.skills.filter((id:string)=>catalog.skills.find((s:any)=>s.id===id).capabilities.every((key:string)=>capabilities.includes(key)))});}}/>{c.name}</label>)}</fieldset>
  <fieldset className="sm-choices"><legend>工作方法</legend>{catalog.skills.map((s:any)=>{const available=s.capabilities.every((id:string)=>d.capabilities.includes(id));return <label className="sm-check" key={s.id} title={available?s.instruction:'先选择对应的可用能力'}><input type="checkbox" disabled={!available} checked={d.skills.includes(s.id)} onChange={e=>edit({skills:e.target.checked?[...d.skills,s.id]:d.skills.filter((id:string)=>id!==s.id)})}/>{s.name}</label>;})}</fieldset>
  <label className="sm-field">执行约定<textarea className="sm-input" value={d.instructions} placeholder="专业方法、禁止事项和交付要求" onChange={e=>edit({instructions:e.target.value})}/></label>
  <div className="sm-form-grid"><label className="sm-field">上下文范围<select className="sm-input" value={d.contextMode} onChange={e=>edit({contextMode:e.target.value})}><option value="task-only">仅当前任务明确引用的资料</option><option value="owned-and-task">本人知识空间与当前任务资料</option></select></label><label className="sm-field">每轮最多工具调用<input className="sm-input" type="number" min={2} max={12} value={d.maxToolCalls} onChange={e=>edit({maxToolCalls:Number(e.target.value)})}/></label></div>
  {resources.length>0&&<fieldset className="sm-choices"><legend>可供同事申请的资料</legend>{resources.map((s:any)=><label className="sm-check" key={s.id}><input type="checkbox" checked={(profile.resources??[]).includes(s.id)} onChange={e=>{setPreview(undefined);change({resources:e.target.checked?[...(profile.resources??[]),s.id]:(profile.resources??[]).filter((id:string)=>id!==s.id)});}}/>{s.title}</label>)}</fieldset>}
  <p className="sm-small sm-muted">执行引擎：{registry.execution.engine==='codex'?'代码开发工具':'通用开发工具'} · {registry.execution.model}。资料清单只展示可申请的名称，访问仍须负责人批准。</p>
  <div><button className="sm-button" disabled={building||!profile.name.trim()||!profile.responsibilities.trim()} onClick={()=>void build()}>{building?'正在检查…':'检查构建'}</button></div>
  {error&&<p className="sm-error" role="alert">{error}</p>}
  {preview&&<section className="sm-stack" aria-live="polite"><strong>构建通过 · {preview.toolNames.length} 项工具</strong><p className="sm-small sm-muted">DeepSeek Harness 已装配身份、工作方法与工具范围；没有执行模型或授予资料访问。</p><details className="sm-details"><summary>实际执行配置</summary><pre className="sm-builder-code">{preview.prompt}</pre><p className="sm-small">{preview.toolNames.join('、')}</p></details></section>}
 </div>;
}
