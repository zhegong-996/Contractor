import {useEffect,useState} from 'react';
const retained=new Map<string,any>();
const offers:Record<string,string>={feasibility:'需求评估与澄清',draft:'资料整理与工作稿',review:'成果审阅与交接'};
const clean=(p:any)=>{const{version,editable,...value}=p;return value;};
const requests=new Map<string,any>();
function ServiceRequest({profile,ui,onError}:{profile:any;ui:any;onError:(s:string)=>void}){
 const key=ui.prefix+'service-request:'+profile.id,[request,setRequest]=useState(()=>requests.get(key)??{goal:'',offer:profile.offers[0],requestKey:crypto.randomUUID()});
 function change(value:any){const next={...request,...value};requests.set(key,next);setRequest(next);}
 async function submit(){try{const task=await ui.invoke('invoke-agent-service',{serviceId:profile.id,expectedVersion:profile.version,offer:profile.offers.includes(request.offer)?request.offer:profile.offers[0],title:request.goal.trim().split('\n')[0].slice(0,100),goal:request.goal.trim(),requestKey:request.requestKey});change({goal:'',requestKey:crypto.randomUUID()});ui.openTask(task.id,'progress');}catch(e:any){onError(e.message);}}
 return <form className="sm-form sm-section" onSubmit={e=>{e.preventDefault();void submit();}}><label className="sm-field">需要它做什么<select className="sm-input" value={profile.offers.includes(request.offer)?request.offer:profile.offers[0]} onChange={e=>change({offer:e.target.value})}>{profile.offers.map((id:string)=><option key={id} value={id}>{offers[id]}</option>)}</select></label><label className="sm-field">需求与背景<textarea className="sm-input" value={request.goal} onChange={e=>change({goal:e.target.value})} required/></label><div><button className="sm-button" disabled={ui.busy||!request.goal.trim()}>交给 Agent</button></div></form>;
}

export function AgentServicesPage({ui}:{ui:any}){
 const key=ui.prefix+'service-profiles', [registry,setRegistry]=useState<any>(),[draft,setDraft]=useState<any>(retained.get(key)),[selected,setSelectedState]=useState(()=>retained.get(key+':selection')??''),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 function setSelected(id:string){retained.set(key+':selection',id);setSelectedState(id);}
 async function load(){setError('');try{const value=await ui.read('agent-services',{});setRegistry(value);if(!retained.has(key)){const d={profiles:value.profiles.map(clean),revision:value.revision};retained.set(key,d);setDraft(d);}}catch(e:any){setError(e.message);}}
 useEffect(()=>{void load();},[key]);
 function retain(d:any){retained.set(key,d);setDraft(d);setSaved(false);}
 const profile=draft?.profiles.find((p:any)=>p.id===selected)??draft?.profiles[0],active=registry?.profiles.find((p:any)=>p.id===profile?.id);
 function edit(changes:any){retain({...draft,profiles:draft.profiles.map((p:any)=>p.id===profile.id?{...p,...changes}:p)});}
 async function save(){setError('');try{const value=await ui.invoke('save-agent-services',draft);setRegistry(value);retain({profiles:value.profiles.map(clean),revision:value.revision});setSaved(true);}catch(e:any){setError(e.message);}}
 function add(){const id=crypto.randomUUID();retain({...draft,profiles:[...draft.profiles,{id,key:'agent-'+id.slice(0,8),name:'',kind:'personal',ownerUserId:registry.ownerUserId,actorKey:registry.currentAgent??ui.data.actors[0]?.key,responsibilities:'',offers:['feasibility'],enabled:false}]});setSelected(id);}

 if(!registry||!draft)return error?<div className="sm-error" role="alert"><span>{error}</span><button className="sm-button" onClick={()=>void load()}>重新读取</button></div>:<p role="status">正在读取团队 Agent…</p>;
 return <section className="sm-stack"><div className="sm-section-head"><h2>团队 Agent</h2><button className="sm-button" onClick={add}>登记 Agent</button></div>
  {error&&<div className="sm-error" role="alert"><span>{error}</span><button className="sm-button" onClick={()=>{retained.delete(key);setDraft(undefined);void load();}}>载入已保存版本</button></div>}
  {!draft.profiles.length?<div className="sm-empty"><strong>先登记一个给同事使用的 Agent</strong>关联负责人、当前职责和现有资料权限身份。</div>:<div className="sm-space-layout"><div className="sm-source-list">{draft.profiles.map((p:any)=><button key={p.id} aria-current={profile?.id===p.id} onClick={()=>setSelected(p.id)}><strong>{p.name||'未命名 Agent'}</strong><span>{p.kind==='personal'?'个人 Agent':'公共 Agent'} · {p.enabled?'已上岗':'未上岗'}</span></button>)}</div><div className="sm-stack">
   <label className="sm-field sm-mobile-select">Agent<select className="sm-input" value={profile?.id??''} onChange={e=>setSelected(e.target.value)}>{draft.profiles.map((p:any)=><option key={p.id} value={p.id}>{p.name||'未命名 Agent'}</option>)}</select></label>
   {profile&&<>{active?.enabled&&<><h3>{active.name}</h3><p>{active.responsibilities}</p><ServiceRequest key={active.id} profile={active} ui={ui} onError={setError}/></>}{(!active||active.editable)&&<details key={profile.id} className="sm-details" open={!active}><summary>职责与上岗设置</summary><div className="sm-stack"><div className="sm-form-grid"><label className="sm-field">Agent 名称<input className="sm-input" value={profile.name} onChange={e=>edit({name:e.target.value})}/></label><label className="sm-field">类型<select className="sm-input" value={profile.kind} onChange={e=>edit({kind:e.target.value})}><option value="personal">个人 Agent</option><option value="shared">公共 Agent</option></select></label></div>
    <p className="sm-small sm-muted">负责人：{profile.ownerUserId===registry.ownerUserId?'你':profile.ownerUserId}</p>
    <label className="sm-field">当前职责<textarea className="sm-input" value={profile.responsibilities} onChange={e=>edit({responsibilities:e.target.value})}/></label>
    <fieldset className="sm-choices"><legend>为同事提供的服务</legend>{Object.entries(offers).map(([id,title])=><label key={id} className="sm-check"><input type="checkbox" checked={profile.offers.includes(id)} onChange={e=>edit({offers:e.target.checked?[...profile.offers,id]:profile.offers.filter((v:string)=>v!==id)})}/>{title}</label>)}</fieldset>
    <div className="sm-form-grid"><label className="sm-field">资料权限身份<select className="sm-input" value={profile.actorKey} onChange={e=>edit({actorKey:e.target.value})}>{ui.data.actors.map((a:any)=><option key={a.key} value={a.key}>{a.name}</option>)}</select></label><label className="sm-field">调用名<input className="sm-input" value={profile.key} onChange={e=>edit({key:e.target.value})}/></label></div>
    <label className="sm-check"><input type="checkbox" checked={profile.enabled} onChange={e=>edit({enabled:e.target.checked})}/>上岗，接受协作请求</label>
    <div className="sm-actions"><button className="sm-button" data-variant="primary" disabled={ui.busy} onClick={()=>void save()}>保存职责与服务</button>{saved&&<span role="status">已保存</span>}</div>
    <p className="sm-small sm-muted">修改职责不扩大资料权限；进行中的任务须核对新职责后继续。成员通过原生登录识别；资料身份在“成员与归属”中独立绑定。</p>
    </div></details>}
   </>}
  </div></div>}
 </section>;
}
