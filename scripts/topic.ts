// 主题聚合的本地入口。
//
//   npm run topic -- list
//   npm run topic -- view <topicId>
//   npm run topic -- create --title "闭门会筹备" --goal "把活动办完" --owner ou_xxx
//   npm run topic -- attach-task <topicId> --task <taskId> --role role-product --owner ou_xxx
//   npm run topic -- attach-channel <topicId> --kind im --ref oc_xxx --owner ou_xxx
//
// 主题只做聚合：不派单、不判定、不改任务状态。没有责任人的东西挂不进来。
import { api } from '../src/client.ts';

const [action, ...rest] = process.argv.slice(2);
const value = (name: string): string => {
  const inline = rest.find(arg => arg.startsWith(name + '='));
  if (inline) return inline.slice(name.length + 1);
  const index = rest.indexOf(name);
  return index >= 0 ? String(rest[index + 1] ?? '') : '';
};

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

if (action === 'list') {
  const result = await api('/workspace/v06-topic-list', {}) as any;
  if (!result?.total) { console.log('还没有主题。先 npm run topic -- create --title … --goal … --owner …'); }
  else for (const topic of result.topics) {
    console.log(`${topic.topicId}  ${topic.title}  [${topic.status}]  ${topic.summary}`);
  }
} else if (action === 'view') {
  print(await api('/workspace/v06-topic-view', { topicId: rest[0] }));
} else if (action === 'create') {
  const topic = await api('/workspace/v06-topic-create', {
    title: value('--title'), goal: value('--goal'), ownerUserId: value('--owner'),
  }) as any;
  console.log(`已建主题 ${topic?.topic?.id}：${topic?.topic?.title}`);
} else if (action === 'attach-task') {
  const result = await api('/workspace/v06-topic-attach', {
    topicId: rest[0], kind: 'task', taskId: value('--task'),
    roleId: value('--role'), ownerUserId: value('--owner'),
  }) as any;
  print({ topicId: result?.topic?.id, tasks: result?.topic?.tasks?.length });
} else if (action === 'attach-channel') {
  const result = await api('/workspace/v06-topic-attach', {
    topicId: rest[0], kind: value('--kind') || 'im', ref: value('--ref'), ownerUserId: value('--owner'),
  }) as any;
  print({ topicId: result?.topic?.id, channels: result?.topic?.channels?.length });
} else {
  console.log('用法：npm run topic -- list | view <id> | create --title … --goal … --owner … | '
    + 'attach-task <id> --task … --role … --owner … | attach-channel <id> --kind im --ref … --owner …');
  process.exitCode = 1;
}
