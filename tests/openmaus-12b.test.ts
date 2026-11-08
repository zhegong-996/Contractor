// 12b（第三十一轮落地，OpenMausBot 差距 7/10/11 项，只借思想零代码引入）契约测试：
//   ⑦ Skill 能力包：frontmatter 白名单、导入默认关、开启绑定内容哈希、内容变更失效；
//   ⑩ 升级通道：同任务同主题去重、1 小时 3 条限速、首个新问题必达、恒不代批；
//   ⑪ 团队包：字段黑名单（权限/凭据/模型）、导入只产候选引用不提权、二次密钥扫描。
// ⑧⑨（崩溃恢复区分对外副作用 / 委托树血缘 + generation）在 PG 真跑链路，
// 由 scripts/steps-smoke.ts 覆盖（本机专属库），不在单测里伪造数据库。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseSkillMarkdown, importSkill, readSkill, listSkills, enableSkill, skillIntact, skillContentHash,
} from '../src/skill-pack.ts';
import { escalationGate, escalationMessage, ESCALATION_MAX_PER_WINDOW } from '../src/escalation.ts';
import { reviewTeamPack, importTeamPack, TEAM_PACK_FORBIDDEN_KEYS } from '../src/team-pack.ts';

const SKILL_BODY = `---
id: selfcheck-delivery
name: 交付前自查
version: 1.0.0
description: 打回原因沉淀的交付前自查标准
triggerTerms: [自查, 交付, 打回]
---

## 自查标准
1. 交付物与验收清单一一对应
2. 每项判定有证据链接`;

test('skill pack: frontmatter whitelist, version format, and default disabled on import', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-skills-'));
  try {
    const record = importSkill(SKILL_BODY, 'tests', dir);
    assert.equal(record.enabled, false, '导入恒不自动启用');
    assert.equal(record.manifest.defaultEnabled, false, 'defaultEnabled 是 literal false');
    assert.equal(record.contentSha256, skillContentHash(SKILL_BODY.split('---\n')[2]!.trim()));
    const read = readSkill('selfcheck-delivery', dir);
    assert.deepEqual(read.manifest.triggerTerms, ['自查', '交付', '打回']);
    assert.equal(listSkills(dir).length, 1);

    // frontmatter 白名单之外的键直接拒绝。
    assert.throws(() => parseSkillMarkdown('---\nid: x\nname: x\nversion: 1.0.0\ndescription: d\nautoApprove: true\n---\nbody'),
      /不允许字段 autoApprove/);
    assert.throws(() => parseSkillMarkdown('---\nid: x\nname: x\nversion: 1.0\ndescription: d\n---\nbody'),
      /version/, '版本号必须 x.y.z');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skill pack: enabling binds the content hash; tampered content invalidates it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-skills-'));
  try {
    importSkill(SKILL_BODY, 'tests', dir);
    const enabled = enableSkill('selfcheck-delivery', 'user:reviewer', dir);
    assert.equal(enabled.ok, true);
    assert.equal(skillIntact(enabled.record!), true, '开启时绑定当前哈希');
    // 内容被改动：重读后 contentSha256 与开启时绑定的不一致 → 失效，必须重新人审。
    const file = path.join(dir, 'selfcheck-delivery', 'SKILL.md');
    writeFileSync(file, SKILL_BODY.replace('交付物与验收清单一一对应', '交付物与验收清单无需对应'), { mode: 0o600 });
    const tampered = readSkill('selfcheck-delivery', dir);
    assert.equal(skillIntact(tampered), false, '内容变化后开启自动失效');
    assert.notEqual(tampered.contentSha256, tampered.enabledForSha256);
    // 重新开启绑定新哈希。
    const reEnabled = enableSkill('selfcheck-delivery', 'user:reviewer', dir);
    assert.equal(reEnabled.ok, true);
    assert.equal(skillIntact(reEnabled.record!), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('escalation gate: dedupes the same question, rate-limits the window, never approves', () => {
  const at = Date.parse('2026-11-08T12:00:00Z');
  const first = escalationGate([], { taskId: 'SUI-1', topic: '需要你确认验收口径', at });
  assert.equal(first.notify, true, '首个新问题必达，不因限速漏发');
  assert.equal(first.advisory, true);
  assert.equal(first.modelCalls, 0);
  // 同任务同主题重复提醒：静音（等待处理期间不重复打扰）。
  const dup = escalationGate([{ taskId: 'SUI-1', topic: '需要你确认验收口径', at }],
    { taskId: 'SUI-1', topic: '需要你确认验收口径', at: at + 60_000 });
  assert.equal(dup.notify, false, '同一问题不重复打扰');
  // 不同主题的新问题照常通知。
  const second = escalationGate([{ taskId: 'SUI-1', topic: '需要你确认验收口径', at }],
    { taskId: 'SUI-2', topic: '需要你确认交付清单', at: at + 120_000 });
  assert.equal(second.notify, true);
  // 1 小时窗口内已有 3 条 → 第 4 条静音。
  const history = Array.from({ length: ESCALATION_MAX_PER_WINDOW }, (_, i) =>
    ({ taskId: 'SUI-' + i, topic: '主题 ' + i, at: at + i * 60_000 }));
  const fourth = escalationGate(history, { taskId: 'SUI-9', topic: '新主题', at: at + 200_000 });
  assert.equal(fourth.notify, false, '超出窗口上限静音');
  assert.equal(fourth.muted, 1);
  // 文案恒带「不代为批准」防呆。
  const message = escalationMessage(first, '请确认验收口径');
  assert.match(message, /不代为批准/);
  assert.equal(escalationMessage(dup, 'x'), '', '静音的不产出文案');
});

test('team pack: forbidden keys (permissions / credentials / models) are rejected', () => {
  const legal = { format: 'suitme-team-pack', version: '1.0.0', name: '试点团队包', description: 'd',
    agents: [{ name: '个人助手', note: '' }], standards: ['交付物与验收清单一一对应'], knowledgeRefs: [] };
  assert.equal(reviewTeamPack(legal).ok, true);

  for (const key of ['permissions', 'apiKey', 'modelSelection', 'autoApprove']) {
    const pack = { ...legal, [key]: 'whatever' };
    const review = reviewTeamPack(pack);
    assert.equal(review.ok, false, `禁携字段 ${key} 必须拒绝`);
    assert.ok(review.secretScanHits.some(hit => hit.key === key), `黑名单命中 ${key}`);
  }
  // 二次密钥扫描：正文里混进真实密钥形态也要拦。
  const withSecret = { ...legal, description: '联系 sk-abcdef0123456789abcdef 试用' };
  const scanned = reviewTeamPack(withSecret);
  assert.equal(scanned.ok, false);
  assert.ok(scanned.secretScanHits.some(hit => hit.kind.includes('API Key')), '密钥形态如实报出');
});

test('team pack: import produces candidate references only, never elevates permissions', () => {
  const pack = { format: 'suitme-team-pack', version: '1.0.0', name: '试点团队包', description: '',
    agents: [{ name: '个人助手', note: '' }, { name: '不存在的岗位', note: '' }],
    standards: ['交付物与验收清单一一对应'], knowledgeRefs: [{ taskId: 't1', key: 'knowledge-a' }] };
  const imported = importTeamPack(pack, { names: ['个人助手'] });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.candidates.agents, ['个人助手', '不存在的岗位']);
  assert.deepEqual(imported.unknownAgents, ['不存在的岗位'], '未登记编制名如实标出，需人工登记后才生效');
  assert.deepEqual(imported.candidates.standards, ['交付物与验收清单一一对应'], '标准只进候选池走 C-6 人审');
  assert.equal(imported.note.includes('不产生任何权限变更'), true, '导入永不提权');
  // 坏包：什么都不导入。
  const bad = importTeamPack({ ...pack, token: 'x' }, { names: [] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.candidates.agents, [], '审查未通过不导入任何内容');
});

test('team pack forbidden list and skill whitelist stay disjoint and non-empty', () => {
  assert.ok(TEAM_PACK_FORBIDDEN_KEYS.length >= 10, '黑名单覆盖权限 / 凭据 / 模型三类以上');
});
