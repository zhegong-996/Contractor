import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectTranscript, toMemoryNotes, guardKnowledge, assertGuardIsAdvisory,
  type KnowledgeRecordLike,
} from '../src/knowledge-guard.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';
import type { TranscriptEvent, WikiPage } from '../src/memory-hierarchy.ts';

const event = (id: string, kind: string, at = '2026-11-08T01:00:00Z'): MemoryEvent =>
  ({ id, kind, actor: 'tester', at, payload: {} }) as unknown as MemoryEvent;

const transcript: TranscriptEvent[] = [
  { id: 'e001', at: '2026-11-08T01:00:00Z', kind: 'source-added' },
  { id: 'e002', at: '2026-11-08T01:01:00Z', kind: 'knowledge-proposed' },
  { id: 'e003', at: '2026-11-08T01:02:00Z', kind: 'source-revoked', revoked: true },
];

const record = (patch: Partial<KnowledgeRecordLike> = {}): KnowledgeRecordLike => ({
  key: 'knowledge-a', title: '主题 A', state: 'candidate', body: '正文不进报告',
  ...patch,
});

const pages: WikiPage[] = [
  { id: 'p-index', title: '索引', body: '列出主题', links: ['p-a'], claimEventIds: ['e001'] },
  { id: 'p-a', title: '主题 A', body: 'A 的结论', links: ['p-index'], claimEventIds: ['e002'] },
];

test('P-8 真实事件流归一化：撤回类事件标 revoked，原事件不被改写', () => {
  const source = [event('e001', 'source-added'), event('e003', 'source-revoked')];
  const before = JSON.stringify(source);
  const result = collectTranscript(source);
  assert.equal(result[0]?.revoked, undefined);
  assert.equal(result[1]?.revoked, true);
  assert.equal(JSON.stringify(source), before);
});

test('P-8 真实记录缺 evidenceEventIds 时如实留空，不编造事件 id', () => {
  const notes = toMemoryNotes([record()]);
  assert.deepEqual(notes[0]?.evidenceEventIds, []);
  assert.equal(notes[0]?.status, 'candidate');
});

test('P-8 有事实源挂靠的记录通过体检，正文不进报告', () => {
  const report = guardKnowledge({
    records: [record({ evidenceEventIds: ['e001', 'e002'] })], transcript, pages, corpusBytes: 40000,
  });
  assert.equal(report.groundedRecords, 1);
  assert.equal(report.gapRecords, 0);
  assert.deepEqual(report.findings, []);
  assert.ok(!JSON.stringify(report).includes('正文不进报告'));
  assert.equal(report.wiki.pages, 2);
});

test('P-8 真实知识库全部缺挂靠时如实报缺口，不把有缺口包装成通过', () => {
  const report = guardKnowledge({ records: [record(), record({ key: 'knowledge-b', title: '主题 B' })], transcript });
  assert.equal(report.activeRecords, 2);
  assert.equal(report.groundedRecords, 0);
  assert.equal(report.gapRecords, 2);
  assert.equal(report.findings.filter(f => f.code === 'missing-evidence').length, 2);
  assert.ok(report.findings.every(f => f.severity === 'gap'));
  assert.equal(report.unwired.length, 4);
  assert.ok(report.unwired[0]?.includes('KnowledgeService.propose'));
});

test('P-8 悬空证据、已撤回证据、无签字确认分别报出对应 code', () => {
  const report = guardKnowledge({ records: [
    record({ key: 'k-dangling', evidenceEventIds: ['ghost'] }),
    record({ key: 'k-revoked', evidenceEventIds: ['e003'] }),
    record({ key: 'k-unsigned', state: 'confirmed', evidenceEventIds: ['e001'] }),
  ], transcript });
  const codes = new Set(report.findings.map(f => f.code));
  assert.ok(codes.has('dangling-evidence'));
  assert.ok(codes.has('revoked-evidence'));
  assert.ok(codes.has('unsigned-confirmation'));
  assert.equal(report.groundedRecords, 0);
});

test('P-8 已撤回知识记录跳过挂靠校验，不计入缺口', () => {
  const report = guardKnowledge({ records: [record({ state: 'withdrawn' })], transcript });
  assert.equal(report.activeRecords, 0);
  assert.equal(report.gapRecords, 0);
  assert.deepEqual(report.findings, []);
});

test('P-8 wiki 悬空链接 / 无出处断言 / 膨胀全部进入 findings', () => {
  const broken: WikiPage[] = [
    { id: 'p-x', title: '地图', body: 'x'.repeat(300), links: ['p-missing'], claimEventIds: ['e999'] },
  ];
  const report = guardKnowledge({ records: [], transcript, pages: broken, corpusBytes: 10 });
  const codes = new Set(report.findings.map(f => f.code));
  assert.ok(codes.has('wiki-dangling-link'));
  assert.ok(codes.has('wiki-ungrounded'));
  assert.ok(codes.has('wiki-bloated'));
  assert.equal(report.wiki.bloated, true);
});

test('P-8 注入顶层超预算被如实报出，且注入条目只含索引字段', () => {
  const many = Array.from({ length: 30 }, (_, i) => record({
    key: 'k-' + i, state: 'confirmed', confirmedBy: 'owner', injected: true,
    evidenceEventIds: ['e001'],
  }));
  const report = guardKnowledge({ records: many, transcript, maxLines: 2 });
  assert.equal(report.injectedLines, 2);
  assert.ok(report.findings.some(f => f.code === 'injected-over-budget'));
});

test('P-8 体检结果确定性：同输入同签名，改动记录即变签名', () => {
  const input = { records: [record()], transcript, pages, corpusBytes: 40000 };
  const a = guardKnowledge(input), b = guardKnowledge(input);
  assert.equal(a.signature, b.signature);
  const c = guardKnowledge({ ...input, records: [record({ title: '主题 A′' })] });
  assert.notEqual(a.signature, c.signature);
});

test('P-8 体检恒为只读 advisory：不拦截、零模型调用、不带身份或凭据', () => {
  const report = guardKnowledge({ records: [record()], transcript });
  assert.equal(report.advisory, true);
  assert.equal(report.blocking, false);
  assert.equal(report.modelCalls, 0);
  assert.deepEqual(assertGuardIsAdvisory(report), { advisory: true, blocking: false });
  assert.throws(() => assertGuardIsAdvisory({ ...report, blocking: true as unknown as false }),
    /只读 advisory/);
  assert.throws(() => assertGuardIsAdvisory({ ...report, modelCalls: 1 as unknown as 0 }),
    /只读 advisory/);
});

test('P-8 守门模块不引入宿主读取依赖，接线由 server.ts 显式完成', () => {
  const source = readModuleSource();
  assert.ok(!/from '\.\/knowledge\.ts'|from '\.\/paperclip\.ts'/.test(source));
  assert.ok(!/readFileSync|fetch\(/.test(source));
  assert.ok(/guardKnowledge\(/.test(source));
});

function readModuleSource(): string {
  // 静态核对：守门模块自身不引入宿主读取依赖，接线由 server.ts 显式完成。
  return readFileSync(new URL('../src/knowledge-guard.ts', import.meta.url), 'utf8');
}
