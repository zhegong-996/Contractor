import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, secrets } from './config.ts';
import { reusable } from './knowledge.ts';
import { triggerAutoCognify } from './cognee-native.ts';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';
import type { L1Projection, L1Reader } from './org-extraction.ts';
import { assertL1Isolated } from './org-extraction.ts';

export const cogneeCommit = '525b1d1179c550cd5b5661bcbf8f00f57a676928';
export class KnowledgeGraph {
  constructor(readonly w: Workspaces) {}
  async source(id: string, actor: WorkspaceActor, taskId?: string) {
    if(actor.userId&&actor.userId!=='local-board'){const {TeamMembers}=await import('./members.ts');const current=await new TeamMembers(this.w).resolve(actor.userId);if(current.agent!==actor.agent||current.admin!==(actor.admin&&!actor.scopedHuman))throw new Error('成员身份或权限已经变化');}
    actor={...actor,admin:actor.admin&&!actor.scopedHuman};
    const source = this.w.source(id);
    if (source.external) throw new Error('飞书原文尚未授权给图谱处理；不会自动复制来源');
    if (!actor.admin&&actor.userId&&!taskId){if(!this.w.members(source.domain).includes(actor.agent!))throw new Error('Unauthorized: library membership');}
    else if (!actor.admin) {
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
    let nativeCognify: { triggered: boolean; dataset?: string; reason?: string } | undefined;
    const before = await this.source(id, actor, taskId);
    if (before.record.revision !== revision) throw new Error('来源版本已变化，请核对当前版本后生成图谱');
    const { TeamMemory } = await import('./team-memory.ts');
    const memory = new TeamMemory(this.w), annotation = await memory.annotations(id,revision), folder = await memory.folder(id,revision);
    const python = runtime('cognee-venv', 'bin', 'python');
    if (!existsSync(python)) throw new Error('Cognee 尚未安装，请运行 npm run setup:graph');
    if (!project && !existsSync(path.join(folder, 'ready.json'))) throw new Error('此版本尚未生成图谱');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const input = { op: project ? 'project' : 'read', ...(project ? { source: { id, revision, title: before.record.value.title,
      body: before.record.value.body, state: before.record.value.state, facts: before.record.value.facts, annotations: annotation } } : {}) };
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
    if ((await memory.annotations(id,revision))?.proof !== annotation?.proof) throw new Error('图谱处理期间概念关系已变化，结果不交付');
    if (after.record.revision !== before.record.revision || after.record.hash !== before.record.hash) throw new Error('图谱处理期间资料或权限已变化，结果不交付');
    if (project) { writeFileSync(path.join(folder, 'ready.json'), JSON.stringify({ sourceId: id, revision, commit: cogneeCommit }), { mode: 0o600 });
      this.w.store.audit('knowledge.graph-projected', id, { revision, engine: 'cognee', nodes: result.nodes.length, edges: result.edges.length, modelCalls: 0 });
      // 第三十四轮（用户拍板费用可接受）：L1 零模型投影成功后，自动把该来源正文
      // cognify 进原生管线（外部 LLM 抽取 + 本机 fastembed）。发后即忘：失败不
      // 阻塞、不回滚投影；成功 / 失败各写一条审计。零模型红线只约束 L1 投影本身。
      nativeCognify = triggerAutoCognify(this.w.config, before.record.value, id, revision,
        (event, sourceId, detail) => this.w.store.audit(event, sourceId, detail));
    }
    return { ...result, sourceId: id, revision, knowledgeState: after.record.value.state, commit: cogneeCommit, sourceHash: after.record.hash, ...(nativeCognify ? { nativeCognify } : {}) };
  }

  /**
   * L2 extraction input. READ-ONLY: reuse the existing `op=read` projection of
   * exactly one source revision. No `project`, no cognify, no embedding, no
   * model call. The isolation assertion is repeated here because a downstream
   * consumer must never receive a mixed-revision graph.
   */
  async readProjection(id: string, revision: string, actor: WorkspaceActor = { admin: true }): Promise<L1Projection> {
    const result = await this.run(id, revision, false, actor);
    if ((result as any)?.error) throw new Error('Cognee 读取失败，L2 抽取已中止');
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    const edges = Array.isArray(result.edges) ? result.edges : [];
    const sourceDoc: any = nodes.find((n: any) => n.type === 'SourceDocument');
    const projection: L1Projection = {
      sourceId: id, revision, title: String(sourceDoc?.name ?? id), body: String(sourceDoc?.body ?? ''),
      modelCalls: Number(result.modelCalls ?? 0),
      nodes: nodes.map((n: any) => ({ id: String(n.id), ...n })),
      edges: edges.map((e: any) => ({ source: String(e.source), target: String(e.target), relation: String(e.relation), ...e })),
    };
    assertL1Isolated(projection, id, revision);
    return projection;
  }
}

/** Adapter boundary for the L2 pipeline: the control plane injects this reader. */
export class CogneeL1Reader implements L1Reader {
  readonly id = 'cognee-l1-read';
  constructor(readonly graph: KnowledgeGraph) {}
  async read(input: { sourceId: string; revision: string }): Promise<L1Projection> {
    return this.graph.readProjection(input.sourceId, input.revision);
  }
}
