// Preserve the upstream optimistic-revision contract when updating an existing task document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Paperclip } from '../src/paperclip.ts';
test('document updates use the latestRevisionId returned by the real API contract', async () => {
  const pc = new Paperclip('http://127.0.0.1:3100'); const calls: any[] = [];
  pc.request = (async (method: string, route: string, body: any) => {
    calls.push({ method, route, body });
    return method === 'GET' ? { body: 'existing task checkpoint', latestRevisionId: 'revision-two' } : { latestRevisionId: 'revision-three' };
  }) as any;
  await pc.document('task', 'handoff', '交接包', 'updated checkpoint');
  assert.equal(calls[1].body.baseRevisionId, 'revision-two');
});

test('retrying a delivered document does not create another native revision',async()=>{
 const original=globalThis.fetch;let writes=0;
 globalThis.fetch=(async(_url:any,options:any)=>{if(options.method!=='GET')writes++;return new Response(JSON.stringify({title:'执行检查点',body:'同一轮已完成',latestRevisionId:'r1'}),{status:200});})as any;
 try{const pc=new Paperclip('http://localhost:3100');const result=await pc.document('task','checkpoint','执行检查点','同一轮已完成');assert.equal(result.latestRevisionId,'r1');assert.equal(writes,0);}finally{globalThis.fetch=original;}
});
