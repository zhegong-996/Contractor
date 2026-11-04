import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadConfig, runtime, secrets } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';

if (!process.argv.includes('--run')) throw new Error('Use --run for a native private-task grant/revoke test with no business content');
const config = loadConfig(), auth = secrets(), board = new Paperclip(config.paperclipUrl);
const viewerId = config.agents.workbuddy?.paperclipId, viewerToken = auth.paperclipTokens?.workbuddy;
if (!viewerId || !viewerToken) throw new Error('Run setup to provision the native access-check identity');
const viewer = new Paperclip(config.paperclipUrl, viewerToken);
const project = await board.post(`/companies/${config.companyId}/projects`, { name: '知识权限验证（测试资料）', status: 'in_progress', visibility: 'private',
  idempotencyKey: `privacy-smoke:${Date.now()}`, description: '原生 ACL 联调；没有真实客户、销售、财务或人事资料。' });
const issue = await board.post(`/companies/${config.companyId}/issues`, { projectId: project.id, title: '私有知识授权验证',
  description: '只有明确授权后才可读取本测试结论。', status: 'backlog', visibility: 'private', allowDuplicate: true });
await board.document(issue.id, 'knowledge-probe', '测试结论', '此内容只用于验证原生权限。');
await assert.rejects(viewer.get(`/issues/${issue.id}`), /404/);
await assert.rejects(viewer.get(`/issues/${issue.id}/documents/knowledge-probe`), /404/);
const grant = await board.post(`/issues/${issue.id}/access-grants`, { subjectType: 'agent', subjectId: viewerId });
assert.equal((await viewer.get(`/issues/${issue.id}`)).id, issue.id);
assert.match((await viewer.get(`/issues/${issue.id}/documents/knowledge-probe`)).body, /验证原生权限/);
await assert.rejects(viewer.get(`/projects/${project.id}`), /404/); // Task grant does not expose the entire professional space.
await board.post(`/issues/${issue.id}/access-grants/${grant.id}/revoke`, {});
await assert.rejects(viewer.get(`/issues/${issue.id}`), /404/);
await assert.rejects(viewer.get(`/issues/${issue.id}/documents/knowledge-probe`), /404/);
const evidence = { type: 'live-paperclip-native-acl', projectId: project.id, issueId: issue.id,
  viewer: 'configured workbuddy Agent principal; WorkBuddy application not launched',
  beforeGrant: 'denied', taskAfterGrant: 'readable', containingProjectAfterGrant: 'denied', afterRevoke: 'denied', customPermissionEngine: false };
writeFileSync(runtime('privacy-smoke-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
