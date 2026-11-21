import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { OctopResources } from '../src/workbench/octop-resources.ts';
import { openWorkerHarness, workerHarnessUpdate } from '../src/workbench/worker-harness.ts';

test('Worker 只装配项目指定的技能版本，跨 Worker 重新核权并保留历史快照', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const catalog = new OctopResources(db);
    const harness = openWorkerHarness(db, catalog);
    const publish = (project: string, text: string) => catalog.publishSkill(project, 'product', {
      slug: 'small-screen', title: '小屏核对', instructions: text,
    });
    const ref = ({ id, revision }: ReturnType<typeof publish>) => ({ id, revision });
    const v1 = ref(publish('store', '仅第 1 版技能'));
    const v2 = ref(publish('store', '仅第 2 版技能'));
    const another = ref(publish('other', '外部项目技能'));
    const save = (agent: string, owner: string, revision: string, selected: typeof v1) => harness.save('store', agent, owner, 'product',
      workerHarnessUpdate.parse({ revision, instructions: '本项目提示词', skills: [selected] }));
    const original = harness.view('store', 'codex', 'engineering', 'product').revision;
    assert.throws(() => save('codex', 'engineering', original, v1), { status: 403 });
    catalog.share(v1.id, 'engineering', true);
    assert.throws(() => save('codex', 'engineering', original, another), { status: 403 });
    const saved = save('codex', 'engineering', original, v1);
    const first = harness.assemble('store', 'codex', 'engineering', 'product');
    assert.match(first.text, /本项目提示词.*仅第 1 版技能/s);
    assert.doesNotMatch(first.text, /仅第 2 版技能/);
    assert.throws(() => save('codex', 'engineering', original, v2), { status: 409 });

    const replacement = harness.view('store', 'claude', 'product', 'product').revision;
    save('claude', 'product', replacement, v2);
    const second = harness.assemble('store', 'claude', 'product', 'product');
    assert.equal(second.stamp.skills[0]!.revision, v2.revision);
    assert.doesNotMatch(second.text, /仅第 1 版技能/);
    assert.equal(harness.assemble('other', 'codex', 'engineering', 'product').text, '');
    assert.equal(first.stamp.revision, saved.revision);
    assert.equal(harness.readable('store', 'outsider', first.stamp), false);
    catalog.share(v1.id, 'engineering', false);
    assert.throws(() => harness.assemble('store', 'codex', 'engineering', 'product'), { status: 409 });
    assert.equal(harness.current('store', 'engineering', 'product', first.stamp), false);
    assert.equal(harness.current('store', 'product', 'product', second.stamp), true);
    catalog.share(v1.id, 'engineering', true);
    assert.equal(harness.current('store', 'engineering', 'product', first.stamp), false);
  } finally { db.close(); }
});
