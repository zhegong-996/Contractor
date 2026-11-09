// 回群对账的本地入口。
//
//   npm run reconcile -- <taskId>
//
// 拿开工前锁定的清单和本轮逐项判定比一遍，把差异打出来。
// 只报不改：不补建待办、不改验收结论、不动 readiness。
import { api } from '../src/client.ts';

const taskId = String(process.argv[2] ?? '').trim();
if (!taskId) {
  console.log('用法：npm run reconcile -- <taskId>');
  process.exitCode = 1;
} else {
  const result = await api('/workspace/v06-reconcile-run', { taskId }) as any;
  if (result?.card) console.log(result.card);
  else console.log(result?.conclusion ?? '没有可对账的内容');
  if (result?.comparable === false) process.exitCode = 2;
}
