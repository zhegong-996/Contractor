import { ArrowLeft, BookOpen, Bot, ChevronRight, ListChecks, MessageSquare, PanelRight, Plus, Radio } from 'lucide-react';
import { part, useData, useTickets, type TopicRule } from './api.ts';
import { Conversation } from './conversation.tsx';
import { forest, type Branch } from './hierarchy.ts';
import { routeFor, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Avatar, Empty, Failure, Pill, Source, TicketStatus, useSessionScroll, useStored } from './ui.tsx';

type Topic = PageProps['project']['topics'][number];
type Channels = { feishuReady: boolean; im: { connector: string; kind: string; topics: string[]; ready: boolean }[] };

export function ChatPage(props: PageProps) {
  const { project, workspace, route, openTask } = props;
  const selected = project.topics.find(topic => topic.id === route.item);
  const people = workspace.agents.filter(agent => selected?.consultants.includes(agent.id) && agent.active);
  const [showDetails, setDetails] = useStored('chat-context:' + project.id, window.matchMedia('(min-width: 1280px)').matches);
  const tasks = useTickets({ project: project.id, topic: selected?.id, purpose: 'work', limit: 8 }, showDetails, 5000).rows;
  const listScroll = useSessionScroll('chat-topics:' + project.id, { visibleAt: route.item ?? route.tab });
  const connected = useData<Channels>('project/' + project.id + '/channels', 5000);
  const rules = useData<TopicRule[]>(selected ? 'project/' + part(project.id) + '/topic-rules/' + part(selected.id) : '', 8000);
  const feishu = project.resources.some(resource => resource.source === 'feishu' && resource.state === 'bound');
  const github = project.resources.some(resource => resource.source === 'github' && resource.state === 'bound' && resource.purpose !== 'reference');
  const im = connected.data?.im.filter(item => !selected || item.topics.includes(selected.id));
  return <div className="split chat-split" data-has-detail={!!route.item || route.tab === 'project'}>
    <aside className="split-list" aria-label="项目会话">
      <div className="list-header"><h1>对话</h1></div>
      <div className="list-scroll" {...listScroll}>
        <a className="chat-thread" href={routeFor(project.id, 'chat', undefined, 'project')} aria-current={!route.item ? 'page' : undefined}>
          <MessageSquare size={17} /><span>项目讨论</span></a>
        {forest(project.topics, topic => topic.parent).map(branch => <TopicBranch key={branch.item.id} branch={branch} project={project.id} current={route.item} />)}
      </div>
    </aside>
    <div className="split-detail chat-detail">
      <header className="chat-heading">
        <div className="chat-heading-title">
          <a className="chat-back" href={routeFor(project.id, 'chat')} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={17} /></a>
          <div className="chat-heading-icon" aria-hidden="true"><MessageSquare size={18} /></div>
          <h1>{selected?.title ?? '项目讨论'}</h1>
        </div>
        <div className="actions">
          <Button size="sm" variant="ghost" className="context-toggle" aria-expanded={showDetails} aria-controls="chat-context"
            aria-label={showDetails ? '收起上下文' : '查看上下文'} title={showDetails ? '收起上下文' : '查看上下文'}
            onClick={() => setDetails(!showDetails)}><PanelRight /><span>上下文</span></Button>
          {project.mayStart && <Button size="sm" onClick={() => openTask({ topic: selected?.id })}><Plus />新建工单</Button>}
        </div>
      </header>
      {route.item && !selected ? <Empty title="这个主题当前不可见" /> : <div className="chat-content" data-context={showDetails || undefined}>
        <Conversation key={selected?.id ?? 'project'} {...props} topic={selected?.id} desk />
        {showDetails && <aside id="chat-context" className="chat-context" aria-label="讨论上下文">
          <section><h2><Radio size={16} />来源</h2>
            <div className="record-row"><Source channel="web" /></div>
            {feishu && <div className="record-row"><Source channel="feishu" />{connected.data && <Pill tone={connected.data.feishuReady ? 'green' : 'amber'}>{connected.data.feishuReady ? '入口在线' : '入口未就绪'}</Pill>}</div>}
            {github && <div className="record-row"><Source channel="github" /><a href={routeFor(project.id, 'project', undefined, 'sources')}>仓库连接</a></div>}
            {im?.map(item => <div className="record-row" key={item.connector}><Source channel={item.kind} />
              <Pill tone={item.ready ? 'green' : 'amber'}>{item.ready ? '在线' : '未就绪'}</Pill></div>)}
            {project.discussion && <div className="record-row"><a href={routeFor(project.id, 'project', undefined, 'discussion')}>查看已归纳群反馈</a></div>}
            {connected.error && <Failure error={connected.error} retry={() => void connected.refetch()} />}
            <a className="text-button" href={routeFor(project.id, 'project', undefined, 'sources')}>资料与连接 <ChevronRight size={15} /></a>
          </section>
          <section><h2><Bot size={16} />可咨询 Agent</h2>
            {people.length ? people.map(agent => <a className="chat-context-link" key={agent.id}
              href={routeFor(project.id, 'agents', agent.id)}><Avatar kind="agent" value={agent.title} /><span>{agent.title}</span></a>)
              : <p className="muted-text">{selected ? '此主题暂无已授权的咨询 Agent' : '选择主题查看可咨询的 Agent'}</p>}
          </section>
          <section><h2><ListChecks size={16} />{selected ? '主题工单' : '近期工单'}</h2>
            {tasks.slice(0, 8).map(item => <a className="chat-context-link" key={item.id} href={routeFor(project.id, 'work', item.id)}>
              <span>{item.title}</span><TicketStatus ticket={item} />
            </a>)}
            {!tasks.length && <p className="muted-text">暂无工单</p>}
            <a className="text-button" href={routeFor(project.id, 'work')}>项目任务 <ChevronRight size={15} /></a>
          </section>
          {rules.data && rules.data.length > 0 && <section><h2><BookOpen size={16} />已采用的验收知识</h2>
            {rules.data.map(rule => <a className="chat-context-link" href={routeFor(project.id, 'knowledge', rule.id, 'current')} key={rule.id}>{rule.title}</a>)}
          </section>}
          <a className="text-button" href={routeFor(project.id, 'knowledge', undefined, 'activity')}><BookOpen size={16} />项目知识</a>
        </aside>}
      </div>}
    </div>
  </div>;
}

function TopicBranch({ branch, project, current }: { branch: Branch<Topic>; project: string; current?: string }) {
  const { item, children } = branch;
  const [open, setOpen] = useStored('topic-branch:' + project + ':' + item.id, true);
  return <div>
    <div className="chat-thread-row">
      {children.length > 0 && <button className="tree-toggle" type="button" aria-expanded={open}
        aria-label={(open ? '收起' : '展开') + item.title + '的子主题'} onClick={() => setOpen(!open)}>
        <ChevronRight size={15} className={open ? 'tree-open' : undefined} /></button>}
      <a className="chat-thread" href={routeFor(project, 'chat', item.id)} aria-current={item.id === current ? 'page' : undefined}>
        <MessageSquare size={16} /><span>{item.title}</span>
      </a>
    </div>
    {open && children.length > 0 && <div className="project-tree-children">{children.map(child =>
      <TopicBranch key={child.item.id} branch={child} project={project} current={current} />)}</div>}
  </div>;
}
