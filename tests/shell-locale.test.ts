import test from 'node:test';
import assert from 'node:assert/strict';
import { chineseShell } from '../src/shell-locale.ts';
test('Chinese shell translates display copy while preserving API values, route identities and source data', () => {
  const code = `const selected=useState("All"); const x={id:"Tasks",status:"in_progress",label:"Tasks",action:"Save"}; export const C=()=> <div><button title="Save">Save</button><input name="Title" placeholder="Search..."/><a href="/issues">Tasks</a><option value="All">All</option><span className={x ? "Open" : "Closed"}>Status</span></div>`;
  const translated = chineseShell(code, '/repo/ui/src/pages/Tasks.tsx');
  assert.match(translated, /id:"Tasks"/); assert.match(translated, /status:"in_progress"/); assert.match(translated, /action:"Save"/); assert.match(translated, /name="Title"/); assert.match(translated, /href="\/issues"/);
  assert.match(translated, /label:"任务"/); assert.match(translated, />保存<\/button>/); assert.match(translated, /placeholder="搜索…"/);
  assert.match(translated, /useState\("All"\)/); assert.match(translated, /value="All">全部/); assert.match(translated, /className=\{x \? "Open" : "Closed"\}/);
  assert.equal(chineseShell(code, '/repo/server/src/routes/tasks.ts'), code);
  const dynamic = chineseShell('const C=()=> <button aria-label={`Open ${name} organization switcher`}>Next</button>', '/repo/ui/src/components/Sidebar.tsx');
  assert.match(dynamic, /`打开\$\{name\}组织切换器`/);
});
