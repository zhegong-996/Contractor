import { ArrowLeft, BookOpen, Bot, ChevronRight, ListChecks, MessageSquare, PanelRight, Plus, Radio } from 'lucide-react';
import { part, useData, useTickets, type ProjectChannels, type TopicRule } from './api.ts';
import { Conversation } from './conversation.tsx';
import { ConversationDirectory } from './conversation-directory.tsx';
import { projectWorkRoute, routeFor, withConversationOrigin, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Avatar, Empty, Ext, Failure, Pill, short, Source, TicketStatus, useStored } from './ui.tsx';

export function ChatPage(props: PageProps) {
  const { project, workspace, route, openTask } = props;
  const hasDetail = !!route.item || route.tab === 'project';
  const selected = project.topics.find(topic => topic.id === route.item);
  const people = workspace.agents.filter(agent => selected?.consultants.includes(agent.id) && agent.active);
  const [showDetails, setDetails] = useStored('chat-context:' + project.id, window.matchMedia('(min-width: 1280px)').matches);
  const tasks = useTickets({ project: project.id, topic: selected?.id, purpose: 'work', limit: 8 }, hasDetail && showDetails, 5000).rows;
  const connected = useData<ProjectChannels>(hasDetail && showDetails ? 'project/' + project.id + '/channels' : '', 5000);
  const rules = useData<TopicRule[]>(selected ? 'project/' + part(project.id) + '/topic-rules/' + part(selected.id) : '', 8000);
  const feishu = project.resources.some(resource => resource.source === 'feishu' && resource.state === 'bound');
  const github = project.resources.some(resource => resource.source === 'github' && resource.state === 'bound' && resource.purpose !== 'reference');
  const im = connected.data?.im.filter(item => !selected || item.topics.includes(selected.id));
  return <div className="split chat-split" data-has-detail={hasDetail}>
    <ConversationDirectory {...props} />
    <div className="split-detail chat-detail">{!hasDetail ? <Empty title="选择一个会话" icon={<MessageSquare />} /> : <>
      <header className="chat-heading">
        <div className="chat-heading-title">
          <a className="chat-back" href={routeFor(project.id, 'chat')} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={17} /></a>
          <div className="chat-heading-icon" aria-hidden="true"><MessageSquare size={18} /></div>
          <h1>{selected?.title ?? '项目讨论'}</h1>
        </div>
        <div className="actions">
          <a className="chat-work-link" href={projectWorkRoute(project.id, selected?.id)} aria-label={selected ? '查看主题工单' : '查看项目工单'}><ListChecks size={17} /><span>工单</span></a>
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
            {connected.data?.feishuTopics.mappings.filter(row => row.topic === selected?.id).map(row =>
              <div className="record-row" key={row.chat + row.root}><Ext href={row.url}>飞书原话题</Ext></div>)}
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
          <section><h2><ListChecks size={16} />{selected ? '交付工单' : '近期交付工单'}</h2>
            {tasks.slice(0, 8).map(item => <a className="chat-context-link" key={item.id}
              href={withConversationOrigin(routeFor(project.id, 'work', item.id), route)}>
              <span><code title={item.id}>{short(item.id)}</code> {item.title}</span><TicketStatus ticket={item} />
            </a>)}
            {!tasks.length && <p className="muted-text">暂无交付工单</p>}
          </section>
          {rules.data && rules.data.length > 0 && <section><h2><BookOpen size={16} />已采用的验收知识</h2>
            {rules.data.map(rule => <a className="chat-context-link" href={routeFor(project.id, 'knowledge', rule.id, 'current')} key={rule.id}>{rule.title}</a>)}
          </section>}
          <a className="text-button" href={routeFor(project.id, 'knowledge', undefined, 'activity')}><BookOpen size={16} />项目知识</a>
        </aside>}
      </div>}
    </>}</div>
  </div>;
}
