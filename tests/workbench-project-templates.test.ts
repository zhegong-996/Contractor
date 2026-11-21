import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectTemplate, materializeTemplate, projectTemplateSchema, type ProjectTemplate } from '../src/workbench/project-templates.ts';
import type { Project } from '../src/workbench/config.ts';

const source = {
  id: 'project-store', title: '门店推荐理由', parent: 'project-parent', members: ['owner', 'dev'],
  maintainers: ['owner'], relatedProjects: [], delegations: [], dispatch: [], responsibilities: [],
  topics: [{ id: 'topic-main', title: '小屏验收' }, { id: 'topic-child', title: '长文本换行', parent: 'topic-main' }],
  resources: [],
  goals: [{ id: 'goal-1', title: '三档视口验收', done: false }],
  routines: [{ id: 'routine-1', title: '每周核对', cron: '0 9 * * 1', actor: 'dev',
    action: { kind: 'consultation', topic: 'topic-main', text: '核对现行规则', agent: 'wrap-codex' } },
  { id: 'routine-2', title: '开下一版', cron: '0 8 * * 1', actor: 'dev',
    action: { kind: 'next-version', ticket: 'ticket-old', reason: '复核' } }],
  trigger: { keywords: ['小屏'], sensitivity: 'balanced', silenceMinutes: 30, mentionAlways: true },
  approvals: [{ id: 'stage-dev', title: '研发确认', members: ['owner', 'dev'], requireAll: false }],
  modelRoutes: [{ purpose: 'execution', agent: 'wrap-codex', models: ['codex-a'] }],
} as unknown as Project;

test('模板导出不含成员与凭据字段，导入时换成导入者并重编号主题', () => {
  const exported = exportProjectTemplate(source);
  const parsed = projectTemplateSchema.parse(exported);
  assert.equal(parsed.kind, 'contractor-project-template');
  assert.equal('members' in parsed, false);
  assert.equal('resources' in parsed, false);
  assert.deepEqual(parsed.topics.map(topic => topic.title), ['小屏验收', '长文本换行']);
  assert.equal(parsed.topics[1].parent, 'topic-main');
  const result = materializeTemplate(parsed, 'new-owner', new Set(['wrap-codex']), 'project-new');
  assert.ok(result.topics[0]?.id.startsWith('topic-new-'));
  assert.ok(!result.topics[0]?.id.includes('--'), '主题标识不带连续连字符');
  assert.equal(result.topics[1]?.parent, result.topics[0]?.id);
  assert.deepEqual(result.routines.map(routine => routine.actor), ['new-owner'], 'next-version 例行任务被丢弃');
  assert.deepEqual(result.approvals?.map(stage => stage.members), [['new-owner']]);
  assert.deepEqual(result.modelRoutes?.map(route => route.agent), ['wrap-codex']);
});

test('模板导入丢弃当前部署不存在的模型路线与外部工单例行任务', () => {
  const template: ProjectTemplate = {
    kind: 'contractor-project-template', version: 1, title: '模板',
    goals: [{ id: 'goal-a', title: '目标' }],
    topics: [{ id: 'topic-a', title: '主题' }],
    routines: [{ id: 'routine-x', title: '开下一版', cron: '0 8 * * 1', actor: 'dev',
      action: { kind: 'next-version', ticket: 'ticket-elsewhere', reason: '复核' } },
    { id: 'routine-y', title: '例行工单', cron: '0 9 * * 1', actor: 'dev',
      action: { kind: 'ticket', title: '例行核对', request: '核对', topic: 'topic-a', agent: 'missing-agent' } }],
    modelRoutes: [{ purpose: 'execution', agent: 'missing-agent', models: ['unknown'] },
      { purpose: 'summary', agent: 'router', models: ['sum'] }],
  };
  const result = materializeTemplate(template, 'actor', new Set(['router']), 'project-fresh');
  assert.deepEqual(result.routines.map(routine => routine.id), ['routine-y']);
  assert.equal(result.routines[0]?.action.kind, 'ticket');
  assert.deepEqual(result.modelRoutes, [{ purpose: 'summary', agent: 'router', models: ['sum'] }]);
  assert.deepEqual(result.goals, [{ id: 'goal-a', title: '目标', done: false }]);
});
