// 真跑一个不依赖 Paperclip 的最小宿主，验证「换底座」路径可执行。
// 用法：npm run host:smoke
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalHostPlatform } from '../src/platform-port.ts';

const dir = mkdtempSync(path.join(os.tmpdir(), 'suitme-local-host-'));
const host = new LocalHostPlatform(dir);
const checks: any = {};

const health = await host.health();
checks.health = health;

const created = await host.post<any>('/companies/local-company/issues', {
  idempotencyKey: 'smoke-1', projectId: 'local-project', title: '本机宿主冒烟任务',
  status: 'backlog', assigneeAgentId: 'agent-local',
});
checks.createIssue = { id: created.id, identifier: created.identifier, status: created.status };

const again = await host.post<any>('/companies/local-company/issues', { idempotencyKey: 'smoke-1', title: '重复提交' });
checks.idempotent = again.id === created.id;

const first = await host.document(created.id, 'handoff', '任务交接包', '版本：1');
const same = await host.document(created.id, 'handoff', '任务交接包', '版本：1');
const second = await host.document(created.id, 'handoff', '任务交接包', '版本：2');
checks.documentRevisions = { first: first.latestRevisionId, unchanged: same.latestRevisionId === first.latestRevisionId,
  second: second.latestRevisionId, increased: Number(second.latestRevisionId) > Number(first.latestRevisionId) };

const fetched = await host.get<any>(`/issues/${created.id}/documents/handoff`);
checks.documentReadBack = fetched.body === '版本：2';

const patched = await host.patch<any>(`/issues/${created.id}`, { status: 'todo' });
const readIssue = await host.get<any>(`/issues/${created.id}`);
checks.patchStatus = patched.status === 'todo' && readIssue.status === 'todo';

await host.post(`/issues/${created.id}/comments`, { body: '冒烟评论', clientRequestId: 'smoke-comment' });
await host.post('/agents/agent-local/wakeup', { reason: 'workspace_preparation', payload: { issueId: created.id } });
checks.journal = host.journalLines().map(line => line.method);
checks.heartbeatRun = (await host.get<any>('/heartbeat-runs/run-1')).status;

let unsupported = '';
try { await host.get('/companies/local-company/cost-events'); }
catch (error) { unsupported = String(error); }
checks.unsupportedRouteFailsLoudly = unsupported.includes('尚未实现');
checks.capabilities = host.capabilities();
const ok = checks.health.status === 'ok'
  && checks.idempotent === true
  && checks.documentRevisions.increased === true
  && checks.documentRevisions.unchanged === true
  && checks.documentReadBack === true
  && checks.patchStatus === true
  && checks.journal.length >= 4
  && checks.heartbeatRun === 'succeeded'
  && checks.unsupportedRouteFailsLoudly === true;

console.log(JSON.stringify({ ok, tempDir: dir, checks }, null, 2));
if (!ok) process.exitCode = 1;
