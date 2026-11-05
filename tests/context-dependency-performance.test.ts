import test from 'node:test';import assert from 'node:assert/strict';
import {Workspaces} from '../src/workspaces.ts';import {contextHash} from '../src/context.ts';
test('shared history dependencies are checked once per read and rechecked on the next read',async()=>{
 const snapshots:any[]=[],body='original context',revision='current',hash=contextHash(body);let reads=0,changed=false;
 for(let i=0;i<18;i++)snapshots.push({id:'s'+i,key:'context-note',inputManifest:snapshots.slice(-2).map(s=>({kind:'note',id:s.id,key:s.key,revision,hash}))});
 const w:any={state:async()=>({snapshots}),pc:{get:async()=>{reads++;return{body:changed?'changed':body,latestRevisionId:revision};}}};w.assertManifest=Workspaces.prototype.assertManifest;
 const refs=[{kind:'note',id:'s17',key:'context-note',revision,hash}];await w.assertManifest({id:'task'},refs);assert.ok(reads<40,'a branching handoff history must not expand exponentially');changed=true;await assert.rejects(w.assertManifest({id:'task'},refs),/上下文已经变化/);
 snapshots[0].inputManifest=[{kind:'note',id:'s17',key:'context-note',revision,hash}];changed=false;await assert.rejects(w.assertManifest({id:'task'},refs),/依赖出现循环/);
});
