// 第六轮：产品化的「按开工前锁定清单确认验收」路径。
// 与静态源码断言互补：这里真正跑 Controller 方法，验证身份红线、
// 逐项闸门、归档与中文通知，以及中文指令在会话里的端到端路由。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, type Task } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { configSchema } from '../src/config.ts';
import { createPlan, encodePlan, lockPlan } from '../src/acceptance-plan.ts';
import { evaluateRound, writeRound } from '../src/acceptance-round.ts';
import { capture, eventId, projectTrace } from '../src/event-stream.ts';
import { CONFIRM_ACCEPT } from '../src/user-language.ts';

const at = '2026-11-06T08:00:00.000Z';
const taskId = 'SUI-1100';
const actor = 'ou_owner';
const names = ['报价版本正确', '客户可见文案'];
const base = { paperclipUrl: 'http://127.0.0.1:4180', repository: 'a/b', checkout: '/tmp/a',
  allowedPaths: ['/tmp/a'], defaultAgent: 'manual',
  agents: { manual: { name: 'Manual', mode: 'manual', use: 'command', enabled: true } },
  feishu: { profile: 'test', botId: 'ou_bot', appId: 'cli_test', allowedSenders: [actor] } };
const independent = configSchema.parse({ ...base,
  acceptance: { mode: 'independent', level: 'L3', visualReviewer: { mode: 'structural' } } });
const legacy = configSchema.parse({ ...base, acceptance: { mode: 'legacy' } });

const event = capture({ taskId, at, kind: 'tool', actor: 'screenshot-capture',
  provenance: 'ci-screenshot', evidenceKind: 'captured', sourceRef: { id: 'sha-1', revision: 'rev-1' }, refs: [] }).event!;
const traceBody = projectTrace([event]);

function pcStore() {
  const docs: Record<string, any> = {}, patches: { route: string; payload: any }[] = [];
  return { docs, patches,
    get: async (route: string) => {
      const doc = docs[route];
      if (!doc) throw new Error(`GET ${route}: 404 not found`);
      return doc;
    },
    document: async (issueId: string, key: string, _title: string, body: string) => {
      docs[`/issues/${issueId}/documents/${key}`] = { body, latestRevisionId: `rev-${key}-1` };
      return {};
    },
    patch: async (route: string, payload: any) => { patches.push({ route, payload }); return {}; } };
}

function plan() {
  return createPlan({ taskId, names, lockedBy: 'pd-owner', lockedAt: at,
    producerModel: 'producer-gpt', reviewerModel: 'structural-vision-reviewer' });
}

/** 每项都给出可在事件流回放、带来源版本的证据。failOne 时故意留空一项。 */
async function writeReview(pc: ReturnType<typeof pcStore>, sealed: ReturnType<typeof plan>, failOne = false) {
  const evidence = Object.fromEntries(sealed.items.map((item, index) => [item.id, {
    refs: failOne && index === 1 ? [] : [eventId(event)],
    evidenceKind: item.evidenceKind,
    sourceRefs: [{ id: 'sha-1', revision: 'rev-1' }],
  }]));
  const round = evaluateRound({ plan: sealed, reviewerModel: 'structural-vision-reviewer',
    producerModel: 'producer-gpt', evidence, events: [event], planRevision: 'rev-acceptance-plan-1' });
  await writeRound(pc, round);
  return round;
}

function control(pc: ReturnType<typeof pcStore>, requester = actor) {
  const task: any = { id: taskId, identifier: taskId, phase: 'executed',
    context: JSON.stringify({ requesterUserId: requester, businessAcceptance: names }) };
  const audits: any[] = [], notices: any[] = [], traces: any[] = [];
  const instance: any = Object.create(Controller.prototype);
  Object.assign(instance, { pc, config: independent,
    store: { get: () => task, save: (next: any) => Object.assign(task, next),
      audit: (...args: any[]) => audits.push(args), notify: (...args: any[]) => notices.push(args) },
    trace: { append: async (...args: any[]) => { traces.push(args); } } });
  return { instance, task, audits, notices, traces };
}

test('按锁定清单确认验收：逐项全通过才归档，改 done、留痕并给中文通知', async () => {
  const pc = pcStore(), sealed = plan();
  await lockPlan(pc, sealed);
  await pc.document(taskId, 'trace', '统一过程流水', traceBody);
  await writeReview(pc, sealed);
  const { instance, task, audits, notices, traces } = control(pc);

  const receipt: any = await instance.confirmAcceptance(taskId, actor, 'evt-confirm');
  assert.equal(receipt.mode, 'sealed-plan');
  assert.equal(receipt.actor, actor);
  assert.equal(receipt.planHash, sealed.hash);
  assert.equal(receipt.cases.length, 2);
  assert.ok(receipt.cases.every((item: any) => item.passed === true));
  assert.equal(receipt.evidenceReview.status, 'verified');
  assert.match(receipt.environment, /不是代码部署环境/);
  assert.match(receipt.note, /不代替人签字/);
  assert.deepEqual(pc.patches, [{ route: `/issues/${taskId}`, payload: { status: 'done' } }]);
  assert.equal(task.phase, 'accepted');
  assert.equal(audits[0]?.[0], 'task.confirm-accepted');
  assert.equal(traces[0]?.[1]?.event?.outcome, 'accepted');
  assert.equal(traces[0]?.[1]?.event?.checkpoint, CONFIRM_ACCEPT);
  assert.match(notices[0]?.[2], /确认验收/);
  const acceptance = JSON.parse(pc.docs[`/issues/${taskId}/documents/acceptance`].body);
  assert.equal(acceptance.planHash, sealed.hash);
  assert.match(pc.docs[`/issues/${taskId}/documents/decisions`].body, /不代表生产发布/);
});

test('身份不符、无锁定清单、逐项未通过、清单被改写，一律拒绝且不改任务状态', async () => {
  const scenarios: { name: string; prepare: (pc: ReturnType<typeof pcStore>) => Promise<void>;
    requester?: string; expected: RegExp }[] = [
    { name: '非原发起人', requester: 'ou_someone_else', prepare: async pc => {
        const sealed = plan(); await lockPlan(pc, sealed);
        await pc.document(taskId, 'trace', '统一过程流水', traceBody); await writeReview(pc, sealed); },
      expected: /只有原发起人可以确认验收/ },
    { name: '没有锁定清单', prepare: async () => {}, expected: /没有开工前锁定的验收清单/ },
    { name: '存在未通过检查项', prepare: async pc => {
        const sealed = plan(); await lockPlan(pc, sealed);
        await pc.document(taskId, 'trace', '统一过程流水', traceBody); await writeReview(pc, sealed, true); },
      expected: /存在未通过或未受阻项|逐项判定不完整/ },
    { name: '清单被改写', prepare: async pc => {
        const sealed = plan(); await lockPlan(pc, sealed);
        await pc.document(taskId, 'trace', '统一过程流水', traceBody); await writeReview(pc, sealed);
        const changed = createPlan({ taskId, names: [...names, '新增检查项'], lockedBy: 'pd-owner', lockedAt: at,
          producerModel: 'producer-gpt', reviewerModel: 'structural-vision-reviewer' });
        pc.docs[`/issues/${taskId}/documents/acceptance-plan`].body = encodePlan(changed); },
      expected: /验收清单已变更|清单|不一致/ },
  ];
  for (const scenario of scenarios) {
    const pc = pcStore();
    await scenario.prepare(pc);
    const { instance, task } = control(pc, scenario.requester ?? actor);
    await assert.rejects(() => instance.confirmAcceptance(taskId, actor, 'evt'), scenario.expected, scenario.name);
    assert.equal(pc.patches.length, 0, `${scenario.name} 不应改任务状态`);
    assert.equal(task.phase, 'executed', `${scenario.name} 不应改本地阶段`);
  }
});

function session(configValue: typeof independent) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-confirm-'));
  const store = new Store(path.join(dir, 'bridge.sqlite'));
  const task: Task = { id: taskId, identifier: taskId, triggerId: 'feishu-intake', chatId: 'oc_test',
    messageId: 'om_intake', senderId: actor, agent: 'manual', workspace: dir, branch: 'collab/test',
    context: JSON.stringify({ requesterUserId: actor, businessAcceptance: names }), generation: 1, phase: 'executed' };
  store.save(task);
  const controller = new Controller(configValue, store);
  const pc = pcStore();
  (controller as any).pc = pc;
  const traces: any[] = [];
  (controller as any).trace = { append: async (...args: any[]) => { traces.push(args); } };
  return { pc, store, controller, traces, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const incoming = (content: string) => ({ message_id: 'om_confirm', chat_id: 'oc_test', chat_type: 'p2p',
  sender_id: actor, sender_type: 'user', content, create_time: '1793800000000' });

test('会话里一句「确认验收」走按清单核可；未锁清单的旧流程要求中文写明的交付提交号', async () => {
  const s = session(independent);
  try {
    const sealed = plan();
    await lockPlan(s.pc, sealed);
    await s.pc.document(taskId, 'trace', '统一过程流水', traceBody);
    await writeReview(s.pc, sealed);
    const result: any = await s.controller.ingest(incoming(`确认验收 ${taskId}`));
    assert.equal(result.mode, 'sealed-plan');
    assert.equal(result.actor, actor);
    assert.equal(s.store.get(taskId).phase, 'accepted');
    assert.deepEqual(s.pc.patches, [{ route: `/issues/${taskId}`, payload: { status: 'done' } }]);
    assert.equal(s.traces.length, 1);
  } finally { s.close(); }

  const old = session(legacy);
  try {
    await assert.rejects(() => old.controller.ingest(incoming(`确认验收 ${taskId}`)),
      /这是代码交付类任务，请附上交付提交号/);
    assert.equal(old.store.get(taskId).phase, 'executed');
    assert.equal(old.pc.patches.length, 0);
  } finally { old.close(); }
});
