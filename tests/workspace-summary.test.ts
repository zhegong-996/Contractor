// P-5：控制台摘要视图的服务端分页 / 裁剪契约。纯函数真跑，不启动服务、不碰 .runtime。
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/store.ts';
import {
  buildWorkspaceSummary, parseViewSummaryPage, visibleTasksFor,
  VIEW_SUMMARY_DEFAULT_LIMIT, VIEW_SUMMARY_MAX_LIMIT, VIEW_SUMMARY_NOTE,
  type ViewSummaryInput,
} from '../src/workspace-summary.ts';

const admin = { admin: true, userId: 'local-board' };
const alice = { admin: false, userId: 'u-a', agent: 'agent-a', humanRole: 'member' };

function task(index: number, patch: Partial<Task> = {}): Task {
  return {
    id: `task-${index}`, identifier: `SUI-${100 + index}`, triggerId: `trigger-${index}`,
    chatId: 'chat', messageId: 'msg', senderId: 'sender', agent: 'agent-a',
    workspace: 'ws', branch: 'main', context: `本地指令 ${index}\n第二行不应出现在摘要`,
    generation: index, phase: 'in_progress', kind: 'collaboration',
    lease: 'secret-lease', runId: 'secret-run',
    delivery: { pr: 1, url: 'secret-url', headSha: 'sha', ci: 'passed', merged: false },
    ...patch,
  } as Task;
}

const tasks: Task[] = Array.from({ length: 20 }, (_, i) => task(i, {
  agent: i % 3 === 0 ? 'agent-b' : 'agent-a',
  phase: i % 2 ? 'review' : 'in_progress',
}));

function input(patch: Partial<ViewSummaryInput> = {}): ViewSummaryInput {
  return {
    tasks, actor: admin, spaceCount: 6, sourceCount: 16,
    feishuConnected: true, assistantAvailable: true, configurableAgents: 3,
    generatedAt: '2026-11-08T03:00:00.000Z', ...patch,
  };
}

test('P-5 默认只给一页，taskCount 仍是当前身份可见的全量', () => {
  const result = buildWorkspaceSummary(input());
  assert.equal(result.page.offset, 0);
  assert.equal(result.page.limit, VIEW_SUMMARY_DEFAULT_LIMIT);
  assert.equal(result.page.total, 20);
  assert.equal(result.taskCount, 20);
  assert.equal(result.tasks.length, VIEW_SUMMARY_DEFAULT_LIMIT);
  assert.equal(result.page.hasMore, true);
  assert.equal(result.fieldsClipped, true);
  assert.equal(result.note, VIEW_SUMMARY_NOTE);
});

test('P-5 分页按 offset/limit 取，末页 hasMore 为 false，越界返回空页', () => {
  const second = buildWorkspaceSummary(input({ limit: 8, offset: 8 }));
  assert.equal(second.tasks.length, 8);
  assert.equal(second.tasks[0]!.identifier, 'SUI-108');
  assert.equal(second.page.hasMore, true);
  const last = buildWorkspaceSummary(input({ limit: 8, offset: 16 }));
  assert.equal(last.tasks.length, 4);
  assert.equal(last.page.hasMore, false);
  const beyond = buildWorkspaceSummary(input({ offset: 999 }));
  assert.deepEqual(beyond.tasks, []);
  assert.equal(beyond.taskCount, 20, '计数不能因为翻页而缩水');
});

test('P-5 分页参数一律夹在安全区间，拒绝一次拿全量', () => {
  assert.deepEqual(parseViewSummaryPage({}), { limit: VIEW_SUMMARY_DEFAULT_LIMIT, offset: 0 });
  assert.deepEqual(parseViewSummaryPage({ limit: 99999, offset: -7 }), { limit: VIEW_SUMMARY_MAX_LIMIT, offset: 0 });
  assert.deepEqual(parseViewSummaryPage({ limit: 0, offset: 5.9 }), { limit: 1, offset: 5 });
  assert.deepEqual(parseViewSummaryPage({ limit: NaN, offset: Infinity }), { limit: VIEW_SUMMARY_DEFAULT_LIMIT, offset: 0 });
  assert.deepEqual(parseViewSummaryPage(null), { limit: VIEW_SUMMARY_DEFAULT_LIMIT, offset: 0 });
  const hostile = buildWorkspaceSummary(input({ limit: 100000, offset: -1 }));
  assert.equal(hostile.page.limit, VIEW_SUMMARY_MAX_LIMIT);
  assert.equal(hostile.tasks.length, 20, '上限只是夹参数，不凭空造出更多任务');
});

test('P-5 身份过滤与原 view 一致：管理员看全部，非管理员只看自己承接的', () => {
  assert.equal(visibleTasksFor(admin, tasks).length, 20);
  assert.equal(visibleTasksFor(alice, tasks).length, 13);
  assert.equal(buildWorkspaceSummary(input({ actor: alice })).taskCount, 13);
  assert.ok(buildWorkspaceSummary(input({ actor: alice })).tasks.every(t => t.agent === 'agent-a'));
  assert.equal(buildWorkspaceSummary(input({ actor: { admin: false } })).taskCount, 0);
  // 非协作任务不进摘要，和 view 的 kind 过滤一致。
  assert.equal(visibleTasksFor(admin, [task(1, { kind: 'development' })]).length, 0);
});

test('P-5 只返回白名单字段，绝不把内部状态带出服务端', () => {
  const result = buildWorkspaceSummary(input({ limit: 1 }));
  const keys = Object.keys(result.tasks[0]!).sort();
  assert.deepEqual(keys, ['agent', 'generation', 'goal', 'id', 'identifier', 'phase', 'title']);
  const serialized = JSON.stringify(result);
  for (const leaking of ['secret-lease', 'secret-run', 'secret-url', '第二行不应出现在摘要', 'delivery', 'lease', 'runId', 'context']) {
    assert.ok(!serialized.includes(leaking), `摘要不得泄露：${leaking}`);
  }
});

test('P-5 宿主标题优先、超长截断；缺标题的条目降级到本机任务索引', () => {
  const long = '标'.repeat(300);
  const result = buildWorkspaceSummary(input({
    limit: 2,
    hostTitles: { 'task-0': { title: '宿主权威标题', goal: long }, 'task-1': { title: long, goal: '目标' } },
  }));
  assert.equal(result.titleSource, 'host');
  assert.equal(result.tasks[0]!.title, '宿主权威标题');
  assert.equal(result.tasks[0]!.goal.length, 161, '目标截断到 160 字加省略号');
  assert.equal(result.tasks[1]!.title.length, 121);
});

test('P-5 部分标题可用标 partial，全不可用标 local 且列表不减少', () => {
  const partial = buildWorkspaceSummary(input({ limit: 3, hostTitles: { 'task-0': { title: '只有一条', goal: '' } } }));
  assert.equal(partial.titleSource, 'partial');
  assert.equal(partial.tasks.length, 3);
  const local = buildWorkspaceSummary(input({ limit: 3 }));
  assert.equal(local.titleSource, 'local');
  assert.equal(local.tasks.length, 3);
  assert.equal(local.tasks[0]!.title, '本地指令 0');
  assert.equal(local.tasks[0]!.goal, '');
});

test('P-5 纯函数确定性：同样输入两次逐字节一致，且不修改输入', () => {
  const frozen = Object.freeze(tasks.map(t => Object.freeze({ ...t })));
  const hostTitles = Object.freeze({ 'task-0': Object.freeze({ title: '固定标题', goal: '固定目标' }) });
  const first = buildWorkspaceSummary(input({ tasks: frozen, hostTitles }));
  const second = buildWorkspaceSummary(input({ tasks: frozen, hostTitles }));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.generatedAt, '2026-11-08T03:00:00.000Z');
});

test('P-5 统计与连接标记如实透传，空页也不编造', () => {
  const result = buildWorkspaceSummary(input({ limit: 1 }));
  assert.equal(result.spaceCount, 6);
  assert.equal(result.sourceCount, 16);
  assert.equal(result.feishuConnected, true);
  assert.equal(result.assistantAvailable, true);
  assert.equal(result.configurableAgents, 3);
  const empty = buildWorkspaceSummary(input({ tasks: [], limit: 1 }));
  assert.equal(empty.taskCount, 0);
  assert.equal(empty.page.total, 0);
  assert.equal(empty.page.hasMore, false);
  assert.equal(empty.titleSource, 'local');
});
