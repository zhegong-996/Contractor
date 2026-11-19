import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../../config.ts';
import type { Agent, Project } from '../config.ts';
import { digestAgentId, discussionRule } from '../discussion.ts';
import { assignmentEvent, executionSource, ruleName, workerName, type ExecutionDriver } from './contract.ts';
import { openScheduler, type ExecutionRule } from './scheduler.ts';
import { workerFactory } from './worker.ts';

export function pinExecutionDirectory(driver: ExecutionDriver) {
  const current = runtime('execution-driver');
  if (driver === 'autoloop') {
    if (existsSync(current) || existsSync(runtime('dispatch', 'hub.sqlite')))
      throw new Error('不能在自研调度数据目录启动旧调度器');
    return;
  }
  if (!process.env.COLLAB_STATE_DIR || !path.isAbsolute(process.env.COLLAB_STATE_DIR)
    || path.resolve(runtime()) === path.join(root, '.runtime'))
    throw new Error('自研调度器需要指定独立的 COLLAB_STATE_DIR');
  if (existsSync(runtime('autoloop', 'hub.db')) || !existsSync(current) && existsSync(runtime('orchestrator.sqlite')))
    throw new Error('两种调度器必须使用独立数据目录');
  mkdirSync(runtime(), { mode: 0o700, recursive: true });
  try { writeFileSync(current, driver, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (readFileSync(current, 'utf8') !== driver) throw new Error('执行数据目录与调度器不一致');
}

export async function openExecution(driver: ExecutionDriver, agents: Agent[], projects: Project[]) {
  pinExecutionDirectory(driver);
  if (driver === 'autoloop') {
    const legacy = await import('../autoloop.ts');
    return legacy.openExecution(agents, projects);
  }
  const executionHome = runtime('dispatch');
  const cwd = runtime('execution');
  mkdirSync(executionHome, { mode: 0o700, recursive: true });
  mkdirSync(cwd, { mode: 0o700, recursive: true });
  function assignment(agent: Agent): ExecutionRule {
    return {
      agent: { id: agent.id, name: agent.title, use: agent.engine === 'octop' ? 'contractor-octop' : agent.engine,
        model: agent.model, command: agent.command, access: 'read', timeout: 8 },
      rule: { name: ruleName(agent.id), cwd, prompt: '按工单授权提供专业意见' },
      source: executionSource, type: assignmentEvent(agent.id),
    };
  }
  const periodic = projects.flatMap(project => {
    const settings = project.discussion;
    const agent = settings && agents.find(agent => agent.id === settings.agent);
    if (!settings || !agent) return [];
    const spec = assignment(agent);
    return [{ ...spec, cron: settings.cron, rule: { ...spec.rule, name: discussionRule(project.id), prompt: '整理经授权的项目群反馈' },
      agent: { ...spec.agent, id: digestAgentId(project.id), model: settings.model ?? agent.model, effort: settings.effort } }];
  });
  const { hub, register } = openScheduler(path.join(executionHome, 'hub.sqlite'), [...agents.map(assignment), ...periodic]);
  return { hub, createWorker: workerFactory(executionHome), registerAgent: (agent: Agent) => register(assignment(agent)),
    nativeWorker: workerName, executionHome };
}
