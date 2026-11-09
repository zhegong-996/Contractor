// 真跑一次「人 → Agent → 云评审」三角色协作，并生成协作工作台 HTML。
// 用法：npm run collaborate -- "任务描述"
import { runCollaboration } from '../src/collaboration-runtime.ts';
import { renderCollaborationWorkbench } from '../src/collaboration-workbench.ts';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from '../src/config.ts';

const task = process.argv.slice(2).join(' ').trim() || '写一个把字符串反转的 TypeScript 函数，并说明时间复杂度';
console.log('═══ 协作演示：人(coordinator) → 执行 Agent(worker) → 云评审(checker) ═══\n');
try {
  const outcome = await runCollaboration(task, { id: 'feishu-msg-1', type: 'im', detail: task });
  console.log('【委托链】');
  for (const node of outcome.chain) console.log(`  ${node.role} (深度 ${node.depth}) — ${node.task}`);
  console.log('\n【护栏日志】');
  for (const log of outcome.logs) console.log(`  · ${log.stage}: ${log.detail}`);
  console.log('\n【云评审判定】');
  console.log(outcome.checkerVerdict.slice(0, 400));
  const html = renderCollaborationWorkbench(outcome);
  const file = path.join(runtime('v06'), 'collaboration-workbench.html');
  writeFileSync(file, html, { mode: 0o600 });
  console.log(`\n📄 协作工作台已生成：${file}`);
} catch (error) {
  console.error('协作失败：', String(error).slice(0, 500));
  process.exitCode = 1;
}
