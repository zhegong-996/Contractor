import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, secrets } from './config.ts';
import { reusable } from './knowledge.ts';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';

export const cogneeCommit = '525b1d1179c550cd5b5661bcbf8f00f57a676928';
export class KnowledgeGraph {
  constructor(readonly w: Workspaces) {}
  async source(id: string, actor: WorkspaceActor, taskId?: string) {
    const source = this.w.source(id);
    if (source.external) throw new Error('飞书原文尚未授权给图谱处理；不会自动复制来源');
    if (!actor.admin) {
      if (!taskId) throw new Error('Unauthorized: graph task scope');
      const task = this.w.store.get(taskId), state = await this.w.state(task);
      if (task.phase === 'accepted' || task.agent !== actor.agent || !state.sources.includes(id)
        || !await this.w.allowed(task, id, actor.agent!, state)) throw new Error('Unauthorized: graph source scope');
    }
    const record = await this.w.knowledge.read(source.ref, actor.admin ? this.w.pc : this.w.reader(actor.agent!));
    if (!actor.admin && !reusable(record.value, this.w.config, secrets().jwtSecret)) throw new Error('知识尚未确认，不能作为 Agent 长期记忆使用');
    return { source, record };
  }
  async run(id: string, revision: string, project: boolean, actor: WorkspaceActor, taskId?: string) {
    if (project) this.w.manager(actor);
    const before = await this.source(id, actor, taskId);
    if (before.record.revision !== revision) throw new Error('来源版本已变化，请核对当前版本后生成图谱');
    const folder = runtime('knowledge-graph', createHash('sha256').update(id + '@' + revision).digest('hex'));
    const python = runtime('cognee-venv', 'bin', 'python');
    if (!existsSync(python)) throw new Error('Cognee 尚未安装，请运行 npm run setup:graph');
    if (!project && !existsSync(path.join(folder, 'ready.json'))) throw new Error('此版本尚未生成图谱');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const input = { op: project ? 'project' : 'read', ...(project ? { source: { id, revision, title: before.record.value.title,
      body: before.record.value.body, state: before.record.value.state, facts: before.record.value.facts } } : {}) };
    const result = await new Promise<any>((resolve, reject) => {
      const child = spawn(python, [path.join(root, 'scripts/cognee-graph.py')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONPATH: path.join(root, 'upstream/cognee'),
          TELEMETRY_DISABLED: '1', SUITME_GRAPH_PATH: path.join(folder, 'graph.ladybug'), PYTHONDONTWRITEBYTECODE: '1' } });
      let stdout = '', stderr = ''; const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Cognee 图谱操作超时；按相同来源版本重试')); }, 90000);
      child.stdin.end(JSON.stringify(input)); child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr = (stderr + data).slice(-10000); });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); const line = stdout.split('\n').findLast(l => l.startsWith('SUITME_COGNEE_RESULT='));
        if (!line || code !== 0) { writeFileSync(path.join(folder, 'last-error.log'), stderr, { mode: 0o600 }); reject(new Error('Cognee 图谱操作失败；原始资料未改动')); return; }
        try { resolve(JSON.parse(line.slice('SUITME_COGNEE_RESULT='.length))); } catch { reject(new Error('Cognee 返回格式异常')); }
      });
    });
    const after = await this.source(id, actor, taskId);
    if (after.record.revision !== before.record.revision || after.record.hash !== before.record.hash) throw new Error('图谱处理期间资料或权限已变化，结果不交付');
    if (project) { writeFileSync(path.join(folder, 'ready.json'), JSON.stringify({ sourceId: id, revision, commit: cogneeCommit }), { mode: 0o600 });
      this.w.store.audit('knowledge.graph-projected', id, { revision, engine: 'cognee', nodes: result.nodes.length, edges: result.edges.length, modelCalls: 0 }); }
    return { ...result, sourceId: id, revision, knowledgeState: after.record.value.state, commit: cogneeCommit, sourceHash: after.record.hash };
  }
}
