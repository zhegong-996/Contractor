// 产物续改链 + 主题工作台（活文档）的契约：
// 续改不复制旧产物、修订可追溯；工作台只读、联动只在页面里算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  artifactRevisionByTask, continueArtifact, listArtifacts, listContinuations,
  readArtifact, registerArtifact, verifyArtifactRevision,
} from '../src/artifact.ts';
import { attachChannel, attachTask, createTopic } from '../src/topic.ts';
import { renderTopicWorkbench, workbenchRows } from '../src/topic-workbench.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'artifact-'));

test('产物登记：同一修订幂等，新修订追加且当前版跟着走', () => {
  const base = dir();
  const first = registerArtifact(base, { ref: 'report:SUI-128', title: '验收报告', revision: 'r1', by: 'ou_a', taskId: 't1' });
  assert.equal(first.current, 'r1');
  assert.equal(first.revisions.length, 1);

  const again = registerArtifact(base, { ref: 'report:SUI-128', revision: 'r1', by: 'ou_a' });
  assert.equal(again.revisions.length, 1, '重复登记同一版不得追加');

  const second = registerArtifact(base, { ref: 'report:SUI-128', revision: 'r2', by: 'ou_b', taskId: 't2' });
  assert.equal(second.current, 'r2');
  assert.deepEqual(second.revisions.map(r => r.revision), ['r1', 'r2']);
  assert.equal(readArtifact(base, 'report:SUI-128')!.current, 'r2');
  assert.equal(listArtifacts(base).length, 1);
  // 产物含真实标识，只给本人读写。
  assert.equal(statSync(path.join(base, 'artifacts', `${createHash('sha256').update('report:SUI-128').digest('hex').slice(0, 16)}.json`)).mode & 0o777, 0o600);
});

test('没有修订号就登记不了——回答不了「这一版哪来的」', () => {
  const base = dir();
  assert.throws(() => registerArtifact(base, { ref: 'report:x', revision: '', by: 'ou_a' }), /修订号不能为空/);
  assert.throws(() => registerArtifact(base, { ref: '', revision: 'r1', by: 'ou_a' }), /产物引用不能为空/);
});

test('续改接在最新版上，不复制旧产物', () => {
  const base = dir();
  registerArtifact(base, { ref: 'sheet:budget', title: '预算表', revision: 'v3', by: 'ou_a', taskId: 't1' });
  const run = continueArtifact(base, { ref: 'sheet:budget', by: 'ou_b', goal: '把预算改成 80 人档' });
  assert.equal(run.continuation.fromRevision, 'v3');
  assert.equal(run.continuation.toTaskId, null, '登记续改不等于建了任务');
  assert.match(run.brief, /v3 版上接着改/);
  assert.match(run.brief, /不新建副本/);
  assert.match(run.brief, /80 人档/);
  assert.equal(listContinuations(base).length, 1);
  // 旧修订仍在，可追溯。
  assert.equal(readArtifact(base, 'sheet:budget')!.revisions.length, 1);
});

test('续改未登记的产物要拒绝，不能凭空接一个不存在的版本', () => {
  const base = dir();
  assert.throws(() => continueArtifact(base, { ref: 'report:none', by: 'ou_a' }), /未登记/);
});

test('任务 → 最新产物修订号：巡检据此判断产物有没有被改过', () => {
  const base = dir();
  registerArtifact(base, { ref: 'a', revision: 'r1', by: 'ou_a', taskId: 't1' });
  registerArtifact(base, { ref: 'b', revision: 'r3', by: 'ou_a', taskId: 't1' });
  registerArtifact(base, { ref: 'c', revision: 'r2', by: 'ou_a', taskId: 't2' });
  registerArtifact(base, { ref: 'd', revision: 'r9', by: 'ou_a' });
  assert.deepEqual(artifactRevisionByTask(base), { t1: 'r3', t2: 'r2' });
});

test('工作台：按任务给状态与卡点，缺状态按 unknown 而不是编一个', () => {
  const base = dir();
  const topic = createTopic({ title: '闭门会筹备', goal: '把活动办完', ownerUserId: 'ou_a' }, base);
  attachChannel({ topicId: topic.id, kind: 'im', ref: 'oc_1', ownerUserId: 'ou_a' }, base);
  attachTask({ topicId: topic.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a', at: '2026-11-09T00:00:00Z' }, base);
  attachTask({ topicId: topic.id, taskId: 't2', roleId: 'role-product', ownerUserId: 'ou_b', at: '2026-11-09T00:00:00Z' }, base);
  const loaded = { ...topic, tasks: [
    { taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a', addedAt: '2026-11-09T00:00:00Z', addedBy: 'ou_a' },
    { taskId: 't2', roleId: 'role-product', ownerUserId: 'ou_b', addedAt: '2026-11-09T00:00:00Z', addedBy: 'ou_b' },
  ] };
  const rows = workbenchRows(loaded, { t1: { state: 'blocked', blockedReason: '等物料规格' } });
  assert.equal(rows[0]!.state, 'blocked');
  assert.equal(rows[0]!.blockedReason, '等物料规格');
  assert.equal(rows[1]!.state, 'unknown', '没状态的不能猜成正常');

  const html = renderTopicWorkbench(loaded, { states: { t1: { state: 'blocked', blockedReason: '等物料规格' } },
    generatedAt: '2026-11-09T01:00:00Z' });
  assert.match(html, /闭门会筹备/);
  assert.match(html, /把活动办完/);
  assert.match(html, /只读工作台/);
  assert.match(html, /f-state/);
  // 数据内嵌，不引外部资源：打开就能用，不依赖服务在线。
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script src=/);
});

test('V2 产物可信：登记即盖章，改元数据能查出来', () => {
  const base = dir();
  const artifact = registerArtifact(base, { ref: 'report:R1', revision: 'r1', by: 'ou_a', taskId: 't1', summary: '通过 3 项验收' });
  const revision = artifact.revisions[0]!;
  assert.ok(revision.seal, '登记时应生成 seal');
  assert.equal(verifyArtifactRevision(revision), true);
  assert.equal(verifyArtifactRevision({ ...revision, summary: '改成 5 项' }), false, '改了摘要应检出');
  assert.equal(verifyArtifactRevision({ ...revision, seal: undefined }), true, '旧数据无 seal 不阻断');
});
