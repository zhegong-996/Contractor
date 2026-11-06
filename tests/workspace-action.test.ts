// Regression guard for a real-host bug found during the 1280px browser
// walkthrough: the plugin worker rejected every `v06-*` action because its
// allow-list regex had no digits. This test drives the actual guard and
// cross-checks every action name the UI sends against the bridge whitelist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { assertWorkspaceAction, WORKSPACE_ACTION } from '../plugins/knowledge-workspaces/src/action-name.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('action guard accepts lowercase names and the numbered v0.6 family', () => {
  for (const name of ['view', 'trace-view', 'memory-search', 'v06-plan-view', 'v06-round-view',
    'v06-review-readiness', 'v06-l2-status', 'v06-l2-edges-view', 'v06-org-overview', 'v06-context-pack'])
    assert.equal(assertWorkspaceAction(name), name);
  assert.equal(WORKSPACE_ACTION.test('v06-plan-view'), true);
});

test('action guard still rejects path traversal, uppercase, underscores and empty names', () => {
  for (const name of ['', '../etc/passwd', 'workspace/../../admin', 'V06-plan-view', 'v06_plan_view',
    'v06-plan-view?x=1', 'v06-plan-view#x', 'v06 plan view', 'v06-plan-view/../accept', 42, null, undefined])
    assert.throws(() => assertWorkspaceAction(name), /Invalid workspace action/);
});

test('worker delegates the action name check to the shared guard', () => {
  const worker = read('plugins/knowledge-workspaces/src/worker.ts');
  assert.match(worker, /assertWorkspaceAction\(params\.action\)/);
  assert.doesNotMatch(worker, /\/\^\[a-z-\]\+\$\//);
});

test('every v06-* action used by the UI is accepted; reads are whitelisted, writes have dispatch cases', () => {
  const sources = ['plugins/knowledge-workspaces/src/ui/v06-panels.tsx',
    'plugins/knowledge-workspaces/src/ui/index.tsx']
    .map(read).join('\n');
  // Distinguish reads (which must be in the read-only allow-list) from
  // mutations (which use the serialized lane and need a dispatch case).
  const reads = [...new Set([...sources.matchAll(/useRead\(ui,\s*'(v06-[a-z0-9-]+)'/g)].map(m => m[1]!))];
  const writes = [...new Set([...sources.matchAll(/ui\.run\(\s*'(v06-[a-z0-9-]+)'/g)].map(m => m[1]!))];
  assert.ok(reads.length >= 8, `只读 action 太少：${reads.length}`);
  assert.ok(writes.length >= 3, `写 action 太少：${writes.length}`);
  const server = read('src/server.ts');
  const members = read('src/members.ts');
  const dispatch = read('src/v06.ts');
  for (const action of [...reads, ...writes]) {
    assert.equal(assertWorkspaceAction(action), action);
    const bare = action.slice(4);
    assert.ok(dispatch.includes(`case '${bare}'`) || dispatch.includes(`'${bare}'`),
      `v06.ts 缺少 ${bare} 的处理`);
    if (reads.includes(action)) {
      assert.ok(server.includes(`'${bare}'`), `server.ts 只读白名单缺少 ${bare}`);
      assert.ok(members.includes(`'${bare}'`), `members.ts 只读白名单缺少 ${bare}`);
    }
  }
});
