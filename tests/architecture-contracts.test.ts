// 方案 A 守门：架构契约单一来源、组织本体行为不变、上游锁文件与合规文档一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { NODE_KINDS, EDGE_FAMILIES, EDGE_RULES, AGENT_ROLES, AGENT_RUNTIME_SOURCES,
  MEMORY_PROJECTIONS, MEMORY_EVENT_KINDS, ONTOLOGY_LAYERS, memoryEventSchema,
  architectureContractSummary } from '../src/architecture-contracts.ts';
import { validateOrgGraph, type OrgGraph } from '../src/org-ontology.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('组织本体常量只有一份来源，domain/range 规则覆盖全部边族', () => {
  assert.equal(NODE_KINDS.length, 16);
  assert.equal(EDGE_FAMILIES.length, 5);
  assert.deepEqual(Object.keys(EDGE_RULES).sort(), [...EDGE_FAMILIES].sort());
  for (const [family, rule] of Object.entries(EDGE_RULES)) {
    assert.ok(rule.from.length && rule.to.length, `${family} 必须声明双向类型约束`);
    for (const kind of [...rule.from, ...rule.to])
      assert.ok((NODE_KINDS as readonly string[]).includes(kind), `${family} 引用了未定义节点类型 ${kind}`);
  }
  // org-ontology.ts 不再自行定义常量，只从契约层引入并再导出。
  const org = read('src/org-ontology.ts');
  assert.doesNotMatch(org, /export const (NODE_KINDS|EDGE_FAMILIES|EDGE_RULES)\s*=/);
  assert.match(org, /from '\.\/architecture-contracts\.ts'/);
  assert.match(org, /export \{ NODE_KINDS, EDGE_FAMILIES, EDGE_RULES \}/);
});

test('共享契约给出三层 ontology、三层 Agent 角色与四套运行时来源', () => {
  assert.deepEqual(ONTOLOGY_LAYERS.map(l => l.id), ['space-dictionary', 'organization-graph', 'cognee-graph-model']);
  assert.deepEqual([...AGENT_ROLES], ['personal', 'supervisor', 'worker']);
  assert.equal(AGENT_RUNTIME_SOURCES.length, 4);
  assert.deepEqual([...MEMORY_PROJECTIONS], ['l1-evidence', 'l2-organization', 'bm25-vector', 'context-pack']);
  assert.ok(MEMORY_EVENT_KINDS.length >= 7);
  const summary = architectureContractSummary();
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.nodeKinds, NODE_KINDS.length);
  assert.equal(summary.edgeFamilies, EDGE_FAMILIES.length);
  assert.deepEqual(summary.agentRoles, AGENT_ROLES);
});

test('记忆事件强制溯源字段，不允许缺 actor / at 或伪造 sourceRef', () => {
  const valid = { id: 'evt-1', kind: 'edge-drafted', actor: 'agent-1', at: '2026-11-07T00:00:00.000Z',
    sourceRef: { sourceId: 'src-1', revision: 'r3' }, payload: { edgeId: 'e1' } };
  assert.deepEqual(memoryEventSchema.parse(valid).payload, { edgeId: 'e1' });
  assert.throws(() => memoryEventSchema.parse({ ...valid, actor: '' }));
  assert.throws(() => memoryEventSchema.parse({ ...valid, at: undefined }));
  assert.throws(() => memoryEventSchema.parse({ ...valid, sourceRef: { sourceId: 'src-1' } }));
  assert.throws(() => memoryEventSchema.parse({ ...valid, kind: 'unknown-event' }));
  assert.throws(() => memoryEventSchema.parse({ ...valid, unexpected: true }));
});

test('抽取常量后 L2 图校验行为不变：domain/range 与证据引用仍然强制', () => {
  const base: OrgGraph = { schemaVersion: 1,
    nodes: [{ id: 'p1', kind: 'person', label: '成员', at: '2026-11-07T00:00:00.000Z' },
      { id: 'r1', kind: 'role', label: '职能', at: '2026-11-07T00:00:00.000Z' }],
    edges: [{ id: 'e1', family: 'belongs_to_role', from: 'p1', to: 'r1', state: 'draft',
      evidenceRefs: [], actor: 'agent-1', at: '2026-11-07T00:00:00.000Z' }] };
  assert.doesNotThrow(() => validateOrgGraph(base));
  assert.throws(() => validateOrgGraph({ ...base,
    edges: [{ ...base.edges[0]!, family: 'verified_by' }] }), /本体规则/);
  assert.throws(() => validateOrgGraph({ ...base,
    edges: [{ ...base.edges[0]!, state: 'accepted' }] }), /证据引用/);
});

test('七个上游全部登记在 sources.lock.json 且与 gitlink 一致，合规文档无过时告警', () => {
  const modules = read('.gitmodules');
  const lock = JSON.parse(read('sources.lock.json')) as {
    sources: Record<string, { url: string; commit: string; license: string }>;
  };
  const paths = [...modules.matchAll(/path = ([^\n]+)/g)].map(m => m[1]!.trim());
  assert.equal(paths.length, 7);
  for (const p of paths) {
    const key = path.basename(p);
    const entry = lock.sources[key];
    assert.ok(entry, `${key} 未登记在 sources.lock.json`);
    assert.match(entry.url, /^https:\/\/github\.com\//);
    assert.ok(['MIT', 'Apache-2.0'].includes(entry.license));
    const gitlink = execFileSync('git', ['ls-files', '-s', '--', p], { cwd: root, encoding: 'utf8' })
      .trim().split(/\s+/)[1] ?? '';
    assert.equal(gitlink, entry.commit, `${key} 的 gitlink 与锁文件不一致`);
  }
  assert.doesNotMatch(read('docs/OPEN-SOURCE-COMPLIANCE.md'), /缺 `sources\.lock\.json` 条目/);
});
