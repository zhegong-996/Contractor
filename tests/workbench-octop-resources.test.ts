import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { OctopResources } from '../src/workbench/octop-resources.ts';

test('Octop 技能版本和授权代次独立，模板只保存发布字段', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const catalog = new OctopResources(db);
    const v1 = catalog.publishSkill('store', 'product', { slug: 'narrow', title: '小屏', instructions: '360px' });
    const v2 = catalog.publishSkill('store', 'product', { slug: 'narrow', title: '小屏', instructions: '320px' });
    assert.equal(v1.id, v2.id);
    assert.notEqual(v1.revision, v2.revision);
    assert.equal(catalog.skill(v1.id, v1.revision)?.instructions, '360px');
    assert.equal(catalog.authority(v1.id, 'design', 'product'), undefined);
    catalog.share(v1.id, 'design', true);
    catalog.share(v1.id, 'engineering', true);
    const previous = catalog.authority(v1.id, 'design', 'product');
    assert.equal(previous, 1);
    catalog.share(v1.id, 'design', true);
    assert.equal(catalog.authority(v1.id, 'design', 'product'), previous);
    catalog.share(v1.id, 'design', false);
    assert.equal(catalog.authority(v1.id, 'design', 'product'), undefined);
    assert.equal(catalog.authority(v1.id, 'engineering', 'product'), 1);
    catalog.share(v1.id, 'design', true);
    assert.equal(catalog.authority(v1.id, 'design', 'product'), 3);

    const published = { title: '门店专家模板', instructions: '只读核对', capability: '核对换行', function: 'review' };
    catalog.saveExpert({ ...published, instructions: '私有专家说明', id: 'expert', project: 'store', owner: 'product' });
    const ref = { id: v1.id, revision: v1.revision };
    catalog.setMount('expert', ref, true);
    const revision = catalog.publishTemplate('expert', published, 'expert', catalog.mounts('expert'));
    catalog.setMount('expert', { id: v2.id, revision: v2.revision }, true);
    assert.deepEqual(catalog.template('expert'), { ...published, kind: 'expert', revision, skills: [ref] });
    assert.equal(catalog.experts('other').length, 0);
  } finally { db.close(); }
});
