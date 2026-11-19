import { ArrowDown, ArrowLeft, ArrowUp, Network } from 'lucide-react';
import { useData, type KnowledgeGraph } from './api.ts';
import { go, routeFor } from './navigation.ts';
import { Empty, Ext, Failure, Loading, Pill, Section, short } from './ui.tsx';

type Node = KnowledgeGraph['nodes'][number];
type Edge = KnowledgeGraph['edges'][number];

const kinds: Record<Node['kind'], string> = {
  project: '项目', knowledge: '知识', resource: '资料', ticket: '工单', agent: 'Agent', member: '成员',
};

const state: Record<string, string> = {
  candidate: '待确认', published: '已采用', invalidated: '已失效', superseded: '已替代',
};

function relationship(edge: Edge, direction: 'in' | 'out', other: Node) {
  switch (edge.type) {
    case 'derivedFrom': return direction === 'out' ? '来源工单' : '沉淀为';
    case 'dependsOn': return direction === 'out' ? '引用的依据' : other.kind === 'ticket' ? '被工单使用' : '被知识引用';
    case 'supersedes': return direction === 'out' ? '替代的版本' : '替代它的版本';
    case 'ownedBy': return direction === 'out' ? '负责人' : '负责';
    case 'partOf': return direction === 'out' ? '所属项目' : '包含';
    case 'executes': return direction === 'out' ? '执行工单' : '由 Agent 执行';
    default: return edge.type;
  }
}

function nodeRoute(project: string, node: Node) {
  if (node.kind === 'project') return routeFor(project, 'project');
  if (!node.objectId) return;
  if (node.kind === 'knowledge') return routeFor(project, 'knowledge', node.objectId,
    node.state === 'candidate' ? 'review' : node.state === 'superseded' || node.state === 'invalidated' ? 'history' : 'current');
  if (node.kind === 'ticket') return routeFor(project, 'work', node.objectId, 'delivery');
  if (node.kind === 'agent') return routeFor(project, 'agents', node.objectId);
}

export function KnowledgeRelations({ project, entry }: { project: string; entry?: string }) {
  const graph = useData<KnowledgeGraph>('project/' + project + '/knowledge-graph', 8000);
  const known = graph.data?.nodes.filter(node => node.kind === 'knowledge' && node.objectId) ?? [];
  const requested = known.find(node => node.objectId === entry);
  const center = requested ?? (!entry ? known[0] : undefined);
  const nodes = new Map(graph.data?.nodes.map(node => [node.id, node]));
  const links = (graph.data?.edges ?? []).flatMap((edge, i) => {
    if (!center) return [];
    const direction = edge.source === center.id ? 'out' : edge.target === center.id ? 'in' : undefined;
    const other = direction && nodes.get(direction === 'out' ? edge.target : edge.source);
    return direction && other ? [{ edge, direction, other, key: i }] : [];
  });
  return <div className="knowledge-detail knowledge-relations">
    <header className="object-header"><div className="object-emblem"><Network size={23} /></div>
      <div><h1>知识关系</h1></div>
      <a className="text-button object-action" href={routeFor(project, 'knowledge', entry, entry && requested?.state === 'candidate' ? 'review'
        : entry && (requested?.state === 'superseded' || requested?.state === 'invalidated') ? 'history' : 'current')}><ArrowLeft size={15} />知识正文</a>
    </header>
    <div className="detail-stack reading">
      {graph.error ? <Failure error={graph.error} retry={() => void graph.refetch()} /> : !graph.data ? <Loading />
        : !known.length ? <Empty title="暂无可查看的知识关系" icon={<Network />} /> : <>
          <select aria-label="选择知识节点" value={center?.objectId ?? ''} onChange={event => go(project, 'knowledge', event.target.value, 'relations')}>
            {!center && <option value="">选择知识</option>}
            {known.map(node => <option value={node.objectId} key={node.id}>{node.title} · {short(node.revision ?? '', 8)}</option>)}
          </select>
          {graph.data.truncated && <p className="muted-text">关系图只显示最近 200 条可见知识。</p>}
          {!center && <Empty title="这条知识当前没有可查看的关系" icon={<Network />} />}
          {center && <>
            <div className="relation-center"><Network size={20} /><strong>{center.title}</strong>
              {center.state && state[center.state] && <Pill>{state[center.state]}</Pill>}</div>
            <div className="relation-grid">
              {(['out', 'in'] as const).map(direction => <Section key={direction} title={direction === 'out' ? '来源与依据' : '使用与后续版本'}>
                {links.filter(row => row.direction === direction).length ? links.filter(row => row.direction === direction).map(({ edge, other, key }) => {
                  const href = nodeRoute(project, other);
                  const Icon = direction === 'out' ? ArrowUp : ArrowDown;
                  return <article className="relation-item" key={key}>
                    <div className="record-row"><Icon size={14} /><span>{relationship(edge, direction, other)}</span><Pill>{kinds[other.kind]}</Pill></div>
                    {href ? <a href={href}>{other.title}</a> : other.url ? <Ext href={other.url}>{other.title}</Ext> : <strong>{other.title}</strong>}
                    <div className="record-row">{edge.version && <span>第 {edge.version} 版</span>}
                      {edge.run && <span>执行 #{edge.run}</span>}{other.revision && <code>{short(other.revision)}</code>}</div>
                  </article>;
                }) : <p className="muted-text">暂无可见记录</p>}
              </Section>)}
            </div>
          </>}
        </>}
    </div>
  </div>;
}
