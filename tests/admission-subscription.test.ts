// 第四十一轮 · 准入强度（src/admission.ts）与订阅生命周期（src/subscription.ts）。
//
// 这两层原来都没有名字：未配对的人只会撞上白名单抛错；「验收后不复活」是判定
// 顺序的副作用；「要改授权面」的补充说明会被当成 note 塞给执行端。这里把边界
// 钉住：三档准入各自能做什么、订阅什么时候释放、什么话必须交回主链路。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { CollaborationIntake } from '../src/collaboration-intake.ts';
import { assessAdmission, ADMISSION_STRENGTHS, admissionLabel } from '../src/admission.ts';
import { classifyFollowupScope, subscriptionStateOf, subscriptionNextStep, OUT_OF_SCOPE_INTENTS } from '../src/subscription.ts';
import { passThroughDecision } from '../src/pass-through.ts';

// ---------------------------------------------------------------- 准入强度

const base = { channel: 'feishu', senderId: 'ou_a', chatId: 'oc_x' };

test('准入：配对出在职成员 = 显式准入，且带成员身份', () => {
  const decision = assessAdmission({ ...base, paired: true, pairingValid: true, allowlisted: true, allowlistSize: 1 });
  assert.equal(decision.strength, 'explicit');
  assert.equal(decision.handling, 'process');
  assert.equal(decision.memberContext, true);
  assert.equal(decision.modelCalls, 0);
});

test('准入：单负责人安装的白名单 = 显式准入，但没有成员身份', () => {
  const decision = assessAdmission({ ...base, paired: false, allowlisted: true, allowlistSize: 1 });
  assert.equal(decision.strength, 'explicit');
  assert.equal(decision.handling, 'process');
  assert.equal(decision.memberContext, false, '白名单不等于实名成员，不能带成员身份');
});

test('准入：配对记录还在但身份失效 = 推断准入，只回说明', () => {
  const decision = assessAdmission({ ...base, paired: true, pairingValid: false, allowlisted: true, allowlistSize: 1 });
  assert.equal(decision.strength, 'inferred');
  assert.equal(decision.handling, 'acknowledge');
  assert.equal(decision.memberContext, false);
});

test('准入：多人白名单里未配对 = 推断准入，不能自行处理', () => {
  const decision = assessAdmission({ ...base, paired: false, allowlisted: true, allowlistSize: 3 });
  assert.equal(decision.strength, 'inferred');
  assert.equal(decision.handling, 'acknowledge');
});

test('准入：通道也不认 = 未准入，拒绝', () => {
  const decision = assessAdmission({ ...base, paired: false, allowlisted: false, allowlistSize: 1 });
  assert.equal(decision.strength, 'not-admitted');
  assert.equal(decision.handling, 'reject');
});

test('准入：只有显式准入能带成员身份，推断准入恒为 false', () => {
  for (const strength of ADMISSION_STRENGTHS) {
    for (const paired of [true, false]) for (const valid of [true, false]) for (const allowlistSize of [0, 1, 2]) {
      const decision = assessAdmission({ ...base, paired, pairingValid: valid,
        allowlisted: allowlistSize > 0, allowlistSize });
      if (decision.memberContext) {
        assert.equal(decision.strength, 'explicit', `${strength}/${paired}/${valid}/${allowlistSize}`);
        assert.equal(paired && valid, true, '成员身份必须来自真实配对');
      }
      if (decision.strength === 'inferred') assert.equal(decision.handling, 'acknowledge');
    }
  }
});

test('准入：三档都有中文标签，便于控制台与文档复用', () => {
  assert.deepEqual(ADMISSION_STRENGTHS.map(admissionLabel), ['显式准入', '推断准入（待确认）', '未准入']);
});

// ---------------------------------------------------------------- 订阅生命周期

test('订阅：越界要求被识别为交回，正常补充说明不受影响', () => {
  const outOfScope = [
    '把验收清单改一下，少两项',
    '这个任务换别人做吧',
    '给小王开一下访问权限',
    '把来源换成新的那份文档',
  ];
  for (const text of outOfScope) assert.equal(classifyFollowupScope(text).scope, 'out-of-scope', text);
  const inScope = ['刚补充了验收要求，请继续核对', '顺便说一句，客户希望周五前看到', '继续', '/collab SUI-1 接续'];
  for (const text of inScope) assert.equal(classifyFollowupScope(text).scope, 'in-scope', text);
  assert.equal(OUT_OF_SCOPE_INTENTS.length, 4);
});

test('订阅：释放是终态，phase 与审计事实任一成立即释放', () => {
  assert.equal(subscriptionStateOf({ phase: 'running' }), 'held');
  assert.equal(subscriptionStateOf({ phase: 'running', released: true }), 'released');
  assert.equal(subscriptionStateOf({ phase: 'accepted' }), 'released');
  assert.equal(subscriptionStateOf({ phase: 'running', handedBack: true }), 'handed-back');
  assert.match(subscriptionNextStep('released'), /按新需求/);
});

const bound = { id: 'T1', phase: 'running', binding: { senderId: 'u1', chatId: 'c1' }, requesterUserId: 'u1' };
const actor = { id: 'u1', chatId: 'c1' };

test('直通：已释放的绑定不再接续（released），普通补充说明仍直接接续', () => {
  const released = passThroughDecision({ candidates: [{ ...bound, released: true }], actor, member: { userId: 'u1' } });
  assert.equal(released.direct, false);
  assert.equal(released.kind, 'released');
  const direct = passThroughDecision({ candidates: [bound], actor, member: { userId: 'u1' }, text: '继续核对' });
  assert.equal(direct.direct, true);
  assert.equal(direct.taskId, 'T1');
});

test('直通：越界要求交回主链路，不接续、也不落到执行端', () => {
  const decision = passThroughDecision({ candidates: [bound], actor, member: { userId: 'u1' }, text: '把这个任务换别人做' });
  assert.equal(decision.direct, false);
  assert.equal(decision.kind, 'hand-back');
  assert.equal(decision.taskId, 'T1');
  assert.equal(decision.deny, false, '交回不是拒绝，交给主链路判断');
  // 交回同样不能夹带权限字段
  assert.equal('scope' in decision, false);
  assert.equal('permissions' in decision, false);
});

test('直通：归属不符仍然直接拒绝，不会被越界判定掩盖', () => {
  const decision = passThroughDecision({ candidates: [{ ...bound, requesterUserId: 'u2' }], actor, member: { userId: 'u1' },
    text: '把验收清单改一下' });
  assert.equal(decision.kind, 'ownership');
  assert.equal(decision.deny, true);
});

// ---------------------------------------------------------------- 接入链路

function fixture(config: { allowedSenders: string[] }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-admission-'));
  const store = new Store(path.join(dir, 'state.sqlite'));
  const calls: string[] = [];
  const w: any = {
    config: { feishu: { allowedSenders: config.allowedSenders, allowedChats: ['oc_x'], botId: 'ou_bot', appId: 'cli_t' },
      paperclipUrl: 'http://localhost:3100' },
    store, catalog: () => ({ imMembers: {} }),
    state: async () => ({ sources: [], requests: [], history: [] }),
    save: async () => {}, manager: () => {}, participant: () => {},
  };
  const assistant: any = { delegate: async () => { calls.push('delegate'); },
    taskContext: { note: async () => { calls.push('note'); } } };
  const event = { message_id: 'om_a', chat_id: 'oc_x', chat_type: 'p2p', sender_id: 'ou_a', sender_type: 'user',
    content: '帮忙看一下这个需求', create_time: '1793800000000' };
  return { store, calls, event, intake: new CollaborationIntake(w, assistant),
    close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('接入：多人白名单里未配对只回说明，不建单、不派活、留一条待确认', async () => {
  const f = fixture({ allowedSenders: ['ou_a', 'ou_b'] });
  try {
    const result: any = await f.intake.ingest(f.event);
    assert.equal(result.admitted, false);
    assert.equal(result.strength, 'inferred');
    assert.equal(f.store.list().length, 0, '不能建单');
    assert.deepEqual(f.calls, [], '不能派活或写笔记');
    const audit = f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='admission.inferred'").get() as { n: number };
    assert.equal(audit.n, 1);
    const outbox = f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get() as { n: number };
    assert.equal(outbox.n, 1, '要回一条配对指引，而不是没有下文');
  } finally { f.close(); }
});

test('接入：未准入的发送人仍然被拒绝，不因为新增中间档而放宽', async () => {
  const f = fixture({ allowedSenders: ['ou_owner'] });
  try { await assert.rejects(f.intake.ingest(f.event), /Unauthorized/); assert.equal(f.store.list().length, 0); }
  finally { f.close(); }
});
