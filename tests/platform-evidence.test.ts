import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'suitme-artifact-evidence-'));
process.env.COLLAB_STATE_DIR = folder;
const { deliveryArtifactEvidence } = await import('../src/platform-evidence.ts');
test('execution evidence reads only exact-SHA hashed delivery files and rejects tampering', () => {
  const sha = 'a'.repeat(40), dir = path.join(folder, 'previews', 'task', sha), body = '{"version":1,"phases":["intake"]}';
  mkdirSync(dir, { recursive: true });
  const version: any = { commit: sha, files: [{ name: 'contract.json', sha256: createHash('sha256').update(body).digest('hex') }] };
  const save = () => writeFileSync(path.join(dir, 'version.json'), JSON.stringify(version));
  writeFileSync(path.join(dir, 'contract.json'), body); save();
  const task: any = { id: 'task', delivery: { deployedSha: sha, headSha: sha, ci: 'passed' } };
  try {
    assert.equal(deliveryArtifactEvidence(task).state, 'verified');
    assert.equal((deliveryArtifactEvidence(task).files![0] as any).body, body);
    task.delivery.ci = 'pending'; assert.equal(deliveryArtifactEvidence(task).state, 'unverified'); task.delivery.ci = 'passed';
    writeFileSync(path.join(dir, 'contract.json'), '{"version":2}'); assert.throws(() => deliveryArtifactEvidence(task), /哈希/);
    version.files[0].name = '../outside.json'; save(); assert.throws(() => deliveryArtifactEvidence(task), /文件名/);
    version.commit = 'b'.repeat(40); save(); assert.throws(() => deliveryArtifactEvidence(task), /版本/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
