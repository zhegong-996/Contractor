import{existsSync,readFileSync,writeFileSync,symlinkSync}from'node:fs';import path from'node:path';
import{loadConfig,runtime,root}from'../src/config.ts';import{Store}from'../src/store.ts';import{Workspaces}from'../src/workspaces.ts';import{TeamMembers}from'../src/members.ts';
if(!process.argv.includes('--run'))throw new Error('Use --run for isolated simulation fixtures');
const c=loadConfig();if(c.paperclipUrl!=='http://127.0.0.1:3110'||!runtime().endsWith('/.runtime/team-pilot'))throw new Error('Refusing to seed the main workspace');
const actors=JSON.parse(readFileSync(runtime('pilot-secrets.json'),'utf8')),store=new Store(runtime('bridge.sqlite')),w=new Workspaces(c,store),team=new TeamMembers(w),actor={admin:true,userId:actors.admin.id};
const file=runtime('journey.json'),journey:any=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{kind:'three-distinct-native-users-simulation',sources:{},users:{}};
const save=()=>writeFileSync(file,JSON.stringify(journey,null,2),{mode:0o600});
const specs=[
 {key:'requester',space:'reservation-project',spaceName:'预约项目',records:[{id:'goal',title:'模拟项目：预约体验页目标与验收',facts:{场景:'模拟门店预约',数据:'仅演练样例'},body:'这是模拟业务场景。制作清野门店的预约体验页：展示项目标题、示例时段、预约表单和预约记录。提交后给出明确反馈，刷新后能恢复本地记录。具体预约口径请由活动资料负责人确认，页面技术约束请由交付协作者确认。验收区分静态演示、真实接口和生产发布；本轮只交付静态演示与PR。不得提交真实客户资料。'}]},
 {key:'owner',space:'activity-guidance',spaceName:'活动与资料治理',records:[{id:'policy',title:'模拟资料：预约对外口径',facts:{确认状态:'待门店确认',适用范围:'本次静态演练'},body:'这是模拟业务资料。预约提交后统一显示“预约待门店确认”；展示示例时段，不承诺已经锁定名额。表单注明“仅为演示，不会向门店发送预约”。可公开使用以上模拟对外口径制作静态页。内部成本、客户联系资料不得随口径共享。沉淀规范时保留适用范围、来源版本与负责人审阅结论。'},{id:'private',title:'模拟受限资料：内部成本',facts:{保密标记:'SIM-INTERNAL-COST-73',示例成本:73},body:'这是专用于隔离验证的虚构资料。内部成本标记 SIM-INTERNAL-COST-73，示例成本为73。此条不列入可申请资料、不进入预约任务、不传给其他成员的Agent或GitHub。它不是访问凭据，也不含真实经营信息。'}]},
 {key:'specialist',space:'web-delivery',spaceName:'页面交付约束',records:[{id:'technical',title:'模拟资料：预约页实现约束',facts:{形态:'独立HTML',存储:'localStorage',外部请求:false},body:'这是模拟交付约束。使用独立HTML、内联样式与脚本，修改范围为collab-pilot/index.html。示例姓名和联系方式仅用于演练，不采集真实个人信息。提交前验证必填项；示例手机号采用11位数字。保存预约记录到localStorage，刷新后恢复；页面不发送网络请求。交付需保留PR、同一提交的CI和本地预览版本，逐项验收后由需求发起人确认。'}]},
];
for(const spec of specs){const user=actors.users.find((u:any)=>u.key===spec.key);if(!w.catalog().memberAgents?.[user.id])await team.provision({userId:user.id},actor);const key=w.catalog().memberAgents![user.id]!;journey.users[spec.key]={id:user.id,name:user.name,agent:key};
 await w.configureSpace({id:spec.space,name:spec.spaceName,agent:key,description:'三用户隔离验证的模拟资料空间'},actor);const space=w.catalog().spaces[spec.space]!;
 await w.pc.post('/projects/'+space.projectId+'/access-members',{subjectType:'agent',subjectId:c.agents[key]!.paperclipId});await w.pc.post('/projects/'+space.projectId+'/access-members',{subjectType:'user',subjectId:user.id});await w.syncSpaceMembers(spec.space,actor);
 for(const record of spec.records)if(!journey.sources[record.id]){const created=await w.createSource(spec.space,{key:'knowledge-'+record.id,title:record.title,kind:record.id==='goal'?'reference':'procedure',domains:[spec.space],appliesTo:'仅限标记为模拟的三用户预约页协作验证',facts:record.facts,body:record.body,sources:['https://github.com/zhegong-996/suitme-collab']},actor);journey.sources[record.id]=created.source;save();}
}
const venv=runtime('cognee-venv');if(!existsSync(venv))symlinkSync(path.join(root,'.runtime/cognee-venv'),venv,'dir');
await w.pc.patch('/companies/'+c.companyId,{name:'SuitMe 三用户验证（模拟）'});journey.companyId=c.companyId;journey.boardUrl=c.paperclipUrl;save();store.close();console.log(JSON.stringify({kind:journey.kind,users:Object.values(journey.users),sources:Object.keys(journey.sources),knowledgeState:'candidate; each owner must confirm through the frontend'}));
