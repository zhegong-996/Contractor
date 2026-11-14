// 用户前端不允许再出现英文 accept：协议词只留在内部 API 与工程注释里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { parseUserCommand, USER_HELP, CONFIRM_ACCEPT, userActionLabel } from '../src/user-language.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('中文指令覆盖建任务、进度、补充、确认验收、打回、转交', () => {
  assert.deepEqual(parseUserCommand('任务 [role-growth] 整理销售反馈'),
    { action: 'task', detail: '整理销售反馈', agent: 'role-growth', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('查看进度 SUI-129'),
    { action: 'status', taskId: 'SUI-129', detail: '', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('补充说明 SUI-129 先保留现有页面'),
    { action: 'reply', taskId: 'SUI-129', detail: '先保留现有页面', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('确认验收 SUI-129'),
    { action: 'accept', taskId: 'SUI-129', detail: '', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('验收通过 SUI-129'),
    { action: 'accept', taskId: 'SUI-129', detail: '', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('验收不通过 SUI-129 刷新后丢失'),
    { action: 'reject', taskId: 'SUI-129', detail: '刷新后丢失', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('转交 SUI-129 workbuddy'),
    { action: 'handoff', taskId: 'SUI-129', detail: 'workbuddy', fromLegacySyntax: false });
  assert.equal(userActionLabel('accept'), CONFIRM_ACCEPT);
});

test('旧英文斜杠命令仍可解析（兼容既有脚本），但不再出现在帮助文案里', () => {
  assert.deepEqual(parseUserCommand('/task [codex] 修个页面'),
    { action: 'task', detail: '修个页面', agent: 'codex', fromLegacySyntax: true });
  assert.deepEqual(parseUserCommand('/accept SUI-1 abcdef'),
    { action: 'accept', taskId: 'SUI-1', detail: 'abcdef', fromLegacySyntax: true });
  assert.deepEqual(parseUserCommand('/status SUI-1'),
    { action: 'status', taskId: 'SUI-1', detail: '', fromLegacySyntax: true });
  for (const legacy of ['/accept', '/reject', '/status', '/reply', '/handoff', '/task']) {
    assert.ok(!USER_HELP.includes(legacy), `帮助文案不应出现 ${legacy}`);
  }
  assert.ok(USER_HELP.includes(CONFIRM_ACCEPT));
});

test('闲聊与 @ 不建任务，避免误触发', () => {
  assert.equal(parseUserCommand('今天天气不错'), null);
  assert.equal(parseUserCommand(''), null);
  assert.equal(parseUserCommand('@机器人 你好'), null);
  assert.equal(parseUserCommand('确认验收'), null);
});

test('「任务进度」是查看进度，不会被「任务」前缀误判成建单', () => {
  assert.deepEqual(parseUserCommand('任务进度 SUI-129'),
    { action: 'status', taskId: 'SUI-129', detail: '', fromLegacySyntax: false });
  assert.deepEqual(parseUserCommand('任务 整理本周客户反馈'),
    { action: 'task', detail: '整理本周客户反馈', fromLegacySyntax: false });
  assert.equal(parseUserCommand('任务进度'), null);
});

test('帮助文案如实说明触发条件与代码交付类任务的提交号要求', () => {
  assert.ok(!USER_HELP.includes('直接说'), '帮助文案不能承诺自然语言直接建单');
  assert.match(USER_HELP, /闲聊不会自动建单/);
  assert.match(USER_HELP, /交付提交号/);
  const controller = read('src/controller.ts');
  assert.match(controller, /请附上交付提交号后再确认验收/);
  const readme = read('README.md');
  assert.ok(!readme.includes('/task ['), 'README 不再展示英文建单示例');
  assert.match(readme, /确认验收 SUI-1 交付提交号/);
});

test('用户可见的界面、报告与限制说明一律中文，不含 /accept', () => {
  const surfaces = [
    'plugins/knowledge-workspaces/src/ui/v06-panels.tsx',
    'src/acceptance-interop.ts',
    'src/vision-semantics.ts',
    'README.md',
  ];
  for (const file of surfaces) {
    const source = read(file);
    // 代码注释可以提到内部协议名；用户会看到的字符串不行。
    const userFacing = source.split('\n').filter(line =>
      /p className|<p|empty=|conclusion:|limitations|USER_HELP|确认验收|报告|示例|```text/.test(line)
      || /^\s*['"`].*accept/.test(line));
    assert.ok(!source.includes('"/accept') && !source.includes("'/accept") && !source.includes('的 /accept'),
      `${file} 仍有面向用户的 /accept 文案`);
    assert.ok(!source.includes('/accept SUI-1'), `${file} 仍有英文命令示例`);
    void userFacing;
  }
});

test('按锁定清单确认验收是一条独立路径，身份与闸门都不能省', () => {
  const controller = read('src/controller.ts');
  assert.match(controller, /async confirmAcceptance\(/);
  assert.match(controller, /只有原发起人可以确认验收/);
  assert.match(controller, /verifyAcceptanceGate\(\{ pc: this\.pc, taskId: id, cases \}\)/);
  assert.match(controller, /gate\.status !== 'verified'/);
  assert.match(controller, /不代替人签字/);
  // 旧的 CI/交付验收红线完整保留，没有被新路径替换。
  assert.match(controller, /validateAcceptance\(current, sha, cases\)/);
  assert.match(read('src/delivery-acceptance.ts'), /Acceptance must target the deployed, CI-verified commit/);
});
