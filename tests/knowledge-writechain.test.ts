// 13a（第 13 条写入链改造，第三十一轮落地）的契约测试：
//   ① propose / revise 挂靠证据锚点 + 悬空证据拒绝（向后兼容旧文档）；
//   ② wiki 是投影（可重建、不是第二事实源）：链接完整、断言挂事实源、撤回不进地图；
//   ③ 注入索引与 Context Pack 分工：只收人审批准提升的已确认知识，提出时不得自带；
//   ④ Dreaming 建议接 C-6 候选闸门：登记 + 查重，红线（不自动采用）由 assertDreamProposals 焊死。
// 读分区（canReadKnowledge）同步覆盖：个人区仅归属者本人与管理员可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeService, renderKnowledge, parseKnowledge, type Knowledge } from '../src/knowledge.ts';
import { configSchema } from '../src/config.ts';
import { Store, type Task } from '../src/store.ts';
import { MemoryLog, InMemorySink, setMemoryLog } from '../src/memory-log.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';
import { knowledgeToWikiPages, buildKnowledgeInjectedIndex, knowledgeWikiViewFrom, toTranscriptEvents } from '../src/knowledge-representation.ts';
import { dreamFromKnowledge, registerDreamProposals } from '../src/dreaming.ts';
import { canReadKnowledge } from '../src/knowledge-authz.ts';

const config = configSchema.parse({ companyId: 'company', projectId: 'project', paperclipUrl: 'http://127.0.0.1:3100',
  repository: 'test/repo', checkout: '/tmp/test', allowedPaths: ['pilot/'], agents: {}, defaultAgent: 'test', feishu: { profile: 'test' } });

/** 与 knowledge.test.ts 相同的 fake Paperclip：文档存在内存里，可断言写入内容。 */
class FakePc {
  docs = new Map<string, { body: string; latestRevisionId: string; title: string }>();
  private n = 0;
  get = (async (route: string) => {
    if (route.endsWith('/documents')) return [...this.docs.keys()].map(key => ({ key }));
    const match = /^\/issues\/([^/]+)\/documents\/([^/]+)$/.exec(route);
    if (match) { const doc = this.docs.get(match[2]!); if (!doc) throw new Error('404 Not found'); return doc; }
    return { companyId: 'company', projectId: 'project' };
  }) as any;
  document = (async (_taskId: string, key: string, title: string, body: string) => {
    this.docs.set(key, { body, title, latestRevisionId: 'rev-' + ++this.n });
  }) as any;
  request = (async (_method: string, route: string, body: { body: string; title: string }) => {
    const key = route.split('/documents/')[1]!;
    this.docs.set(key, { body: body.body, title: body.title, latestRevisionId: 'rev-' + ++this.n });
  }) as any;
}

const baseInput = {
  key: 'knowledge-anchor', title: '门店试用结论', domains: ['product'], kind: 'experiment',
  appliesTo: '本轮试点', body: '带原始证据的结论。', sources: ['https://example.org/evidence'],
};

function fixture(events: MemoryEvent[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-writechain-'));
  const store = new Store(path.join(dir, 'state.sqlite'));
  const task: Task = { id: 'source', identifier: 'SUI-1', triggerId: 'one', chatId: 'local', messageId: 'local', senderId: 'test', agent: 'manual',
    workspace: dir, branch: 'none', context: '{}', generation: 1, phase: 'ready' };
  store.save(task);
  const pc = new FakePc();
  const sink = new InMemorySink();
  setMemoryLog(new MemoryLog([sink]));
  const service = new KnowledgeService(config, store, pc as any, 'test-key', () => events);
  return { dir, store, task, pc, sink, service, teardown: () => { setMemoryLog(null); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('propose rejects dangling evidence instead of silently recording it', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.propose(f.task, { ...baseInput, evidenceEventIds: ['deadbeefdeadbeefdeadbeefdeadbeef'] }, 'agent:worker'),
      /悬空/);
    assert.equal(f.pc.docs.size, 0, '悬空证据必须在写入前拒绝，不得留下半成品文档');
  } finally { f.teardown(); }
});

test('propose anchors every candidate to the shared memory trunk and stays idempotent', async () => {
  const f = fixture();
  try {
    const created = await f.service.propose(f.task, baseInput, 'agent:worker');
    const anchorIds = created.value.evidenceEventIds;
    assert.ok(anchorIds.length >= 1, '服务端必须追加提出锚点，候选知识挂得回事实源');
    const trunk = f.sink.lines.map(line => JSON.parse(line) as MemoryEvent);
    for (const id of anchorIds) assert.ok(trunk.some(event => event.id === id), `锚点 ${id} 必须真的写进主干`);
    assert.ok(trunk.every(event => (event.modelCalls ?? 0) === 0), '锚点事件不得引入模型调用');
    // 幂等：同一任务同一 key 重试（如网络重试）不产生第二条锚点事件。
    await f.service.propose(f.task, { ...baseInput, body: '重试同一业务动作' }, 'agent:worker');
    const trunk2 = f.sink.lines.map(line => JSON.parse(line) as MemoryEvent);
    assert.equal(trunk2.length, trunk.length, '同一 idempotencyKey 重试不重复追加锚点');
    assert.equal(new Set(created.value.evidenceEventIds).size, created.value.evidenceEventIds.length, '证据去重');
  } finally { f.teardown(); }
});

test('propose keeps caller-provided evidence that exists in the trunk', async () => {
  const existing: MemoryEvent = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'source-ingested', actor: 'agent:worker',
    at: '2026-11-08T10:00:00Z', payload: {} };
  const f = fixture([existing]);
  try {
    const created = await f.service.propose(f.task, { ...baseInput, evidenceEventIds: [existing.id] }, 'agent:worker');
    assert.ok(created.value.evidenceEventIds.includes(existing.id), '调用方提供的既有事件要保留');
    assert.ok(created.value.evidenceEventIds.length >= 2, '既有证据 + 提出锚点同时在场');
  } finally { f.teardown(); }
});

test('review-time injection is the only path into the injected index; revise resets it', async () => {
  const f = fixture();
  try {
    const created = await f.service.propose(f.task, baseInput, 'agent:worker');
    assert.equal(created.value.injected, false, '提出时不得自带注入索引位');
    const revision = created.revision;
    const confirmed = await f.service.review({ taskId: 'source', key: baseInput.key }, 'confirmed', revision, 'user:reviewer', { inject: true });
    assert.equal(confirmed.value.injected, true, '人审确认 + 显式选择才提升');
    assert.equal(confirmed.value.confirmedBy, 'user:reviewer');
    const roundTrip = parseKnowledge(renderKnowledge(confirmed.value));
    assert.equal(roundTrip.injected, true, '注入位随 canonical 文档往返保留');
    // 修订（编辑已确认材料）重置 candidate 的同时退出注入索引，重新确认由人决定。
    const revised = await f.service.revise({ taskId: 'source', key: baseInput.key },
      { ...baseInput, body: '修订后的正文' }, 'agent:worker', { keepOwner: false });
    assert.equal(revised.value.state, 'candidate');
    assert.equal(revised.value.injected, false, '修订重置注入位');
    assert.ok(revised.value.evidenceEventIds.length >= 1, '修订同样挂锚点');
    const withdrawn = await f.service.review({ taskId: 'source', key: baseInput.key }, 'withdrawn', revised.revision, 'user:reviewer');
    assert.equal(withdrawn.value.injected, false, '撤回一律退出注入索引');
  } finally { f.teardown(); }
});

test('legacy documents without evidenceEventIds or injected still parse (backward compatible)', () => {
  const metadata = { schemaVersion: 1, companyId: 'company', projectId: 'project', sourceTaskId: 'source', key: 'knowledge-legacy',
    title: '旧记录', domains: ['product'], kind: 'decision', appliesTo: '旧试点', body: '正文', sources: ['https://example.org/a'],
    state: 'confirmed', updatedAt: '2026-11-01T00:00:00Z', proposedBy: 'agent', visibility: 'org', owner: 'agent:test',
    confirmedBy: 'user:reviewer', confirmedAt: '2026-11-02T00:00:00Z' };
  const body = `<!-- suitme-knowledge-v1\n${JSON.stringify(metadata, null, 2)}\n-->\n正文`;
  const parsed = parseKnowledge(body);
  assert.deepEqual(parsed.evidenceEventIds, [], '旧记录缺省空证据：读取兼容，体检如实报缺口');
  assert.equal(parsed.injected, false);
});

test('wiki projection links same-domain pages, grounds claims, and excludes withdrawn records', () => {
  const records = [
    { sourceTaskId: 't1', key: 'knowledge-a', title: 'A', domains: ['product'], appliesTo: 'a', body: '正文一', state: 'confirmed' as const, evidenceEventIds: ['e1'.padEnd(32, '0')] },
    { sourceTaskId: 't2', key: 'knowledge-b', title: 'B', domains: ['product'], appliesTo: 'b', body: '正文二', state: 'candidate' as const, evidenceEventIds: ['e2'.padEnd(32, '0')] },
    { sourceTaskId: 't3', key: 'knowledge-c', title: 'C', domains: ['growth'], appliesTo: 'c', body: '正文三', state: 'withdrawn' as const, evidenceEventIds: ['e3'.padEnd(32, '0')] },
  ];
  const pages = knowledgeToWikiPages(records);
  assert.equal(pages.length, 2, '撤回的记录不进知识地图');
  assert.deepEqual(pages.find(p => p.id === 't1/knowledge-a')!.links, ['t2/knowledge-b'], '同业务域互链');
  assert.deepEqual(pages.find(p => p.id === 't2/knowledge-b')!.links, ['t1/knowledge-a']);
  assert.deepEqual(pages.find(p => p.id === 't1/knowledge-a')!.claimEventIds, ['e1'.padEnd(32, '0')], '断言挂靠该记录的证据事件');
  const view = knowledgeWikiViewFrom(records, []);
  assert.equal(view.records, 3);
  assert.equal(view.pages.length, 2);
  assert.equal(view.modelCalls, 0);
  assert.equal(view.wiki.danglingLinks.length, 0, '投影不产生悬空链接');
});

test('injected index only admits confirmed, signed, grounded, human-promoted knowledge', () => {
  const mk = (patch: Partial<Knowledge>): KnowledgeRecordLikeInput => ({
    sourceTaskId: 't', key: 'knowledge-x', title: 'X', domains: ['product'], appliesTo: 'x', body: '正文',
    state: 'confirmed', confirmedBy: 'user:reviewer', evidenceEventIds: ['e'.padEnd(32, '0')], ...patch } as KnowledgeRecordLikeInput);
  const index = buildKnowledgeInjectedIndex([
    mk({ injected: true }), // 唯一合格：confirmed + 人签 + 证据 + 提升
    mk({ key: 'knowledge-no-inject' }), // 已确认但未提升
    mk({ key: 'knowledge-candidate', state: 'candidate', injected: true }), // 未确认不得混入
    mk({ key: 'knowledge-no-evidence', evidenceEventIds: [], injected: true }), // 无证据不得混入
  ]);
  assert.equal(index.entries.length, 1);
  assert.equal(index.entries[0]!.id, 't/knowledge-x');
  assert.ok(index.bytes <= 25 * 1024 && index.lines <= 200, '注入顶层预算不丢');
});

test('dreaming turns real knowledge into C-6 candidates with dedupe', () => {
  const records: KnowledgeRecordLikeInput[] = [
    { sourceTaskId: 't1', key: 'knowledge-promote', title: '可提升', domains: ['product'], appliesTo: 'p', body: '正文',
      state: 'confirmed', confirmedBy: 'user:reviewer', evidenceEventIds: ['e1'.padEnd(32, '0')], injected: false },
    { sourceTaskId: 't2', key: 'knowledge-broken', title: '证据缺失', domains: ['growth'], appliesTo: 'b', body: '正文',
      state: 'candidate', evidenceEventIds: [] },
  ];
  const events: MemoryEvent[] = [{ id: 'e1'.padEnd(32, '0'), kind: 'source-ingested', actor: 'agent:worker', at: '2026-11-08T10:00:00Z', payload: {} }];
  const proposals = dreamFromKnowledge(records as any, events);
  const kinds = proposals.map(p => p.kind);
  assert.ok(kinds.includes('promote-note'), '已确认未提升的知识应提请提升');
  assert.ok(kinds.includes('correct-note'), '缺证据的知识应建议纠正');
  assert.ok(proposals.every(p => p.requiresHumanReview === true && p.modelCalls === 0), '离线整理恒待人复核、零模型调用');

  const registered: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  const register = registerDreamProposals(({ id, title }) => { registered.push({ id, title }); seen.add(id); }, [], proposals);
  assert.equal(register.registered.length, proposals.length, '首次全部登记');
  const again = registerDreamProposals(({ id }) => { registered.push({ id, title: '' }); }, [...seen], proposals);
  assert.equal(again.registered.length, 0, '重复跑不堆重复候选');
  assert.ok(again.skippedDuplicates >= proposals.length);
  assert.ok(registered.every(item => item.title.startsWith('【离线整理】')), '候选标题带离线整理来源标识');
});

test('lenient listing skips malformed knowledge-* documents and reports the count honestly', async () => {
  const f = fixture();
  try {
    await f.service.propose(f.task, baseInput, 'agent:worker');
    // 模拟 knowledge-context 引用文件这类非结构化文档：key 命中前缀但正文不是条目。
    f.pc.docs.set('knowledge-context', { body: '[{"taskId":"x","key":"y"}]', latestRevisionId: 'r0', title: '引用知识' });
    const strict = await f.service.list().then(() => 'ok', error => String(error.message));
    assert.match(strict, /not a structured knowledge record/, '严格 list 遇坏行应抛错（既有语义不变）');
    const lenient = await f.service.listLenient();
    assert.equal(lenient.records.length, 1, '宽松列举保留合法条目');
    assert.equal(lenient.skipped, 1, '坏行如实计数，不静默吞掉');
  } finally { f.teardown(); }
});

test('read partition: personal entries are visible only to the owner (and admin tier), others fail closed', () => {
  const owner = { kind: 'human' as const, username: 'gong' };
  const stranger = { kind: 'human' as const, username: 'someoneelse' };
  const entry = { visibility: 'personal' as const, owner: 'user:gong' };
  assert.equal(canReadKnowledge(owner, entry).allowed, true, '归属者本人可读');
  assert.equal(canReadKnowledge(stranger, entry).allowed, false, '非归属者被拒（未初始化 casbin 时 fail-closed）');
  assert.equal(canReadKnowledge(stranger, { visibility: 'team', owner: 'user:gong' }).allowed, true, '协作区 / 组织区登录即可读');
  assert.equal(canReadKnowledge({ kind: 'agent', key: 'bot' }, entry).allowed, false, 'agent 同样不得读别人个人区');
});

test('transcript mapping keeps revoked memory events visible as revoked', () => {
  const events: MemoryEvent[] = [
    { id: 'a'.padEnd(32, '0'), kind: 'source-revoked', actor: 'user:x', at: '2026-11-08T10:00:00Z', payload: {} },
    { id: 'b'.padEnd(32, '0'), kind: 'fact-extracted', actor: 'user:x', at: '2026-11-08T10:01:00Z', payload: {} },
  ];
  const transcript = toTranscriptEvents(events);
  assert.equal(transcript[0]!.revoked, true, '撤权类事件映射为 revoked，证据校验据此拒绝');
  assert.equal(transcript[1]!.revoked, undefined);
});

type KnowledgeRecordLikeInput = {
  sourceTaskId: string; key: string; title: string; domains: string[]; appliesTo: string; body: string;
  state: 'candidate' | 'confirmed' | 'withdrawn'; evidenceEventIds: string[];
  confirmedBy?: string; injected?: boolean;
};
