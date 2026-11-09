// 巡检播报的本地入口。
//
//   npm run patrol             # 只预览：和上一份快照比，有变化才打印卡片
//   npm run patrol -- --commit # 预览并把当前状态存成新快照
//
// 没有变化时什么都不打印 —— 巡检的价值在于「有变化才出声」，不是按时打卡。
// 直接读本机 store，不经过 bridge：巡检本来就不该依赖「服务是否在线」。
import path from 'node:path';
import { runtime } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { diffSnapshot, patrolCard, readSnapshot, writeSnapshot, type TaskMark } from '../src/patrol.ts';
import { artifactRevisionByTask } from '../src/artifact.ts';

const commit = process.argv.includes('--commit');
const dir = runtime('v06');
const store = new Store(path.join(runtime(), 'bridge.sqlite'));
const revisions = artifactRevisionByTask(dir);
const marks: Record<string, TaskMark> = {};
for (const task of store.list()) {
  const revision = revisions[task.id];
  marks[task.id] = { phase: String((task as { phase?: string }).phase ?? ''), round: null,
    ...(revision ? { artifactRevision: revision } : {}) };
}

const previous = readSnapshot(dir);
const changes = diffSnapshot(previous, marks);
const card = patrolCard(changes);
if (commit) writeSnapshot(dir, marks);

if (!previous) console.log(`首次巡检：只建立基线（${Object.keys(marks).length} 个任务），不报变化。`);
else if (!card) console.log(`本次巡检没有变化（${Object.keys(marks).length} 个任务），不发送。`);
else console.log(card);
