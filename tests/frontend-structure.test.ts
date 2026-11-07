// 前端分层守卫：拆分后的职责边界、单一来源契约、错误反馈与安全渲染红线。
// 这些断言针对源码结构，配合 test:walkthrough 的真实浏览器校验一起保证重构不回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';

const uiDir = path.join(root, 'plugins/knowledge-workspaces/src/ui');
const files = readdirSync(uiDir).filter(f => /\.(tsx|ts)$/.test(f));
const read = (name: string) => readFileSync(path.join(uiDir, name), 'utf8');
const all = files.map(read).join('\n');

test('index.tsx 只是 SDK 固定入口，业务实现按职责分散', () => {
  const entry = read('index.tsx');
  assert.ok(entry.split('\n').length <= 12, '入口文件不应重新堆业务逻辑');
  assert.match(entry, /export \{ WorkspacePage \} from '\.\/workspace-page\.js'/);
  assert.match(entry, /export \{ WorkspaceSidebar \} from '\.\/foundation\.js'/);
  assert.doesNotMatch(entry, /function [A-Z]|useState\(/);
  for (const name of ['foundation.tsx', 'async.ts', 'forms.tsx', 'domestic-services.tsx',
    'settings.tsx', 'task-detail.tsx', 'spaces.tsx', 'workspace-page.tsx']) {
    assert.ok(files.includes(name), `缺少分层模块 ${name}`);
    assert.match(read(name), /^\/\//, `${name} 需要一句职责说明`);
  }
  assert.ok(read('index.tsx').length < 600, '入口不应包含实现代码');
});

test('展示原语与 UI 契约只有 foundation 一份来源', () => {
  const foundation = read('foundation.tsx');
  for (const symbol of ['useDraft', 'Details', 'Icon', 'Button', 'Badge', 'RecordBody',
    'safeHttpUrl', 'safeLoopbackUrl', 'contentKinds', 'WorkspaceSidebar']) {
    assert.match(foundation, new RegExp(`export (?:function|const|type) ${symbol}\\b`));
  }
  assert.match(foundation, /export type UI/);
  for (const name of files.filter(f => f !== 'foundation.tsx' && f !== 'index.tsx')) {
    const source = read(name);
    assert.doesNotMatch(source, /^(?:export )?function (?:useDraft|Details|Icon|Button|Badge|RecordBody)\b/m,
      `${name} 不应重新定义展示原语`);
    assert.doesNotMatch(source, /^(?:export )?const (?:labels|events|contentKinds)\s*[:=]/m,
      `${name} 不应复制中文文案字典`);
  }
});

test('依赖单向：视图不反向 import 页面壳，也不形成模块环', () => {
  assert.doesNotMatch(read('foundation.tsx'), /from '\.\/(?:forms|settings|task-detail|spaces|workspace-page)/);
  assert.doesNotMatch(read('async.ts'), /from '\.\//, '异步层应保持无内部依赖');
  for (const name of files.filter(f => f !== 'index.tsx')) {
    assert.doesNotMatch(read(name), /from '\.\/workspace-page\.js'/,
      `${name} 不能反向依赖页面壳`);
  }
  const layers: Record<string, string[]> = {
    'foundation.tsx': [], 'async.ts': [],
    'forms.tsx': ['foundation'], 'domestic-services.tsx': ['foundation'],
    'settings.tsx': ['foundation', 'domestic-services', 'v06-panels'],
    'task-detail.tsx': ['foundation', 'forms'],
    'spaces.tsx': ['foundation', 'forms'],
    'workspace-page.tsx': ['foundation', 'forms', 'task-detail', 'spaces', 'settings'],
  };
  for (const [name, allowed] of Object.entries(layers)) {
    const imports = [...read(name).matchAll(/from '\.\/([A-Za-z0-9-]+)\.js'/g)].map(m => m[1]!);
    for (const dep of imports) {
      if (dep === 'styles' || dep === 'cognee-dynamic') continue;
      assert.ok(allowed.includes(dep) || ['collaboration-network', 'development', 'v06-panels',
        'knowledge-graph', 'agent-services', 'async'].includes(dep),
      `${name} 不应依赖 ${dep}`);
    }
  }
});

test('异步契约统一：v0.6 面板复用共享 useRead，写操作不再静默吞错', () => {
  assert.match(read('async.ts'), /export function useRead/);
  assert.match(read('async.ts'), /export function useActionFeedback/);
  const panels = read('v06-panels.tsx');
  assert.match(panels, /import \{ useRead \} from '\.\/async\.js'/);
  assert.doesNotMatch(panels, /function useRead\(/, 'v0.6 面板不应保留私有状态机副本');
  const forms = read('forms.tsx'), page = read('workspace-page.tsx');
  assert.match(forms, /useActionFeedback/);
  assert.match(forms, /ActionError error=\{submitError\}/);
  assert.doesNotMatch(forms, /catch\(\(\) => \{\}\)/);
  const silent = files.filter(f => read(f).includes('catch(() => {})'));
  assert.deepEqual(silent, ['workspace-page.tsx'], '只有页面壳可以保留有理由的静默 catch');
  assert.match(page, /后台轮询失败不打断用户/);
  assert.match(page, /invoke 内部已把失败写入页面错误条/);
  assert.match(read('foundation.tsx'), /report: \(message: string\) => void/);
  for (const name of ['task-detail.tsx', 'spaces.tsx', 'settings.tsx']) {
    const source = read(name);
    const invokes = (source.match(/ui\.invoke\(/g) ?? []).length;
    const reported = (source.match(/ui\.report\(/g) ?? []).length;
    assert.ok(invokes === 0 || reported > 0, `${name} 的写操作必须显式上报失败`);
  }
});

test('未接通不放入口与外链安全红线在拆分后依然成立', () => {
  const panel = read('domestic-services.tsx');
  assert.match(panel, /interface ServiceEntry/);
  assert.match(panel, /url\?: string/, '未接通项在数据契约里就不应保证有 url');
  assert.match(panel, /const href = s\.state === 'connected' \? safeLoopbackUrl\(s\.url\) : null/);
  assert.equal((all.match(/href=\{href\}/g) ?? []).length, 1, '全前端只允许一个状态驱动的链接出口');
  assert.doesNotMatch(all, /href=\{current\.external\.url\}/, '飞书来源外链必须经过协议校验');
  assert.doesNotMatch(all, /<li key=\{url\}><a href=\{url\}/, '知识来源外链必须经过协议校验');
  assert.ok((all.match(/safeHttpUrl\(/g) ?? []).length >= 4);
});
