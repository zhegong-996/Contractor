// P-8 常态契约：把 guard:smoke 里的一次性检查固化成每次 npm test 都跑的守门。
// 只做静态源码核对，不启动服务、不写真日志、不调用外部模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOutboundTools, assertDecisionTraceIsolation } from '../src/behavior-baseline.ts';
import { assertGuardIsAdvisory } from '../src/knowledge-guard.ts';

const source = (relative: string) => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');

test('P-8 新增只读动作三处白名单同步（server / members / console-server）', () => {
  const server = source('src/server.ts'), members = source('src/members.ts');
  const consoleServer = source('scripts/console-server.ts');
  assert.match(server, /'memory-guard'/, 'server.ts readOnly 缺 memory-guard');
  assert.match(members, /'memory-guard'/, 'members.ts reads 缺 memory-guard');
  assert.match(consoleServer, /'memory-guard'/, '控制台只读白名单缺 memory-guard');
  assert.match(server, /guardKnowledge\(\{/, 'server 必须真的调用守门，不能只登记名字');
  assert.match(server, /assertGuardIsAdvisory\(/, '返回前必须校验只读 advisory');
});

test('P-8 守门接线只读：不改写入链、不读宿主正文、不新增网页发起入口', () => {
  const server = source('src/server.ts');
  const branch = server.slice(server.indexOf("action==='memory-guard'"),
    server.indexOf("action==='routing-status'"));
  assert.ok(branch.length > 0);
  assert.doesNotMatch(branch, /store\.save|store\.audit|knowledge\.review|\.propose\(/);
  assert.match(branch, /documentBodiesNotRead:true/);
  assert.match(branch, /readBridgedEvents\(\)/);
});

test('P-8 出站 MCP 真实工具面每次提交都过「不暴露」硬断言', () => {
  const mcp = source('src/mcp.ts');
  const names = [...mcp.matchAll(/server\.registerTool\(\s*'([^']+)'/g)].map(m => m[1]!);
  assert.ok(names.length >= 10, '工具面解析失败，疑似改了注册写法');
  const result = assertOutboundTools(names);
  assert.equal(result.ok, true);
  assert.equal(result.signature.length, 32);
});

test('P-8 冻结基线入库且已排除易变字段，禁止自动改写基线来「跑绿」', () => {
  const raw = JSON.parse(source('fixtures/behavior-golden.json'));
  const frozen = raw.frozen;
  assert.equal(frozen.schemaVersion, 1);
  assert.equal(frozen.kind, 'console');
  assert.equal(frozen.count, frozen.entries.length);
  assert.ok(frozen.count > 0 && typeof frozen.signature === 'string' && frozen.signature.length === 32);
  const keys = frozen.entries.map((entry: { key: string }) => entry.key);
  assert.deepEqual(keys, [...keys].sort(), '基线条目必须按键稳定排序');
  assert.ok(!keys.some((key: string) => /(^|\.)(at|port|ms|url|timestamp)$/.test(key)),
    '基线不得混入每次真跑都会变的字段');
  assert.doesNotMatch(source('scripts/guard-smoke.ts'), /writeFileSync\([^)]*behavior-golden/,
    '真跑脚本不得自动改写冻结基线');
});

test('P-8 冻结基线变更必须留人审理由，禁止无说明改写', () => {
  const raw = JSON.parse(source('fixtures/behavior-golden.json'));
  assert.match(raw.note, /人审/, '基线说明必须写明人审纪律');
  assert.ok(Array.isArray(raw.humanReview) && raw.humanReview.length > 0,
    '基线被更新过就必须留人审记录');
  for (const item of raw.humanReview) {
    assert.ok(item.at && item.round && item.change && item.reason && item.reviewer,
      '每条人审记录须写清时间 / 轮次 / 变化 / 理由 / 审核人');
  }
});

test('P-8 决策留痕与业务写入不共用 id（静态断言守住独立流）', () => {
  const result = assertDecisionTraceIsolation({
    decisions: [
      { id: 'r001', at: '2026-11-08T01:00:00Z', kind: 'routing-decided' },
      { id: 'r002', at: '2026-11-08T01:01:00Z', kind: 'routing-decided' },
    ], businessWriteIds: ['t001'],
  });
  assert.equal(result.isolated, true);
});

test('P-8 体检报告恒为 advisory，禁止改成拦截式守门', () => {
  const report = {
    schemaVersion: 1 as const, advisory: true as const, blocking: false as const, modelCalls: 0 as const,
    knowledgeRecords: 1, activeRecords: 1, transcriptEvents: 3, groundedRecords: 0, gapRecords: 1,
    injectedEligible: 0, injectedBytes: 0, injectedLines: 0, injectedOmitted: 0,
    recordFingerprint: 'a'.repeat(32),
    wiki: { pages: 0, links: 0, bytes: 0, corpusBytes: 0, bloated: false },
    findings: [], unwired: [], signature: 'b'.repeat(32),
  };
  assert.deepEqual(assertGuardIsAdvisory(report), { advisory: true, blocking: false });
  assert.throws(() => assertGuardIsAdvisory({ ...report, blocking: true as unknown as false }),
    /只读 advisory/);
});

test('P-8 真跑脚本只读：不写真实 B1 / 路由日志、不重置数据库', () => {
  const smoke = source('scripts/guard-smoke.ts');
  assert.doesNotMatch(smoke, /appendFileSync|resetForTest|store\.save|\.audit\(/);
  assert.match(smoke, /memoryBefore === memoryAfter/);
  assert.match(smoke, /routingBefore === routingAfter/);
});
