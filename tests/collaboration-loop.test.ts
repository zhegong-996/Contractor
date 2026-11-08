/**
 * P-9 双向协作回路契约：验证「人和执行端之间必须有两条相反方向的移动」。
 * 全部是确定性纯函数，不读文件、不连宿主、不调模型。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loopReport, loopSignature, attachImplicitReplies, assertLoopAdvisory,
  fromAutoloopReceipt, fromHitlLedger, bridgeAnswerToResume, assertResumeProposal,
  mapFollowupToAnswer, dedupeLoopEvents, toLoopAt, type LoopEvent,
} from '../src/collaboration-loop.ts';

type Patch = Partial<LoopEvent>;
const ev = (patch: Patch): LoopEvent => ({
  id: 'e-' + Math.random().toString(36).slice(2), direction: 'downstream',
  kind: 'initiate', at: 1, taskId: 'T1', actor: 'originator', ...patch,
});
const fullCycle = (): LoopEvent[] => [
  ev({ id: 'd1', direction: 'downstream', kind: 'initiate', at: 1 }),
  ev({ id: 'q1', direction: 'upstream', kind: 'question', at: 2,
    actor: 'worker', expectsHumanAction: 'answer' }),
  ev({ id: 'a1', direction: 'downstream', kind: 'answer', at: 3,
    inReplyTo: 'q1' }),
  ev({ id: 'u2', direction: 'upstream', kind: 'progress', at: 4, actor: 'worker' }),
  ev({ id: 'r1', direction: 'downstream', kind: 'review', at: 5, inReplyTo: 'u2' }),
  ev({ id: 'ac', direction: 'downstream', kind: 'accept', at: 6,
    acceptance: true, actor: 'originator' }),
];

test('P-9 完整回合：上行提问 → 人回答 → 执行端继续 → 人复核核可', () => {
  const report = loopReport({ events: fullCycle(), humanOwners: ['originator'] });
  assert.equal(report.bidirectional, true);
  assert.equal(report.closedCycles, 1);
  assert.deepEqual(report.openLoops, []);
  assert.deepEqual(report.staleAnswers, []);
  assert.deepEqual(report.receiptWithoutReview, []);
  assert.deepEqual(report.oneWayTasks, []);
  assert.deepEqual(report.violations, []);
  assert.doesNotThrow(() => assertLoopAdvisory(report));
});

test('P-9 只有下行没有上行：判为单向推送，不是协作', () => {
  const report = loopReport({ events: [
    ev({ id: 'd1', direction: 'downstream', kind: 'initiate', at: 1 }),
    ev({ id: 'd2', direction: 'downstream', kind: 'authorize', at: 2 }),
  ] });
  assert.equal(report.bidirectional, false);
  assert.equal(report.upstream, 0);
  assert.deepEqual(report.oneWayTasks, ['T1']);
});

test('P-9 上行提问无人应答：如实列为断路，不编造回答', () => {
  const report = loopReport({ events: [
    ev({ id: 'd1', direction: 'downstream', kind: 'initiate', at: 1 }),
    ev({ id: 'q1', direction: 'upstream', kind: 'question', at: 2,
      actor: 'worker', expectsHumanAction: 'answer' }),
  ] });
  assert.equal(report.bidirectional, true);
  assert.equal(report.closedCycles, 0);
  assert.ok(report.openLoops.some(o => o.upstreamId === 'q1' && o.reason === 'no-human-reply'));
  assert.ok(report.findings.some(f => f.code === 'no-human-reply'));
});

test('P-9 关键回归：答完就消失是半条回路（P-6 单步链路的真实断点）', () => {
  const half: LoopEvent[] = [
    ev({ id: 'd1', direction: 'downstream', kind: 'initiate', at: 1 }),
    ev({ id: 'q1', direction: 'upstream', kind: 'question', at: 2,
      actor: 'worker', expectsHumanAction: 'answer' }),
    ev({ id: 'a1', direction: 'downstream', kind: 'answer', at: 3, inReplyTo: 'q1' }),
  ];
  const before = loopReport({ events: half });
  assert.deepEqual(before.staleAnswers, ['a1']);
  assert.ok(before.openLoops.some(o => o.reason === 'reply-not-followed-through'));
  assert.equal(before.closedCycles, 0);
  // 补上回流建议后半回路闭合：这正是本轮把「答案送回执行端」接通的效果。
  const after = loopReport({ events: half,
    resumeProposals: [{ id: 'resume:1', inReplyTo: 'a1' }] });
  assert.deepEqual(after.staleAnswers, []);
  assert.equal(after.closedCycles, 1);
  assert.equal(after.bidirectional, true);
});

test('P-9 回执不等于验收：标 acceptance 或非原发起人核可都判违规', () => {
  const forged = loopReport({ events: [
    ev({ id: 'u1', direction: 'upstream', kind: 'receipt', at: 1,
      actor: 'worker', expectsHumanAction: 'review', acceptance: true }),
  ] });
  assert.ok(forged.violations.some(v => v.code === 'acceptance-forged'));
  assert.throws(() => assertLoopAdvisory(forged), /红线被突破/);
  const wrongOwner = loopReport({ events: [
    ev({ id: 'ac', direction: 'downstream', kind: 'accept', at: 1,
      actor: 'worker', acceptance: true }),
  ], humanOwners: ['originator'] });
  assert.ok(wrongOwner.violations.some(v => v.code === 'acceptance-not-owner'));
});

test('P-9 回执后无人复核：必须继续把结果带回给人', () => {
  const report = loopReport({ events: [
    ev({ id: 'u1', direction: 'upstream', kind: 'receipt', at: 1,
      actor: 'worker', expectsHumanAction: 'review' }),
  ] });
  assert.deepEqual(report.receiptWithoutReview, ['u1']);
  assert.equal(report.closedCycles, 0);
});

test('P-9 自动批准接续一律拒绝：续跑建议必须 advisory 且待真人确认', () => {
  const report = loopReport({ events: [
    ev({ id: 'rr', direction: 'downstream', kind: 'resume-approved', at: 1 }),
  ] });
  assert.ok(report.violations.some(v => v.code === 'auto-resume'));
  const advisoryOnly = loopReport({ events: [
    ev({ id: 'rr', direction: 'downstream', kind: 'resume-approved', at: 1, advisory: true }),
  ] });
  assert.deepEqual(advisoryOnly.violations, []);
});

test('P-9 attachImplicitReplies：人直接回「继续」也能按时间就近配对，显式因果边优先', () => {
  const events: LoopEvent[] = [
    ev({ id: 'q1', direction: 'upstream', kind: 'question', at: 1,
      actor: 'worker', expectsHumanAction: 'answer' }),
    ev({ id: 'a1', direction: 'downstream', kind: 'answer', at: 2 }),
    ev({ id: 'q2', direction: 'upstream', kind: 'question', at: 3,
      actor: 'worker', expectsHumanAction: 'answer' }),
    ev({ id: 'a2', direction: 'downstream', kind: 'answer', at: 4, inReplyTo: 'q2' }),
  ];
  const attached = attachImplicitReplies(events);
  assert.equal(attached.find(e => e.id === 'a1')?.inReplyTo, 'q1');
  assert.equal(attached.find(e => e.id === 'a2')?.inReplyTo, 'q2');
  assert.equal(loopReport({ events: attached }).openLoops.filter(o => o.reason === 'no-human-reply').length, 0);
});

test('P-9 fromAutoloopReceipt：复用上游 ask/notice/later/outcome 语义，回执必待人复核', () => {
  const events = fromAutoloopReceipt({
    receiptId: 'R1', taskId: 'T1', agent: 'worker', at: 100,
    result: { outcome: 'done', ask: [{ title: '要不要继续', options: ['继续', '暂停'], key: 'k1' }],
      notice: [{}], later: [{}], resolve: [{ card: 1 }], events: [{}] },
  });
  assert.equal(events.filter(e => e.kind === 'receipt').length, 1);
  assert.equal(events.find(e => e.kind === 'receipt')?.expectsHumanAction, 'review');
  assert.equal(events.filter(e => e.kind === 'question').length, 1);
  assert.equal(events.filter(e => e.kind === 'progress').length, 2);
  // resolve / events 是本项目明确禁止的越界动作，不产生上行事件。
  assert.equal(events.some(e => e.id.includes('resolve') || e.id.includes('events')), false);
  const failed = fromAutoloopReceipt({ receiptId: 'R2', taskId: 'T1', agent: 'worker', at: 101,
    result: { outcome: 'failed', error: '需要本人登录' } });
  assert.equal(failed.filter(e => e.kind === 'blocked').length, 1);
});

test('P-9 fromHitlLedger：Runner 成对台账归一成上行提问 + 下行回答', () => {
  const events = fromHitlLedger({ events: [
    { id: 'q1', type: 'human_question', at: 1, from: 'step-runner',
      payload: { run_id: 'RUN1', step_no: 3, asker: 'worker-a', choices: ['继续', '暂停'] } },
    { id: 'a1', type: 'human_response', at: 2, from: 'human',
      payload: { question_id: 'q1', choice: '继续', actor: '原发起人', acceptance: false } },
    { id: 'orphan', type: 'human_question', at: 3, payload: {} },
  ] });
  assert.equal(events.length, 2);
  assert.equal(events[0]!.direction, 'upstream');
  assert.equal(events[0]!.expectsHumanAction, 'answer');
  assert.equal(events[1]!.direction, 'downstream');
  assert.equal(events[1]!.inReplyTo, 'q1');
});

test('P-9 bridgeAnswerToResume：答案变成回流建议，但绝不自动执行或验收', () => {
  const proposal = bridgeAnswerToResume({
    question: { id: 'q1', payload: { run_id: 'RUN1', step_no: 3, asker: 'worker-a' } },
    response: { id: 'a1', actor: '原发起人', payload: { choice: '继续', acceptance: false } },
    at: 10,
  });
  assert.equal(proposal.autoExecute, false);
  assert.equal(proposal.requiresHumanApproval, true);
  assert.equal(proposal.notAcceptance, true);
  assert.equal(proposal.advisory, true);
  assert.equal(proposal.target, 'execution-chain');
  assert.equal(proposal.responseId, 'a1');
  assert.equal(proposal.stepNo, 3);
  assert.match(proposal.nextHumanAction, /原会话/);
  assert.doesNotThrow(() => assertResumeProposal(proposal));
  assert.throws(() => bridgeAnswerToResume({
    question: { id: 'q1', payload: { run_id: 'RUN1' } },
    response: { id: 'a1', actor: '真人', payload: { choice: '确认验收' } },
  }), /不得冒充/);
  assert.throws(() => bridgeAnswerToResume({
    question: { id: 'q1', payload: { run_id: 'RUN1' } },
    response: { id: 'a1', actor: '', payload: {} },
  }), /真人身份/);
});

test('P-9 mapFollowupToAnswer：飞书补充说明入站映射，核可不是回答', () => {
  assert.deepEqual(mapFollowupToAnswer('回答 q1 继续', 'ou_owner').questionId, 'q1');
  assert.equal(mapFollowupToAnswer('回答 q1 继续', 'ou_owner').acceptance, false);
  assert.equal(mapFollowupToAnswer('继续，用方案二', 'ou_owner').accepted, true);
  assert.equal(mapFollowupToAnswer('继续', 'ou_owner').questionId, null);
  assert.equal(mapFollowupToAnswer('确认验收 SUI-1', 'ou_owner').accepted, false);
  assert.match(mapFollowupToAnswer('确认验收 SUI-1', 'ou_owner').reason ?? '', /最终核可/);
  assert.equal(mapFollowupToAnswer('/collab SUI-1 接续', 'ou_owner').accepted, false);
  assert.equal(mapFollowupToAnswer('继续', '').accepted, false);
});

test('P-9 loopSignature 确定性：同样回路逐字节一致，新增断路即变化', () => {
  const a = loopReport({ events: fullCycle(), humanOwners: ['originator'] });
  const b = loopReport({ events: fullCycle(), humanOwners: ['originator'] });
  assert.equal(loopSignature(a), loopSignature(b));
  const broken = loopReport({ events: [
    ev({ id: 'q9', direction: 'upstream', kind: 'question', at: 9,
      actor: 'worker', expectsHumanAction: 'answer' }),
  ] });
  assert.notEqual(loopSignature(a), loopSignature(broken));
});

test('P-9 方向与动作不匹配、缺任务归属都如实报缺口', () => {
  const report = loopReport({ events: [
    ev({ id: 'x1', direction: 'downstream', kind: 'receipt' as never, at: 1 }),
    { id: '', direction: 'upstream', kind: 'progress', at: 2, taskId: '', actor: 'w' } as LoopEvent,
  ] });
  assert.ok(report.findings.some(f => f.code === 'direction-kind-mismatch'));
  assert.deepEqual(report.orphanEvents, ['<no-id>']);
});

test('P-9 assertLoopAdvisory 只出只读标记，不带任何写入或模型调用', () => {
  const report = loopReport({ events: fullCycle(), humanOwners: ['originator'] });
  assert.deepEqual(assertLoopAdvisory(report),
    { advisory: true, blocking: false, modelCalls: 0, violations: 0 });
});

test('P-9 端到端：上游回执 + Runner 台账 + 回流建议能拼成一条真实双向回路', () => {
  const upstream = fromAutoloopReceipt({ receiptId: 'R1', taskId: 'RUN1', agent: 'worker', at: 1,
    result: { outcome: 'done', ask: [{ title: '继续吗', options: ['继续', '暂停'] }] } });
  const hitl = fromHitlLedger({ events: [
    { id: 'q1', type: 'human_question', at: 2, payload: { run_id: 'RUN1', asker: 'worker' } },
    { id: 'a1', type: 'human_response', at: 3, payload: { question_id: 'q1', choice: '继续' } },
  ] });
  const proposal = bridgeAnswerToResume({
    question: { id: 'q1', payload: { run_id: 'RUN1', step_no: 1 } },
    response: { id: 'a1', actor: '原发起人', payload: { choice: '继续' } },
  });
  const events = attachImplicitReplies([...upstream, ...hitl]);
  const withProposal = loopReport({ events,
    resumeProposals: [{ id: proposal.id, inReplyTo: proposal.responseId }] });
  const without = loopReport({ events });
  assert.equal(withProposal.bidirectional, true);
  assert.ok(withProposal.closedCycles > without.closedCycles,
    '回流建议必须让半回路真的闭合，而不只是多一个字段');
});

// --- 第二十八轮修复回归 -------------------------------------------------------

test('P-10 fromHitlLedger 归一化 ISO 字符串时间：与数字时间混排不再产生 NaN 排序', () => {
  // 真实台账的 at 是 ISO 字符串（askHuman 默认 new Date().toISOString()），
  // 而审计行归一出来的是 epoch 毫秒。修复前 a.at - b.at 会得到 NaN，
  // 排序与因果比较全部失效——这是 loop-guard 在真实数据上的潜伏缺陷。
  const iso = (ms: number) => new Date(ms).toISOString();
  const hitl = fromHitlLedger({ events: [
    { id: 'q1', type: 'human_question', at: iso(10_000), payload: { run_id: 'RUN1', asker: 'worker' } },
    { id: 'a1', type: 'human_response', at: iso(20_000), payload: { question_id: 'q1', choice: '继续', actor: '原发起人' } },
  ] });
  assert.equal(typeof hitl[0]!.at, 'number');
  assert.equal(hitl[0]!.at, 10_000);
  assert.equal(hitl[1]!.at, 20_000);
  // 与数字时间的上游回执混排后，回路判据仍然正确（回答晚于提问）。
  const upstream = fromAutoloopReceipt({ receiptId: 'R1', taskId: 'RUN1', agent: 'worker', at: 5_000,
    result: { outcome: 'done' } });
  const report = loopReport({ events: [...upstream, ...hitl],
    resumeProposals: [{ id: 'resume:1', inReplyTo: 'a1' }] });
  assert.equal(report.bidirectional, true);
  assert.deepEqual(report.staleAnswers, []);
  // 无法解析的时间按 0 处理（确定性），不产生 NaN。
  assert.equal(toLoopAt('not-a-date'), 0);
  assert.equal(toLoopAt(123), 123);
  assert.equal(toLoopAt(iso(456)), 456);
});

test('P-10 mapFollowupToAnswer：裸「确认验收」也必须被拒收（\\b 对中文失效的修复）', () => {
  // JS 的 \b 只认 ASCII 词字符，「确认验收」后面跟的全是非词字符时永远不成立，
  // 旧正则 /^确认验收\b|.../ 会让整句就是核可的消息漏进回答通道。
  assert.equal(mapFollowupToAnswer('确认验收', 'ou_owner').accepted, false);
  assert.match(mapFollowupToAnswer('确认验收', 'ou_owner').reason ?? '', /最终核可/);
  assert.equal(mapFollowupToAnswer('确认验收 SUI-129', 'ou_owner').accepted, false);
  assert.equal(mapFollowupToAnswer('请确认验收 SUI-1', 'ou_owner').accepted, false);
  // 正常回答不受影响。
  assert.equal(mapFollowupToAnswer('回答 q1 继续', 'ou_owner').accepted, true);
  assert.equal(mapFollowupToAnswer('回复 hq-abc 暂停', 'ou_owner').questionId, 'hq-abc');
  assert.equal(mapFollowupToAnswer('继续', 'ou_owner').accepted, true);
});

test('P-10 dedupeLoopEvents：同 id 双留痕只计一次，撞号如实报出', () => {
  // 同一条 IM 消息可能同时被 controller.reply() 与 intake.ingest() 留痕。
  const events: LoopEvent[] = [
    ev({ id: 'down:om-1', direction: 'downstream', kind: 'supplement', at: 5 }),
    ev({ id: 'down:om-1', direction: 'downstream', kind: 'supplement', at: 9 }),
    ev({ id: 'q1', direction: 'upstream', kind: 'question', at: 2,
      actor: 'worker', expectsHumanAction: 'answer' }),
  ];
  const deduped = dedupeLoopEvents(events);
  assert.equal(deduped.events.length, 2);
  assert.equal(deduped.duplicates, 1);
  assert.deepEqual(deduped.duplicateIds, ['down:om-1']);
  // 保留时间最早的一条（at=5），不是任意一条。
  assert.equal(deduped.events.find(e => e.id === 'down:om-1')!.at, 5);
  // 去重后回路计数不再双计。
  const report = loopReport({ events: deduped.events });
  assert.equal(report.downstream, 1);
  assert.deepEqual(dedupeLoopEvents(fullCycle()).duplicates, 0);
});
