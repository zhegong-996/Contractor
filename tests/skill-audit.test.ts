// 第七十一轮 · Skill 生效体检契约：
// 判定只认「最终 prompt 里有没有那段指令」，不认配置、不认日志。
// 目录里查不到的 skill 要单独报（配置写错 ≠ 没生效）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFromPrompt, auditSkills, summarizeSkillAudit } from '../src/skill-audit.ts';

const catalog = [
  { id: 'clarify', instruction: '先核对目标、使用者、约束与验收标准，再提一个具体问题。' },
  { id: 'handoff', instruction: '先核对接收服务的当前职责和明确交接范围，再传引用。' },
];

const promptWith = (...ids: string[]) => ids.map(id => catalog.find(c => c.id === id)!.instruction).join('\n\n');

test('全部生效：声明几条、prompt 里就有几条', () => {
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['clarify', 'handoff'],
    prompt: promptWith('clarify', 'handoff'), toolCount: 16, catalog,
  });
  assert.deepEqual(a.missing, []);
  assert.deepEqual(a.unknown, []);
  assert.equal(a.checks.filter(c => c.present).length, 2);
  assert.match(a.verdict, /2\/2 条 skill 已生效/);
});

test('少了一条：如实点出哪条没生效', () => {
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['clarify', 'handoff'],
    prompt: promptWith('clarify'), catalog,
  });
  assert.deepEqual(a.missing, ['handoff']);
  assert.match(a.verdict, /未生效：handoff/);
});

test('prompt 为空：全部算未生效，不假装通过', () => {
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['clarify'], prompt: '', catalog,
  });
  assert.deepEqual(a.missing, ['clarify']);
  assert.equal(a.promptLength, 0);
});

test('目录里查不到：单独报 unknown，不算 missing', () => {
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['clarify', 'ghost-skill'],
    prompt: promptWith('clarify'), catalog,
  });
  assert.deepEqual(a.unknown, ['ghost-skill']);
  assert.deepEqual(a.missing, []);
  assert.match(a.verdict, /目录里查不到：ghost-skill/);
});

test('指纹按空白归一：换行/多空格不影响判定', () => {
  const spaced = '先核对目标、使用者、约束与验收标准，\n\n   再提一个具体问题。';
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['clarify'], prompt: spaced, catalog,
  });
  assert.equal(a.checks[0].present, true);
});

test('skill 本身没写指令 → 判为未生效（空指纹不算通过）', () => {
  const empty = [{ id: 'blank', instruction: '   ' }];
  const a = auditFromPrompt({
    agentKey: 'a1', name: '甲', declared: ['blank'], prompt: '任意内容', catalog: empty,
  });
  assert.equal(a.checks[0].present, false);
  assert.deepEqual(a.missing, ['blank']);
});

test('auditSkills：编译失败不抛，降级成一条「编译失败」结论', async () => {
  const audits = await auditSkills(
    [{ key: 'ok', name: '正常', responsibilities: 'r' }, { key: 'bad', name: '坏', responsibilities: 'r' }],
    async profile => {
      if (profile.id === 'bad') throw new Error('esbuild 崩了');
      return { prompt: promptWith('clarify'), toolNames: ['a', 'b'], definition: { skills: ['clarify'] } };
    },
    catalog,
  );
  assert.equal(audits.length, 2);
  assert.equal(audits[0].missing.length, 0);
  assert.match(audits[1].verdict, /编译失败/);
});

test('summary：统计声明数、生效数、有问题 agent 数', () => {
  const good = auditFromPrompt({ agentKey: 'g', name: '好', declared: ['clarify'], prompt: promptWith('clarify'), catalog });
  const bad = auditFromPrompt({ agentKey: 'b', name: '坏', declared: ['clarify', 'handoff'], prompt: promptWith('clarify'), catalog });
  const s = summarizeSkillAudit([good, bad]);
  assert.equal(s.agents, 2);
  assert.equal(s.degraded, 1);
  assert.equal(s.totalDeclared, 3);
  assert.equal(s.totalEffective, 2);
});
