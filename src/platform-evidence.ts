import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from './config.ts';
import type { Task } from './store.ts';

export function platformFingerprint() {
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else if (e.isFile() && /\.(ts|tsx|json|yml)$/.test(e.name)) files.push(file);
    }
  }
  for (const dir of ['src', 'scripts', 'tests', 'fixtures', 'plugins/knowledge-workspaces/src']) walk(dir);
  files.push('package.json', 'package-lock.json', 'sources.lock.json');
  const h = createHash('sha256');
  for (const f of files.sort()) h.update(f + '\0').update(readFileSync(path.join(root, f)));
  return h.digest('hex');
}
export function platformTestEvidence() {
  const file = runtime('platform-validation.json');
  if (!existsSync(file)) return { state: 'unrecorded' };
  const report = JSON.parse(readFileSync(file, 'utf8'));
  return { ...report, state: report.fingerprint === platformFingerprint() && report.fingerprintUnchanged ? 'current' : 'stale',
    meaning: '平台自动测试结果，不代表业务功能或人工验收通过' };
}
// Caller must first verify native read permission on the explicitly linked task.
// Read only hashed files from the verified delivery artifact, never the worktree.
export function deliveryArtifactEvidence(task: Task) {
  const d = task.delivery;
  if (!d?.deployedSha || d.deployedSha !== d.headSha || d.ci !== 'passed') return { state: 'unverified' };
  const dir = runtime('previews', task.id, d.deployedSha), version = JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8'));
  if (version.commit !== d.headSha) throw new Error('交付产物版本不一致');
  let budget = 32000;
  const files = (version.files ?? []).slice(0, 6).map((f: { name: string; sha256: string }) => {
    if (!/^[a-zA-Z0-9][\w.\-\u4e00-\u9fff]*\.(json|md|txt)$/.test(f.name) || f.name.includes('..')) throw new Error('交付文件名超出范围');
    const file = path.join(dir, f.name), size = statSync(file).size;
    if (size > budget) return { name: f.name, sha256: f.sha256, size, omitted: '超过本轮读取预算' };
    const body = readFileSync(file, 'utf8');
    if (createHash('sha256').update(body).digest('hex') !== f.sha256) throw new Error('交付文件哈希不一致');
    budget -= size;
    if (f.name.endsWith('.json')) JSON.parse(body);
    return { name: f.name, sha256: f.sha256, size, body, ...(f.name.endsWith('.json') ? { validJson: true } : {}) };
  });
  return { state: 'verified', commit: version.commit, files };
}
