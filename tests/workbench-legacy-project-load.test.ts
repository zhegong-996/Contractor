import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Settings } from '../src/workbench/config.ts';
import { loadProjectDirectory } from '../src/workbench/project-directory.ts';
import { openSuperAgentStore } from '../src/superagent-ports.ts';

test('早期落库的项目缺少 goals 等数组字段时，加载补齐默认值，避免详情页崩溃', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-legacy-project-'));
  const store = await openSuperAgentStore(path.join(dir, 'store.sqlite'));
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  store.db.exec(`CREATE TABLE workbench_created_project (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  store.db.prepare('INSERT INTO workbench_created_project VALUES (?,?)').run('project-legacy', JSON.stringify({
    id: 'project-legacy', title: '旧项目', members: ['owner'], maintainers: ['owner'],
    topics: [{ id: 'topic-main', title: '主题' }],
  }));
  const loaded = loadProjectDirectory(store, { projects: [], agents: [] } as unknown as Settings);
  const project = loaded.projects.find(row => row.id === 'project-legacy');
  assert.ok(project, '历史项目应被加载');
  assert.deepEqual(project.goals, []);
  assert.deepEqual(project.routines, []);
  assert.deepEqual(project.dispatch, []);
  assert.deepEqual(project.responsibilities, []);
  assert.deepEqual(project.relatedProjects, []);
  assert.deepEqual(project.delegations, []);
  assert.deepEqual(project.resources, []);
  assert.equal(project.topics.length, 1, '原有主题保留');
});
