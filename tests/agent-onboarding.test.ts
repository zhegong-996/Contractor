// 第六十八轮 · 接入台契约：
// 五档状态必须由「事实」唯一决定，不允许"未知"；目录 key 与 use 必须能落进 config.agents。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTION_CATALOG, onboardingState } from '../src/agent-onboarding.ts';

test('五档状态：装了才谈得上配置，配了才谈得上启用，启用才谈得上绑定', () => {
  const fact = (installed: boolean, configured: boolean, enabled: boolean, paperclipBound: boolean) =>
    onboardingState({ installed, configured, enabled, paperclipBound });

  assert.equal(fact(false, false, false, false), 'not-installed');
  assert.equal(fact(false, true, true, true), 'not-installed', '没装就是没装，配置再全也没用');
  assert.equal(fact(true, false, false, false), 'needs-register');
  assert.equal(fact(true, true, false, true), 'needs-enable', '已注册但停用 → 待启用');
  assert.equal(fact(true, true, true, false), 'needs-binding', '启用但没 paperclipId → 派不出去');
  assert.equal(fact(true, true, true, true), 'ready');
});

test('五档互斥且覆盖全集：任一事实组合都必须落到已知档位', () => {
  const states = new Set<string>();
  for (const installed of [false, true]) {
    for (const configured of [false, true]) {
      for (const enabled of [false, true]) {
        for (const paperclipBound of [false, true]) {
          const s = onboardingState({ installed, configured, enabled, paperclipBound });
          assert.ok(['not-installed', 'needs-register', 'needs-enable', 'needs-binding', 'ready'].includes(s), s);
          states.add(s);
        }
      }
    }
  }
  assert.equal(states.size, 5, '16 种组合必须覆盖全部五档');
});

test('目录：key 唯一、use 合法、bin 非空、有文档链接', () => {
  const keys = EXECUTION_CATALOG.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length, 'key 不能重复');
  const allowedUse = new Set(['codex', 'claude', 'command', 'acp']);
  for (const item of EXECUTION_CATALOG) {
    assert.ok(allowedUse.has(item.use), `${item.key} 的 use=${item.use} 不在 config schema 允许范围`);
    assert.ok(item.bin.length > 0, `${item.key} 缺 bin`);
    assert.match(item.docs, /^https:\/\//, `${item.key} 缺官方文档链接`);
    assert.ok(item.versionArgs.length > 0, `${item.key} 缺版本探测参数`);
  }
});

test('目录里 codex / claude 必须映射到原生 use，其余走 command', () => {
  const byKey = new Map(EXECUTION_CATALOG.map(c => [c.key, c]));
  assert.equal(byKey.get('codex')?.use, 'codex');
  assert.equal(byKey.get('claude')?.use, 'claude');
  for (const key of ['gemini', 'opencode', 'kimi', 'cursor']) {
    assert.equal(byKey.get(key)?.use, 'command', `${key} 没有原生 use，应走 command`);
  }
});
