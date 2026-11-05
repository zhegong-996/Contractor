// Failures guarded: worker restart must not relaunch business work; a lost result
// response must retry the receipt only; a question ends the process instead of waiting.
import test from 'node:test';import assert from 'node:assert/strict';
import {nativeWorkGate} from '../src/native-worker.ts';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const folder=mkdtempSync(path.join(tmpdir(),'suitme-autoloop-'));process.env.AGENT_AUTOLOOP_HOME=folder;
const {createWorker}=await import(pathToFileURL(path.resolve('upstream/autoloop/worker/worker.ts')).href);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('the real Autoloop worker recovers its journal and retries a receipt without rerunning work',{timeout:20000},async()=>{
 const counter=path.join(folder,'started'),script=path.join(folder,'agent.cjs');
 writeFileSync(script,`require('node:fs').appendFileSync(${JSON.stringify(counter)},'1');setTimeout(()=>console.log('待你处理：请补充验收条件\\n\`\`\`agent-autoloop\\n'+JSON.stringify({ask:[{title:'请补充验收条件',text:'缺少本任务的通过标准',options:['补充说明','稍后处理'],about:'保留已完成材料，只接续新增验收要求',key:'criteria'}]})+'\\n\`\`\`'),150);`);
 let claim=nativeWorkGate(1),attempts=0,received:any;
 const hub={work:async(request:any)=>{if(claim(request,!!received,false)!=='offer')return{};return{job:{run:1,attempt:1,token:'bound',session:null,rule:{name:'当前任务',cwd:folder},agent:{id:'command',name:'fixture',use:'command',access:'read',command:[process.execPath,script],timeout:1},askFirst:['最终验收'],context:{events:[],answers:[],timers:[],waiting:[],open:[],decided:[]}}};},started:async()=>({}),result:async(_id:number,token:string,result:any)=>{assert.equal(token,'bound');if(++attempts===1)throw new Error('lost response');received=result;return{};}};
 const first=createWorker({hub,name:'first',capacity:1,wait:0});await first.tick();assert.equal(first.entries().length,1);
 claim=nativeWorkGate(1); // the native port restarts too; journal ownership must prevent another launch
 const recovered=createWorker({hub,name:'recovered',capacity:1,wait:0});
 try{const deadline=Date.now()+15000;while(!received&&Date.now()<deadline){await recovered.tick();await sleep(25);}assert.ok(received);assert.equal(readFileSync(counter,'utf8'),'1');assert.equal(attempts,2);assert.equal(received.ask.length,1);assert.equal(recovered.entries().length,0);}
 finally{for(const entry of recovered.entries())if(entry.pid)try{process.kill(-entry.pid,'SIGKILL');}catch{}rmSync(folder,{recursive:true,force:true});}
});
