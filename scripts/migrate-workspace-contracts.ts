import { loadConfig, runtime, secrets } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Paperclip } from '../src/paperclip.ts';
import { Workspaces, contractProof } from '../src/workspaces.ts';
const c = loadConfig(), store = new Store(runtime('bridge.sqlite')), pc = new Paperclip(c.paperclipUrl), w = new Workspaces(c, store);
let count = 0;
try {
  for (const task of store.list().filter(t => t.kind === 'collaboration')) {
    const issue = await pc.get('/issues/' + task.id);
    if (issue.companyId !== c.companyId || issue.projectId !== w.catalog().coordinationProject || issue.visibility !== 'private') throw new Error('Unexpected workflow boundary');
    const doc = await pc.get('/issues/' + task.id + '/documents/collaboration'), state = JSON.parse(doc.body);
    if (state.proof) continue;
    for (const id of state.sources) w.source(id);
    for (const id of state.requests) {
      const requestDoc = await pc.get('/issues/' + id + '/documents/access-contract'), r = JSON.parse(requestDoc.body);
      if (r.taskId !== task.id || r.id !== id) throw new Error('Request binding mismatch');
      w.source(r.sourceId); w.domain(r.agent);
      if (r.approvalId) {
        const a = await pc.get('/approvals/' + r.approvalId);
        if (a.companyId !== c.companyId || a.payload?.accessRequestId !== id || a.payload?.agent !== r.agent || a.payload?.sourceId !== r.sourceId) throw new Error('Native approval mismatch');
      }
      if (r.state === 'expired' && Date.parse(r.expiresAt) > Date.now()) { r.state = 'revoked'; r.reason = '修正恢复撤权时的状态归类；资料权限未恢复'; }
      r.proof = contractProof('request', id, r, secrets().jwtSecret);
      await pc.request('PUT', '/issues/' + id + '/documents/access-contract', { title: requestDoc.title, format: 'markdown', body: JSON.stringify(r, null, 2), baseRevisionId: requestDoc.latestRevisionId });
    }
    state.history.push({ at: new Date().toISOString(), event: 'contract-migrated', detail: { reviewedBy: 'local-operator', source: 'native-project-and-approval-bindings' } });
    state.proof = contractProof('task', task.id, state, secrets().jwtSecret);
    await pc.request('PUT', '/issues/' + task.id + '/documents/collaboration', { title: doc.title, format: 'markdown', body: JSON.stringify(state, null, 2), baseRevisionId: doc.latestRevisionId }); count++;
  }
  console.log(JSON.stringify({ migrated: count, nativePermissionsChanged: false }));
} finally { store.close(); }
