import { Bot, Copy, Layers, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, uid, useData, type AgentResources } from './api.ts';
import { go, routeFor, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { Avatar, Empty, Failure, Field, Loading, Modal, Pill, Section, short, useActions } from './ui.tsx';

type Skill = AgentResources['skills'][number];
type Expert = AgentResources['experts'][number];
type Dialog =
  | { kind: 'create' }
  | { kind: 'skill'; previous?: Skill }
  | { kind: 'share'; resource: Skill | Expert }
  | { kind: 'mount'; skill: Skill }
  | { kind: 'clone'; expert: Expert }
  | { kind: 'publish'; expert: Expert };

export function AgentLibrary({ project, workspace }: PageProps) {
  const path = 'octop/' + project.id;
  const data = useData<AgentResources>(path);
  const [dialog, setDialog] = useState<Dialog>();
  const { run, busy } = useActions();
  const close = () => setDialog(undefined);
  const owned = data.data?.experts.filter(expert => expert.owner === workspace.actor) ?? [];
  const latest = [...new Map(data.data?.skills.slice().reverse().map(skill => [skill.id, skill])).values()];
  return <div className="page-scroll"><div className="project-page agent-library">
    <header className="object-header"><div className="object-emblem"><Layers size={22} /></div>
      <div><h1>专家与技能</h1><p className="muted-text">{project.title}</p></div>
      <div className="actions object-action">
        <a className="text-button" href={routeFor(project.id, 'agents')}>Agent 列表</a>
        {project.mayStart && <Button onClick={() => setDialog({ kind: 'create' })}><Plus />新建专家</Button>}
      </div>
    </header>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading /> : <div className="detail-stack">
      <Section title="项目专家">
        {data.data.experts.length ? <div className="agent-cards">{data.data.experts.map(expert => <article className="agent-card" key={expert.id}>
          <div className="agent-card-top"><Avatar value={expert.title} kind="agent" /><Pill tone={expert.active ? 'green' : 'neutral'}>{expert.active ? '可委托' : '未就绪'}</Pill></div>
          <h2><a href={routeFor(project.id, 'agents', expert.id)}>{expert.title}</a></h2>
          <p>{expert.capability}</p><div className="record-row"><span>{expert.owner}</span>
            {expert.template && <span>模板 <code>{short(expert.template.revision)}</code></span>}</div>
          {expert.mounts?.length ? <div className="expert-mounts" aria-label="已挂载技能">{expert.mounts.map(ref => {
            const skill = data.data?.skills.find(item => item.id === ref.id && item.revision === ref.revision);
            return <div className="record-row" key={ref.id}><span>{skill?.title ?? '授权已变化的技能'}</span><code>{short(ref.revision)}</code>
              <Button type="button" variant="ghost" size="sm" disabled={busy || !project.mayStart}
                onClick={() => void run(() => api(path + '/mount', { agent: expert.id, skill: ref, active: false }), '已卸载技能')}>卸载</Button>
            </div>;
          })}</div> : null}
          <div className="actions">
            {expert.mayShare && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'share', resource: expert })}><Link2 />共享</Button>}
            {expert.owner === workspace.actor && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'publish', expert })}>发布模板</Button>}
            {expert.template && project.mayStart && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'clone', expert })}><Copy />复制模板</Button>}
          </div>
        </article>)}</div> : <Empty title="还没有可查看的项目专家" icon={<Bot />} />}
      </Section>
      <Section title="技能" action={project.mayStart && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'skill' })}><Plus />发布技能</Button>}>
        {latest.length ? latest.map(skill => <article className="revision-note" key={skill.id}>
          <div className="record-row"><strong>{skill.title}</strong><span>{skill.owner}</span>
            <span>现行版本 <code>{short(skill.revision)}</code></span></div>
          <div className="actions">
            {!!owned.length && project.mayStart && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'mount', skill })}>挂载技能</Button>}
            {skill.mayShare && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'share', resource: skill })}>共享</Button>}
            {skill.owner === workspace.actor && project.mayStart && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'skill', previous: skill })}>发布下一版</Button>}
          </div>
          {data.data!.skills.some(item => item.id === skill.id && item.revision !== skill.revision) && <details className="minor-disclosure">
            <summary>技能版本</summary>{data.data!.skills.filter(item => item.id === skill.id).map(item =>
              <div className="record-row" key={item.revision}><code>{short(item.revision, 16)}</code><span>{item.title}</span>
                {!!owned.length && project.mayStart && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'mount', skill: item })}>挂载此版本</Button>}
              </div>)}
          </details>}
        </article>) : <Empty title="还没有可用的项目技能" icon={<Layers />} />}
      </Section>
    </div>}
    {dialog && <LibraryDialog key={dialog.kind} dialog={dialog} project={project} workspace={workspace} owned={owned} close={close} />}
  </div></div>;
}

function LibraryDialog({ dialog, project, workspace, owned, close }: {
  dialog: Dialog; project: PageProps['project']; workspace: PageProps['workspace']; owned: Expert[]; close: () => void;
}) {
  const { run, busy } = useActions();
  const [nonce] = useState(uid);
  const [member, setMember] = useState('');
  const members = dialog.kind === 'share' ? project.members.filter(person => person.name !== dialog.resource.owner) : [];
  const sharing = dialog.kind === 'share' && dialog.resource.sharedWith?.includes(member);
  const title = ({
    create: '新建只读专家', skill: '发布技能版本', share: '管理共享', mount: '挂载技能',
    clone: '复制为我的专家', publish: '发布专家模板',
  })[dialog.kind];
  return <Modal title={title} close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const path = 'octop/' + project.id;
    let action;
    if (dialog.kind === 'create') {
      action = await run(() => api<{ id: string; active: boolean }>(path + '/expert', { nonce, spec: {
        title: values.get('title'), function: values.get('function'), capability: values.get('capability'), instructions: values.get('instructions'),
      } }), '已创建专家');
      if (action) go(project.id, 'agents', action.id);
    } else if (dialog.kind === 'skill') {
      const slug = String(values.get('slug')), title = String(values.get('title')).trim();
      const markdown = '---\nname: ' + slug + '\ndescription: ' + JSON.stringify(title) + '\n---\n\n' + values.get('body');
      action = await run(() => api(path + '/skill', { slug, title, markdown }), '已发布技能版本');
    } else if (dialog.kind === 'share') {
      action = await run(() => api(path + '/share', { id: dialog.resource.id, member, active: !sharing }), sharing ? '已撤销共享' : '已共享');
    } else if (dialog.kind === 'mount') {
      action = await run(() => api(path + '/mount', { agent: values.get('agent'), skill: { id: dialog.skill.id, revision: dialog.skill.revision }, active: true }), '已挂载技能版本');
    } else if (dialog.kind === 'clone') {
      action = await run(() => api<{ id: string }>(path + '/clone', { nonce, title: values.get('title'), agent: dialog.expert.id,
        revision: dialog.expert.template?.revision }), '已复制专家');
      if (action) go(project.id, 'agents', action.id);
    } else {
      action = await run(() => api(path + '/template', { agent: dialog.expert.id, kind: values.get('kind') }), '已发布模板');
    }
    if (action) close();
  }}>
    {dialog.kind === 'create' && <>
      <Field label="名称"><Input name="title" required maxLength={100} /></Field>
      <Field label="职责"><select name="function" required>{workspace.functions.map(fn => <option value={fn.id} key={fn.id}>{fn.title}</option>)}</select></Field>
      <Field label="擅长处理"><Input name="capability" required maxLength={400} /></Field>
      <Field label="执行说明"><TextArea name="instructions" required rows={4} maxLength={5000} /></Field>
      <p className="muted-text">委托仍按项目及资料权限执行。没有个人模型配置时，新专家会保留为未就绪。</p>
    </>}
    {dialog.kind === 'skill' && <>
      <Field label="技能名称"><Input name="title" required maxLength={100} defaultValue={dialog.previous?.title} /></Field>
      <Field label="技能标识"><Input name="slug" required pattern="[a-z][a-z0-9\-]{0,47}" defaultValue={dialog.previous?.slug} readOnly={!!dialog.previous} /></Field>
      <Field label="技能正文"><TextArea name="body" required rows={5} maxLength={5500} /></Field>
    </>}
    {dialog.kind === 'share' && <>
      <p>{dialog.resource.title}</p>
      <Field label="项目成员"><select value={member} required onChange={event => setMember(event.target.value)}>
        <option value="">选择成员</option>{members.map(person => <option key={person.name} value={person.name}>
          {person.name}{dialog.resource.sharedWith?.includes(person.name) ? ' · 已共享' : ''}
        </option>)}
      </select></Field>
      {sharing && <p className="muted-text">撤权会阻止该成员继续使用此资源及依赖其授权的专家。</p>}
    </>}
    {dialog.kind === 'mount' && <>
      <p>{dialog.skill.title} · <code>{short(dialog.skill.revision, 12)}</code></p>
      <Field label="我的专家"><select required name="agent">{owned.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></Field>
    </>}
    {dialog.kind === 'clone' && <Field label="我的专家名称"><Input name="title" required maxLength={100} defaultValue={dialog.expert.title + ' · 副本'} /></Field>}
    {dialog.kind === 'publish' && <>
      <Field label="模板类型"><select name="kind"><option value="expert">专家模板</option><option value="subagent">子 Agent 模板</option></select></Field>
      <p className="muted-text">模板包含职责、执行说明和挂载的技能版本。已获专家和对应技能权限的项目成员可复制。</p>
    </>}
    <div className="form-actions"><Button type="submit" disabled={busy || dialog.kind === 'share' && !member}>
      {dialog.kind === 'share' ? sharing ? '撤销共享' : '共享给此成员' : title}
    </Button></div>
  </form></Modal>;
}
