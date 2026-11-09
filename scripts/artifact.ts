// 产物与续改链的本地入口。
//
//   npm run artifact -- list
//   npm run artifact -- view <ref>
//   npm run artifact -- register --ref report:SUI-128 --title "验收报告" --revision r3 --by ou_xxx [--task <taskId>]
//   npm run artifact -- continue <ref> --by ou_xxx [--goal "把预算改成 80 人档"] [--note "…"]
//
// 续改不复制旧产物：登记一条「从哪一版接的」，并给出可执行的任务简述，由派活链路去建任务。
import { api } from '../src/client.ts';

const [action, ...rest] = process.argv.slice(2);
const value = (name: string): string => {
  const inline = rest.find(arg => arg.startsWith(name + '='));
  if (inline) return inline.slice(name.length + 1);
  const index = rest.indexOf(name);
  return index >= 0 ? String(rest[index + 1] ?? '') : '';
};

if (action === 'list') {
  const result = await api('/workspace/v06-artifact-list', {}) as any;
  if (!result?.total) console.log('还没有登记过产物。');
  else for (const artifact of result.artifacts) {
    console.log(`${artifact.ref}  ${artifact.title}  当前 ${artifact.current}  （${artifact.revisions} 版）`);
  }
} else if (action === 'view') {
  console.log(JSON.stringify(await api('/workspace/v06-artifact-view', { ref: rest[0] }), null, 2));
} else if (action === 'register') {
  const result = await api('/workspace/v06-artifact-register', {
    ref: value('--ref'), title: value('--title'), revision: value('--revision'),
    by: value('--by'), taskId: value('--task') || null, summary: value('--summary'),
  }) as any;
  console.log(`已登记 ${result?.artifact?.ref} @ ${result?.artifact?.current}（共 ${result?.artifact?.revisions?.length} 版）`);
} else if (action === 'continue') {
  const result = await api('/workspace/v06-artifact-continue', {
    ref: rest[0], by: value('--by'), goal: value('--goal'), note: value('--note'),
  }) as any;
  console.log(result?.brief ?? '');
  console.log(`\n接续单：${result?.continuation?.id}（从 ${result?.continuation?.fromRevision} 版接）`);
} else {
  console.log('用法：npm run artifact -- list | view <ref> | register --ref … --revision … --by … | continue <ref> --by … --goal …');
  process.exitCode = 1;
}
