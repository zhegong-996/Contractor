import { key } from '../../upstream/superagent/src/core/index.ts';
import type { ConsoleAuth } from '../console-auth.ts';
import { rbacEnforce } from '../rbac.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { Agent, Project, Settings } from './config.ts';
import { WorkbenchError } from './errors.ts';
import type { ProjectTopic } from './project-resources.ts';
import type { openMemberProfiles } from './member-profile.ts';
import { exportProjectTemplate as buildProjectTemplate, materializeTemplate, type ProjectTemplate } from './project-templates.ts';

export function loadProjectDirectory(store: SuperAgentStore, config: Settings) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_created_project (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_project_member (project TEXT NOT NULL, member TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(project,member));
    CREATE TABLE IF NOT EXISTS workbench_project_maintainers (project TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_project_reader (project TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY(project,member));
    CREATE TABLE IF NOT EXISTS workbench_project_agent (project TEXT NOT NULL, agent TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY(project,agent));
    CREATE TABLE IF NOT EXISTS workbench_project_topic (
      project TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, parent TEXT, PRIMARY KEY(project,id)
    );
  `);
  if (!store.db.prepare('PRAGMA table_info(workbench_project_topic)').all().some(column => column.name === 'parent'))
    store.db.exec('ALTER TABLE workbench_project_topic ADD COLUMN parent TEXT');
  const createdProjects = store.db.prepare('SELECT value FROM workbench_created_project ORDER BY rowid').all()
    .map(row => JSON.parse(String(row.value)) as Project);
  if (!store.db.prepare('PRAGMA table_info(workbench_project_member)').all().some(column => column.name === 'active'))
    store.db.exec('ALTER TABLE workbench_project_member ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  const projectMembers = store.db.prepare('SELECT project,member,active FROM workbench_project_member ORDER BY rowid').all();
  const projectMaintainers = new Map(store.db.prepare('SELECT project,value FROM workbench_project_maintainers').all()
    .map(row => [String(row.project), JSON.parse(String(row.value)) as Project['maintainers']]));
  const projectReaders = new Set(store.db.prepare('SELECT project,member FROM workbench_project_reader').all()
    .map(row => row.project + '/' + row.member));
  const projectAgents = store.db.prepare('SELECT project,agent,owner FROM workbench_project_agent ORDER BY rowid').all();
  const configuredAgentProjects = new Map(config.agents.map(a => [a.id, a.projects]));
  const projects = [...config.projects, ...createdProjects.filter(p => !config.projects.some(existing => existing.id === p.id))].map(project => {
    const members = new Set(project.members);
    for (const row of projectMembers) {
      if (row.project !== project.id) continue;
      if (row.active === 1) members.add(String(row.member));
      else members.delete(String(row.member));
    }
    project.members = [...members];
    project.maintainers = (projectMaintainers.get(project.id) ?? project.maintainers).filter(person => members.has(person));
    return project;
  });
  const loadedConfig = { ...config,
    projects,
    agents: config.agents.map(a => ({ ...a, projects: [...new Set([...a.projects, ...projectAgents.filter(row => row.agent === a.id && row.owner === a.owner)
      .map(row => String(row.project))])] })),
  };
  return { config: loadedConfig, projects, projectReaders, configuredAgentProjects };
}

type ProjectChanges = {
  audit: (id: string, kind: string, data: object) => void;
  memberProfile: ReturnType<typeof openMemberProfiles>['view'];
  accessHours: (project: string) => number;
  withdrawProjectAuthority: (project: Project, member: string) => number[];
  cancelRun: (run: number) => void;
  reconcileProjectDecisions: (project: Project, previous: string, successor: string) => void;
};

export function projectDirectory(store: SuperAgentStore, loaded: ReturnType<typeof loadProjectDirectory>,
  agentById: ReadonlyMap<string, Agent>, auth: Pick<ConsoleAuth, 'listAccounts'>, changes: ProjectChanges) {
  const { config, projects, projectReaders } = loaded;
  const projectById = new Map(projects.map(project => [project.id, project]));
  const { audit, memberProfile, accessHours, withdrawProjectAuthority, cancelRun, reconcileProjectDecisions } = changes;
  const account = (name: string) => auth.listAccounts().find(a => !a.disabled && a.username === name);
  const member = (project: Project | undefined, actor: string) => !!project?.members.includes(actor) && !!account(actor);
  const projectFor = (id: string, actor: string) => {
    const project = projectById.get(id);
    if (!project || !member(project, actor)) throw new WorkbenchError('找不到这个项目。', 404);
    return project;
  };
  const maintain = (p: Project, actor: string) => p.maintainers.includes(actor) && mayStart(p, actor);
  const platformRight = (actor: string, permission: 'project-create' | 'platform-quota-admin' | 'workspace-members-admin' | 'accounts-manage' | 'services-control') =>
    !!account(actor) && rbacEnforce('user:' + actor, permission);
  const canManageAccounts = (actor: string) => platformRight(actor, 'accounts-manage') || platformRight(actor, 'workspace-members-admin');
  const projectReaderKey = (project: string, person: string) => project + '/' + person;
  const isProjectReader = (project: string, person: string) => projectReaders.has(projectReaderKey(project, person));
  const mayStart = (p: Project, actor: string) =>
    member(p, actor) && !projectReaders.has(projectReaderKey(p.id, actor)) && rbacEnforce('user:' + actor, 'task-control');
  function createProject(actor: string, input: { nonce: string; title: string; parent?: string; firstTopic?: string; template?: ProjectTemplate }) {
    if (input.parent && !maintain(projectFor(input.parent, actor), actor)) throw new WorkbenchError('由上级项目维护人建立子项目。', 403);
    if (!input.parent && !platformRight(actor, 'project-create')) throw new WorkbenchError('当前账号没有创建独立项目的权限。', 403);
    const id = 'project-' + key('project-create', actor, input.nonce);
    const first = input.firstTopic ? { id: 'topic-' + key('first-topic', id).slice(0, 12), title: input.firstTopic } : undefined;
    const imported = input.template ? materializeTemplate(input.template, actor, new Set(agentById.keys()), id) : undefined;
    const prior = projectById.get(id);
    if (prior) {
      if (prior.title !== input.title || prior.parent !== input.parent
        || prior.topics[0]?.title !== (imported?.topics[0]?.title ?? input.firstTopic))
        throw new WorkbenchError('这次项目创建请求已被使用。', 409);
      return { id, topic: imported?.topics[0]?.id ?? first?.id };
    }
    const project: Project = { id, title: input.title, parent: input.parent, members: [actor], maintainers: [actor],
      relatedProjects: [], delegations: [], dispatch: [], responsibilities: [],
      topics: imported?.topics.length ? imported.topics : first ? [first] : [], resources: [],
      goals: imported?.goals ?? [], routines: imported?.routines ?? [],
      ...(imported?.trigger ? { trigger: imported.trigger } : {}),
      ...(imported?.approvals ? { approvals: imported.approvals } : {}),
      ...(imported?.modelRoutes ? { modelRoutes: imported.modelRoutes } : {}) };
    store.atomic(() => {
      store.db.prepare('INSERT INTO workbench_created_project VALUES (?,?)').run(id, JSON.stringify(project));
      audit(id, 'project.created', { actor, parent: input.parent, fromTemplate: !!input.template });
      if (first) audit(id, 'topic.created', { actor, topic: first.id });
      for (const topic of project.topics.slice(first ? 1 : 0)) audit(id, 'topic.created', { actor, topic: topic.id, fromTemplate: true });
    });
    projectById.set(id, project);
    config.projects.push(project);
    return { id, topic: project.topics[0]?.id };
  }

  function exportProjectTemplate(actor: string, id: string) {
    const project = projectFor(id, actor);
    return buildProjectTemplate(project);
  }

  function addProjectMember(actor: string, id: string, person: string, role: 'collaborator' | 'reader' = 'collaborator') {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人添加成员。', 403);
    if (!account(person)) throw new WorkbenchError('找不到已启用的工作台账号。', 404);
    if (project.members.includes(person)) return;
    store.atomic(() => {
      store.db.prepare(`INSERT INTO workbench_project_member(project,member,active) VALUES (?,?,1)
        ON CONFLICT(project,member) DO UPDATE SET active=1`).run(id, person);
      if (role === 'reader') store.db.prepare('INSERT OR IGNORE INTO workbench_project_reader VALUES (?,?)').run(id, person);
      audit(id, 'project.member-added', { actor, member: person, role });
    });
    if (role === 'reader') projectReaders.add(projectReaderKey(id, person));
    project.members.push(person);
  }

  function removeProjectMember(actor: string, id: string, person: string) {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人移除成员。', 403);
    if (!project.members.includes(person)) return;
    if (project.maintainers.includes(person)) throw new WorkbenchError('请先完成维护人交接，再移除该成员。', 409);
    const previous = project.members;
    project.members = previous.filter(name => name !== person);
    let cancellations: number[];
    try {
      cancellations = store.atomic(() => {
        store.db.prepare(`INSERT INTO workbench_project_member(project,member,active) VALUES (?,?,0)
          ON CONFLICT(project,member) DO UPDATE SET active=0`).run(id, person);
        store.db.prepare('DELETE FROM workbench_project_reader WHERE project=? AND member=?').run(id, person);
        audit(id, 'project.member-removed', { actor, member: person });
        return withdrawProjectAuthority(project, person);
      });
    } catch (error) {
      project.members = previous;
      throw error;
    }
    projectReaders.delete(projectReaderKey(id, person));
    for (const run of cancellations) cancelRun(run);
  }

  function setProjectMemberRole(actor: string, id: string, person: string, role: 'collaborator' | 'reader') {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人调整成员权限。', 403);
    if (!member(project, person)) throw new WorkbenchError('找不到在岗项目成员。', 404);
    if (project.maintainers.includes(person)) throw new WorkbenchError('请先交接项目维护权限。', 409);
    const key = projectReaderKey(id, person);
    if (projectReaders.has(key) === (role === 'reader')) return;
    if (role === 'collaborator' && !rbacEnforce('user:' + person, 'task-control'))
      throw new WorkbenchError('该账号的平台角色只允许阅读。', 409);
    if (role === 'reader') projectReaders.add(key);
    else projectReaders.delete(key);
    let cancellations: number[];
    try {
      cancellations = store.atomic(() => {
        if (role === 'reader') store.db.prepare('INSERT INTO workbench_project_reader VALUES (?,?)').run(id, person);
        else store.db.prepare('DELETE FROM workbench_project_reader WHERE project=? AND member=?').run(id, person);
        audit(id, 'project.member-role-changed', { actor, member: person, role });
        return role === 'reader' ? withdrawProjectAuthority(project, person) : [];
      });
    } catch (error) {
      if (role === 'reader') projectReaders.delete(key);
      else projectReaders.add(key);
      throw error;
    }
    for (const run of cancellations) cancelRun(run);
  }

  function guardAccountWithdrawal(person: string) {
    if (projects.some(project => maintain(project, person) && !project.maintainers.some(other => other !== person && maintain(project, other))))
      throw new WorkbenchError('该账号仍是某项目唯一在岗维护人，请先完成项目交接。', 409);
  }

  function projectAccess(actor: string, id: string) {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人查看权限设置。', 403);
    const roles = project.members.map(name => ({
      name, ...memberProfile(account(name)), enabled: !!account(name), maintainer: project.maintainers.includes(name),
      canTransferTo: name !== actor && mayStart(project, name),
      role: projectReaders.has(projectReaderKey(id, name)) ? 'reader' as const : 'collaborator' as const,
      effective: maintain(project, name) ? 'maintainer' as const : mayStart(project, name) ? 'collaborator' as const : 'reader' as const,
      platformReadOnly: !rbacEnforce('user:' + name, 'task-control'),
    }));
    const available = auth.listAccounts().filter(row => !row.disabled && !project.members.includes(row.username))
      .map(row => ({ name: row.username, displayName: memberProfile(row).displayName, platformReadOnly: !rbacEnforce('user:' + row.username, 'task-control') }));
    const changes = store.db.prepare(`SELECT at,kind,value FROM workbench_audit WHERE ticket=?
      AND kind IN ('project.member-added','project.member-removed','project.member-role-changed','project.maintainer-transferred','knowledge.access-policy-changed','project.routing-changed')
      ORDER BY id DESC LIMIT 30`).all(id).map(row => {
      const { actor, member, role, to, hours } = JSON.parse(String(row.value)) as { actor: string; member?: string; role?: string; to?: string; hours?: number };
      return { at: String(row.at), kind: String(row.kind), actor, member, role, to, hours };
    });
    return { roles, available, changes, knowledgeAccessHours: accessHours(id) };
  }

  function withdrawAccountAuthority(person: string) {
    const cancellations = store.atomic(() => projects.filter(project => project.members.includes(person))
      .flatMap(project => withdrawProjectAuthority(project, person)));
    for (const run of cancellations) cancelRun(run);
  }

  function transferProjectMaintainer(actor: string, id: string, to: string) {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由现任项目维护人交接自己的维护权限。', 403);
    if (actor === to || !mayStart(project, to)) throw new WorkbenchError('请选择有协作权限的另一位在岗项目成员。', 409);
    const previous = project.maintainers;
    const next = [...new Set(previous.map(person => person === actor ? to : person))];
    project.maintainers = next;
    try {
      store.atomic(() => {
        store.db.prepare('INSERT OR REPLACE INTO workbench_project_maintainers VALUES (?,?)').run(id, JSON.stringify(next));
        audit(id, 'project.maintainer-transferred', { actor, to });
        reconcileProjectDecisions(project, actor, to);
      });
    } catch (error) {
      project.maintainers = previous;
      throw error;
    }
  }

  function addProjectAgent(actor: string, id: string, agentId: string) {
    const project = projectFor(id, actor);
    const agent = agentById.get(agentId);
    if (!agent || agent.owner !== actor || !mayStart(project, actor))
      throw new WorkbenchError('由 Agent 所有者将自己的 Agent 加入项目。', 403);
    if (agent.projects.includes(id)) return;
    if (agent.engine === 'octop') throw new WorkbenchError('共享专家及模板只在其授权项目使用。', 403);
    store.atomic(() => {
      store.db.prepare('INSERT INTO workbench_project_agent VALUES (?,?,?)').run(id, agentId, actor);
      audit(id, 'project.agent-added', { actor, agent: agentId });
    });
    agent.projects.push(id);
  }

  const topicsFor = (project: Project): ProjectTopic[] => [...project.topics,
    ...store.db.prepare('SELECT id,title,parent FROM workbench_project_topic WHERE project=? ORDER BY rowid').all(project.id)
      .filter(topic => !project.topics.some(item => item.id === topic.id))
      .map(row => ({ id: String(row.id), title: String(row.title), parent: typeof row.parent === 'string' ? row.parent : undefined }))];

  function createTopic(actor: string, id: string, input: ProjectTopic) {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人建立主题。', 403);
    store.atomic(() => {
      const topics = topicsFor(project);
      const prior = topics.find(topic => topic.id === input.id);
      if (prior?.title === input.title && prior.parent === input.parent) return;
      if (prior) throw new WorkbenchError('该主题标识已使用。', 409);
      if (input.parent && !topics.some(topic => topic.id === input.parent && !topic.parent))
        throw new WorkbenchError('请选择当前项目的一级主题。', 400);
      store.db.prepare('INSERT INTO workbench_project_topic VALUES (?,?,?,?)').run(id, input.id, input.title, input.parent ?? null);
      audit(id, 'topic.created', { actor, topic: input.id });
    });
  }

  return { projectById, account, member, mayStart, maintain, platformRight, canManageAccounts, projectFor, createProject, exportProjectTemplate, addProjectMember,
    removeProjectMember, setProjectMemberRole, guardAccountWithdrawal, projectAccess, withdrawAccountAuthority,
    transferProjectMaintainer, addProjectAgent, topicsFor, createTopic, isProjectReader };
}
