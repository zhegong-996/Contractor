// 第十二轮守门：统一路由契约、同一份 Trace、B 阶段重放口径、三层判断与非 Paperclip 宿主。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryEventSchema } from '../src/architecture-contracts.ts';
import { routingDecision, routingDecisionSchema, signatureFor, toMemoryEvent, decisionOf,
  ROUTING_STAGES, HUMAN_SIGNATURE_RULES } from '../src/routing-decision.ts';
import { RoutingTrace, FileRoutingSink, MemoryRoutingSink, readRoutingEvents, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import { LocalHostPlatform, resolvePlatform, platformSwitchChecklist, PaperclipPlatform } from '../src/platform-port.ts';
import { Paperclip } from '../src/paperclip.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'suitme-routing-')), 'events.jsonl');

const decision = (overrides: Record<string, unknown> = {}) => routingDecision({
  taskId: 'SUI-1', stage: 'dispatch',
  caller: { actor: 'owner-a', role: 'personal', source: 'human' },
  target: { role: 'worker', agentKey: 'agent-a' },
  basis: { kind: 'user-command', evidence: ['message:om_1'] },
  scope: { allowedPaths: ['src/'], visibility: 'private' },
  ...overrides,
} as any);

test('RoutingDecision 覆盖五个必需维度并严格拒绝未知字段', () => {
  const d = decision();
  assert.ok(d.caller.actor && d.caller.role && d.caller.source, '调用方');
  assert.equal(d.target.role, 'worker', '目标角色');
  assert.equal(d.basis.kind, 'user-command', '依据');
  assert.deepEqual(d.scope.allowedPaths, ['src/'], '资料范围');
  assert.equal(d.requiresHumanSignature, false, '是否需人签字');
  assert.equal(d.schemaVersion, 1);
  assert.equal(ROUTING_STAGES.length, 5);
  assert.throws(() => routingDecisionSchema.parse({ ...d, invented: true }));
  assert.throws(() => routingDecisionSchema.parse({ ...d, caller: { ...d.caller, actor: '' } }));
  assert.throws(() => routingDecision({ ...decision(), taskId: '' } as any));
});

test('带 idempotencyKey 的决策可重复构造且 id 稳定，不带 key 时按时间区分', () => {
  const a = decision({ idempotencyKey: 'trigger:om_1', at: '2026-11-07T01:00:00.000Z' });
  const b = decision({ idempotencyKey: 'trigger:om_1', at: '2026-11-07T09:00:00.000Z' });
  assert.equal(a.decisionId, b.decisionId);
  const c = decision({ at: '2026-11-07T01:00:00.000Z' });
  const e = decision({ at: '2026-11-07T01:00:01.000Z' });
  assert.notEqual(c.decisionId, e.decisionId);
});

test('红线动作一律要求人签字且带理由，调用点不能把它改成 false', () => {
  for (const rule of HUMAN_SIGNATURE_RULES) {
    const sig = signatureFor(rule.action);
    assert.equal(sig.requiresHumanSignature, true);
    assert.equal(sig.signatureReason, rule.reason);
    assert.equal(decision({ ...sig }).requiresHumanSignature, true);
  }
});

test('B 阶段复用：决策就是一条合法 MemoryEvent，往返不丢字段', () => {
  const d = decision({ requiresHumanSignature: true, signatureReason: '业务验收', scope: { sourceIds: ['src-1'] } } as any);
  const event = toMemoryEvent(d);
  assert.doesNotThrow(() => memoryEventSchema.parse(event));
  assert.equal(event.kind, 'routing-decided');
  assert.equal(event.actor, d.caller.actor);
  assert.equal(event.sourceRef?.sourceId, 'src-1');
  assert.deepEqual(decisionOf(event), d);
  assert.equal(decisionOf({ ...event, kind: 'edge-drafted' }), null);
});

test('同一份 Trace：落盘 → 读回 → 重放可复现、去重、按时间有序', () => {
  const file = tmp();
  const trace = new RoutingTrace([new FileRoutingSink(file)]);
  const a = decision({ stage: 'intake', at: '2026-11-07T02:00:00.000Z', idempotencyKey: 'e1' });
  const b = decision({ stage: 'dispatch', at: '2026-11-07T01:00:00.000Z', idempotencyKey: 'e2' });
  assert.equal(trace.record(a).written, true);
  assert.equal(trace.record(a).duplicate, true, '进程内幂等');
  assert.equal(trace.record(b).written, true);
  const first = readRoutingEvents(file);
  assert.deepEqual(first.errors, []);
  assert.equal(first.events.length, 2);
  const p1 = replayRouting(first.events), p2 = replayRouting(readRoutingEvents(file).events);
  assert.deepEqual(p1, p2, '同一日志两次重放结果一致');
  assert.equal(p1.decisions, 2);
  assert.equal(p1.byStage.intake, 1);
  assert.equal(p1.byTargetRole.worker, 2);
  assert.equal(p1.chain[0]!.at, '2026-11-07T01:00:00.000Z', '按时间有序');
  // 坏行必须如实报错而不是静默丢弃。
  const bad = tmp();
  const t2 = new RoutingTrace([new FileRoutingSink(bad)]);
  t2.record(a);
  appendFileSync(bad, '{broken json\n');
  assert.equal(readRoutingEvents(bad).errors.length, 1);
});

test('Trace 写入失败不影响业务结果；审计通道可选且失败被吞掉', () => {
  const broken = { write: () => { throw new Error('disk full'); } };
  const trace = new RoutingTrace([broken], () => { throw new Error('audit down'); });
  const result = trace.record(decision({ idempotencyKey: 'fail-case' }));
  assert.equal(result.written, false);
  assert.equal(result.reason, 'no-sink-available');
  const memory = new MemoryRoutingSink();
  const audits: string[] = [];
  const t2 = new RoutingTrace([memory], (action) => audits.push(action));
  assert.equal(t2.record(decision({ idempotencyKey: 'ok-case' })).written, true);
  assert.equal(memory.lines.length, 1);
  assert.deepEqual(audits, ['routing.decision']);
});

test('三层判断：当前不推荐，且给出可执行前置条件与反面依据', () => {
  const events = [toMemoryEvent(decision({ stage: 'intake', caller: { actor: 'u1', role: 'personal', source: 'human' } } as any))];
  const assessment = assessThreeTier(events);
  assert.equal(assessment.recommended, false);
  assert.match(assessment.verdict, /暂不引入/);
  assert.equal(assessment.prerequisites.find(p => p.id === 'p6-single-router')?.satisfied, false);
  assert.equal(assessment.prerequisites.find(p => p.id === 'p7-license')?.satisfied, true);
  assert.ok(assessment.reasons.some(r => r.includes('玉伯')));
  assert.ok(assessment.reasons.some(r => r.includes('Community License')));
  assert.equal(assessment.observed.intakeFromPersonal, 1);
  assert.ok(assessment.coverage > 0 && assessment.coverage < 1);
});

test('C-3：五个派活点全部收敛到单一 Router，不再各自直接写 Trace', () => {
  const targets = ['src/controller.ts', 'src/coordination.ts', 'src/assistant.ts', 'src/service-network.ts', 'src/v06.ts'];
  let total = 0;
  for (const file of targets) {
    const source = read(file);
    assert.match(source, /from '\.\/router\.ts'/, `${file} 未接线到 Router`);
    assert.doesNotMatch(source, /\.record\(routingDecision\(/, `${file} 仍在直接写 Trace`);
    const calls = (source.match(/getRouter\(\)\.route\(/g) ?? []).length;
    assert.ok(calls > 0, `${file} 没有派活调用`);
    total += calls;
  }
  assert.equal(total, 9, '9 处派活点必须全部经 Router');
  assert.match(read('src/router.ts'), /if \(config\.mode === 'legacy'\)/, '必须保留 legacy 一行回退');
  assert.match(read('src/config.ts'), /router: routerConfigSchema\.default/, '组织形态必须是配置');
  const server = read('src/server.ts');
  assert.match(server, /configureRouter\(config\.router\)/, '服务端必须按真实配置装配 Router');
  assert.match(server, /getRoutingTrace\(\)\.attachAudit/);
  assert.match(server, /routing-status/);
  assert.match(read('src/members.ts'), /'routing-status'/);
  const status = read('scripts/routing-status.ts');
  assert.match(status, /allWired/);
  assert.match(status, /getRouter\(\)\.status\(\)/);
});

test('平台端口：默认仍是 Paperclip，非 Paperclip 宿主真跑增删改查并如实列出缺口', async () => {
  const config = read('src/config.ts');
  assert.match(config, /host: z\.object\(/);
  assert.match(config, /provider: z\.enum\(\['paperclip', 'local', 'local-pg'\]\)\.default\('paperclip'\)/);
  assert.match(config, /pgDsnEnv: z\.string\(\)\.min\(1\)\.default\('COLLAB_PG_DSN'\)/, 'PG 凭据只能来自环境变量');
  assert.match(read('src/platform-port.ts'), /provider === 'local-pg'/, 'PG 后端必须接进 resolvePlatform 工厂');
  const host = new LocalHostPlatform(mkdtempSync(path.join(os.tmpdir(), 'suitme-host-')));
  assert.equal(host.id(), 'local');
  assert.equal(host.capabilities().pluginSdk, false);
  assert.ok(host.capabilities().missing.length >= 4, '不得假装已完全替换');
  const created = await host.post<any>('/companies/c1/issues', { idempotencyKey: 'k1', title: '冒烟', status: 'backlog' });
  const repeated = await host.post<any>('/companies/c1/issues', { idempotencyKey: 'k1', title: '重复' });
  assert.equal(repeated.id, created.id);
  const d1 = await host.document(created.id, 'handoff', '交接包', 'v1');
  const d2 = await host.document(created.id, 'handoff', '交接包', 'v2');
  assert.ok(Number(d2.latestRevisionId) > Number(d1.latestRevisionId));
  assert.equal((await host.get<any>(`/issues/${created.id}/documents/handoff`)).body, 'v2');
  assert.equal((await host.patch<any>(`/issues/${created.id}`, { status: 'todo' })).status, 'todo');
  await assert.rejects(() => host.get('/companies/c1/cost-events'), /尚未实现/);
  await assert.rejects(() => host.document('../escape', 'x', 't', 'b'), /只允许/);
  assert.ok(host.journalLines().length >= 3);
  assert.ok(platformSwitchChecklist().steps.some(s => s.includes('Plugin SDK')));
  // 默认工厂返回 Paperclip 适配器，行为与原 Paperclip 一致。
  const cfg: any = { paperclipUrl: 'http://127.0.0.1:3100', host: { provider: 'paperclip' }, bridgePort: 4180 };
  assert.ok(resolvePlatform(cfg) instanceof PaperclipPlatform);
  assert.equal((resolvePlatform(cfg) as PaperclipPlatform).url, cfg.paperclipUrl);
  assert.ok(new Paperclip('http://127.0.0.1:3100') instanceof Paperclip);
  assert.ok(resolvePlatform({ ...cfg, host: { provider: 'local' } }) instanceof LocalHostPlatform);
});
