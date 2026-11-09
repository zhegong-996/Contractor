// 第四十一轮 · 规则视图（src/rules-view.ts）。
// 目的不是「再抄一遍配置」，而是钉住：每行都能指回来源路径、默认值被显式标注、
// 并发配额复用运行时判据、视图本身不写任何东西。
import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../src/config.ts';
import { buildRulesView, renderRulesViewText } from '../src/rules-view.ts';

const baseConfig = () => configSchema.parse({
  paperclipUrl: 'http://localhost:3100',
  repository: 'acme/demo', checkout: '/tmp/demo', allowedPaths: ['/tmp/demo'],
  defaultAgent: 'worker-a',
  agents: { 'worker-a': { name: '执行 A', mode: 'manual', use: 'command' } },
  feishu: { profile: 'default', enabled: true, allowedSenders: ['ou_a'], allowedChats: ['oc_x'] },
});

test('规则视图：七节齐全，每行都带来源路径且声明零模型调用', () => {
  const view = buildRulesView(baseConfig());
  assert.equal(view.modelCalls, 0);
  assert.deepEqual(view.sections.map(section => section.id),
    ['dispatch', 'routines', 'events', 'agents', 'channels', 'acceptance', 'delivery']);
  for (const section of view.sections) {
    assert.ok(section.fields.length > 0, `${section.id} 没有字段`);
    assert.ok(section.question.length > 0, `${section.id} 没有说明它回答什么问题`);
    for (const item of section.fields) {
      assert.ok(item.source.length > 0, `${section.id}/${item.label} 没有来源`);
      assert.ok(['explicit', 'default'].includes(item.origin));
    }
  }
});

test('规则视图：没写的配置如实标成默认值，不伪装成显式配置', () => {
  const view = buildRulesView(baseConfig());
  const text = view.defaulted.join('｜');
  assert.match(text, /已登记来源/);
  assert.match(text, /默认业务域/);
  // 显式写了的东西不能出现在默认列表里
  assert.doesNotMatch(text, /派活模式/);
});

test('规则视图：例程的并发配额直接复用运行时判据（高频缺省串行）', () => {
  const config = baseConfig();
  config.scheduler.routines = [
    { id: 'poll', title: '巡检', goal: '每 15 分钟巡检一次', schedule: { kind: 'interval', minutes: 15 }, enabled: true },
    { id: 'daily', title: '晨报', goal: '每天出晨报', schedule: { kind: 'daily', at: '09:30' }, enabled: true },
    { id: 'weekly', title: '周整理', goal: '每周整理', schedule: { kind: 'cron', expr: '0 18 * * 0' }, enabled: false },
  ];
  const view = buildRulesView(config);
  const rows = view.sections.find(section => section.id === 'routines')!.rows ?? [];
  assert.equal(rows.length, 3);
  assert.match(rows[0]!.detail, /并发上限 1（密度缺省）/);
  assert.match(rows[1]!.detail, /不限并发/);
  assert.equal(rows[2]!.status, '已停用');
});

test('规则视图：空注册表如实说「会退回扁平」，不硬造中间层', () => {
  const view = buildRulesView(baseConfig());
  const agents = view.sections.find(section => section.id === 'agents')!;
  assert.equal(agents.rows?.length, 0);
  assert.ok(agents.notes.some(note => note.includes('退回扁平')));
});

test('规则视图：纯函数——同一配置两次结果一致，且不改动入参', () => {
  const config = baseConfig();
  const before = JSON.stringify(config);
  const first = buildRulesView(config);
  const second = buildRulesView(config);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(config), before, '视图不能改配置对象');
});

test('规则视图：文本渲染把来源与默认值一起打出来', () => {
  const text = renderRulesViewText(buildRulesView(baseConfig()));
  assert.match(text, /【派活：谁接这一棒】/);
  assert.match(text, /config\.router\.mode/);
  assert.match(text, /默认值/);
  assert.match(text, /本视图只读/);
});
