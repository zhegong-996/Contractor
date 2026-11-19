import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, runtime } from '../config.ts';
import type { Agent, Project } from './config.ts';
import { digestAgentId, discussionRule, discussionZone } from './discussion.ts';
import { claimWhenAnswered } from './execution-gates.ts';
import { formerName } from './compatibility.ts';
import { assignmentEvent, executionSource, ruleName, workerName, type ExecutionHub } from './execution/contract.ts';
import type { WorkerFactory } from './execution/protocol.ts';
import { executionViews } from './execution/views.ts';

export { assignmentEvent, executionSource, ruleName, workerName } from './execution/contract.ts';

export async function openExecution(agents: Agent[], projects: Project[]) {
  const home = runtime('autoloop');
  process.env.AGENT_AUTOLOOP_HOME = home;
  // Rules are generated from the trusted local runtime registry. Browser clients never supply commands.
  const rulesFile = path.join(home, 'rules.json');
  process.env.AGENT_AUTOLOOP_RULES = rulesFile;
  await mkdir(home, { recursive: true, mode: 0o700 });
  const prior = existsSync(rulesFile) ? JSON.parse(readFileSync(rulesFile, 'utf8')) as { agents?: Record<string, {worker?: string}> } : undefined;
  const formerWorker = formerName(workerName);
  const nativeWorker = Object.values(prior?.agents ?? {}).some(agent => agent.worker === formerWorker) ? formerWorker : workerName;
  const cwd = runtime('execution');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  for (const [id, file] of [['contractor-isolated', 'isolated-adapter.ts'], ['contractor-octop', 'octop-adapter.ts']] as const) {
    const names = nativeWorker === formerWorker ? [id, formerName(id)] : [id];
    for (const name of names) {
      const directory = path.join(home, 'plugins', name);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, 'agent.ts'), 'export { default } from '
        + JSON.stringify(pathToFileURL(path.join(root, 'src/workbench', file)).href) + ';\n', { mode: 0o600 });
    }
  }
  if (agents.some(agent => agent.engine === 'cursor')) {
    const plugins = path.join(home, 'plugins', 'cursor');
    await mkdir(plugins, { recursive: true, mode: 0o700 });
    const adapter = pathToFileURL(path.join(root, 'src/workbench/cursor.ts')).href;
    await writeFile(path.join(plugins, 'agent.ts'), 'export { default } from ' + JSON.stringify(adapter) + ';\n', { mode: 0o600 });
  }
  const digestAgents = projects.flatMap(project => {
    const selected = project.discussion && agents.find(agent => agent.id === project.discussion!.agent);
    return selected ? [{ ...selected, id: digestAgentId(project.id), model: project.discussion!.model ?? selected.model,
      effort: selected.engine === 'codex' ? project.discussion!.effort : undefined }] : [];
  });
  const rules = {
    timezone: discussionZone,
    sources: { [executionSource]: { name: 'Contractor' } },
    agents: Object.fromEntries([...agents.map(a => ({ ...a, effort: undefined })), ...digestAgents].map(a => [a.id, {
      name: a.title, worker: nativeWorker, use: a.engine === 'octop' ? 'contractor-octop' : a.engine, access: 'read', timeout: 8,
      ...(a.model ? { model: a.model } : {}), ...(a.command ? { command: a.command } : {}), ...(a.effort ? { effort: a.effort } : {}),
    }])),
    rules: [...agents.map(a => ({
      name: ruleName(a.id), when: { source: executionSource, types: [assignmentEvent(a.id)] }, to: a.id, cwd,
      prompt: '按工单授权提供专业意见', parallel: 1, tell: 'needed',
    })), ...projects.flatMap(project => project.discussion ? [{
      name: discussionRule(project.id), when: { cron: project.discussion.cron }, to: digestAgentId(project.id), cwd, tell: 'never',
      prompt: '整理经授权的项目群反馈',
    }] : [])],
  };
  await writeFile(path.join(home, 'rules.json'), JSON.stringify(rules), { mode: 0o600 });
  const at = (file: string) => pathToFileURL(path.join(root, 'upstream/autoloop', file)).href;
  const native = await import(at('host/runtime.ts')) as typeof import('../../upstream/autoloop/host/runtime.ts');
  const hub: ExecutionHub = { ...executionViews(native),
    answer: native.answer,
    resolve: native.resolve,
    heartbeat: native.heartbeat,
    cancels: native.cancels,
    cancel: native.cancel,
    started: native.started,
    finish: native.finish,
    tick: native.tick,
    close: () => native.db.close(),
    ingest(source, event) {
      // AutoLoop deduplicates by source and key. Reuse the old source for an event already recorded before the rename.
      const previous = formerName(executionSource);
      const replay = source === executionSource && native.one('SELECT id FROM events WHERE source=? AND key=?', [previous, event.id]);
      return native.ingest(replay ? previous : source, event);
    },
    claimNext: (worker, claim, eligible) => claimWhenAnswered(native, worker, claim, eligible),
    runLease: id => native.getView().get('runs', id) as ReturnType<ExecutionHub['runLease']> };
  const { createWorker } = await import(at('worker/worker.ts')) as typeof import('../../upstream/autoloop/worker/worker.ts');
  const registerAgent = (a: Agent) => {
    rules.agents[a.id] = { name: a.title, worker: nativeWorker, use: 'contractor-octop', access: 'read', timeout: 8, model: a.model };
    rules.rules.push({ name: ruleName(a.id), when: { source: executionSource, types: [assignmentEvent(a.id)] }, to: a.id,
      cwd, prompt: '按工单授权提供专业意见', parallel: 1, tell: 'needed' });
    const file = path.join(home, 'rules.json');
    writeFileSync(file + '.next', JSON.stringify(rules), { mode: 0o600 });
    renameSync(file + '.next', file);
    const status = native.reloadRules();
    if (status.problem) throw new Error('无法注册 Octop 的原生执行规则');
  };
  return { hub, createWorker: createWorker as WorkerFactory, registerAgent, nativeWorker, executionHome: home };
}
