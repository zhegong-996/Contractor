import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, FilePlus2, History, Import, LockKeyhole, Network, PencilLine, Plus, XCircle } from 'lucide-react';
import { api, readable, useData, type Imported, type Knowledge, type MemoryRow, type MemoryUse, type ProjectKnowledgeAccess, type ReadableKnowledge, type RecallHit } from './api.ts';
import { AcceptedEvidence } from './accepted-evidence.tsx';
import { KnowledgeRelations } from './knowledge-relations.tsx';
import { go, routeFor, runRoute, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { Markdown } from './markdown.tsx';
import { date, Empty, Ext, Failure, Field, IconButton, KnowledgeGrantStatus, Loading, MaterialIcon, Modal, Pill, SearchBox, Section, Segments,
  short, Source, useActions, useStored } from './ui.tsx';

const catalogTabs = [['current', '现行'], ['review', '待确认'], ['history', '历史']] as const;
type CatalogTab = (typeof catalogTabs)[number][0];
const kinds: Record<string, string> = { reference: '资料', procedure: '流程', decision: '决策' };
function badge(entry: Knowledge) {
  if (readable(entry) && entry.retirement) return <Pill tone="neutral">{entry.retirement.kind === 'superseded' ? '已替代' : '已失效'}</Pill>;
  return entry.state === 'candidate' ? <Pill tone="amber">待确认</Pill> : <Pill tone="green">已采用</Pill>;
}

export function KnowledgePage(props: PageProps) {
  const { project, route } = props;
  const tab: CatalogTab = catalogTabs.find(([name]) => name === route.tab)?.[0] ?? 'current';
  const [query, search] = useStored('knowledge-query:' + project.id, '');
  const [searchTerm, setTerm] = useState(query);
  const [editing, edit] = useState<'add' | 'import' | null>(null);
  const overview = !route.item && route.tab === 'activity';
  const relations = route.tab === 'relations';
  const grants = route.tab === 'access';
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(query.trim()), 240);
    return () => window.clearTimeout(timer);
  }, [query]);
  const catalog = useData<Knowledge[]>('knowledge/' + project.id + (tab === 'history' ? '?history=1'
    : tab === 'current' && searchTerm ? '?q=' + encodeURIComponent(searchTerm) : ''), 2800);
  const match = catalog.data?.find(e => e.id === route.item);
  const unfiltered = useData<Knowledge[]>(tab === 'current' && searchTerm && route.item && !match
    ? 'knowledge/' + project.id : '', 2800);
  const selected = match ?? unfiltered.data?.find(e => e.state === 'published' && e.id === route.item);
  const waiting = catalog.isPending || unfiltered.isFetching && unfiltered.isPending;
  const entries = (catalog.data ?? []).filter(entry => {
    if (tab === 'current') return entry.state === 'published';
    if (tab === 'review') return entry.state === 'candidate' && (!query || entry.title.includes(query.trim()));
    return entry.state === 'published' && (!query || entry.title.includes(query.trim()));
  });
  return <div className="split" data-has-detail={!!route.item || overview || relations || grants}>
    <aside className="split-list" aria-label="项目资料列表">
      <div className="list-header">
        <div className="list-title"><h1>知识与记忆</h1><div className="actions">
          {project.importableSources.length > 0 && <IconButton label="接入资料" onClick={() => edit('import')}><Import /></IconButton>}
          {project.mayStart && <IconButton label="新增知识" onClick={() => edit('add')}><Plus /></IconButton>}
        </div></div>
        <SearchBox label="搜索项目知识" value={query} onChange={search} />
        <Segments label="知识状态" items={catalogTabs} value={tab} onChange={value => go(project.id, 'knowledge', undefined, value)} />
      </div>
      <div className="knowledge-shortcuts"><a className="text-button" href={routeFor(project.id, 'knowledge', undefined, 'activity')}>协作沉淀 <ArrowRight size={14} /></a>
        <a className="text-button" href={routeFor(project.id, 'knowledge', undefined, 'relations')}><Network size={14} />知识关系</a>
        <a className="text-button" href={routeFor(project.id, 'knowledge', undefined, 'access')}><LockKeyhole size={14} />我管理的授权</a></div>
      <div className="list-scroll">
        {catalog.error ? <Failure error={catalog.error} retry={() => void catalog.refetch()} /> : catalog.isPending ? <Loading />
          : entries.length ? entries.map(entry => <a key={entry.id} className="list-item entry-item"
            aria-current={route.item === entry.id ? 'page' : undefined} href={routeFor(project.id, 'knowledge', entry.id, tab)}>
            <MaterialIcon /><div>
              <strong>{entry.title}</strong>
              <div className="list-item-meta"><span>{kinds[entry.kind] ?? entry.kind}</span>{entry.visibility === 'restricted' && <><LockKeyhole size={12} />受限</>}
                {tab === 'history' ? badge(entry) : null}</div>
            </div></a>)
            : <Empty title={query ? '没有匹配的知识' : tab === 'review' ? '没有待确认的候选' : tab === 'history' ? '暂无历史知识' : '还没有已采用的知识'} icon={<BookOpen />} />}
      </div>
    </aside>
    <div className="split-detail">
      {(route.item || overview || relations || grants) && <a className="mobile-back" href={routeFor(project.id, 'knowledge', undefined, tab)}><ArrowLeft size={16} />知识列表</a>}
      {grants ? <KnowledgeAccess project={project.id} /> : relations ? <KnowledgeRelations project={project.id} entry={route.item} /> : selected ? <KnowledgeDetail entry={selected} key={selected.id} {...props} />
        : route.item && waiting ? <Loading /> : route.item ? <Empty title="此条目当前不可见" icon={<LockKeyhole />}
          description="可以查看现行列表，或在有权限时查询历史版本。" />
          : <MemoryHome project={project.id} />}
    </div>
    {editing === 'add' && <KnowledgeEditor {...props} close={() => edit(null)} />}
    {editing === 'import' && <ImportSource {...props} close={() => edit(null)} />}
  </div>;
}

function KnowledgeAccess({ project }: { project: string }) {
  const data = useData<ProjectKnowledgeAccess>('project/' + project + '/knowledge-access', 3200);
  const [selection, select] = useState<ProjectKnowledgeAccess[number]>();
  const { run, busy } = useActions();
  const chosen = selection && data.data?.find(row => row.id === selection.id);
  const granting = selection?.canGrant === true;
  return <div className="knowledge-detail"><div className="reading">
    <header className="object-header"><div className="object-emblem"><LockKeyhole size={22} /></div><h1>我管理的授权</h1></header>
    <Section title="工单资料授权">
      {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
        : !data.data.length ? <Empty title="你负责的资料暂无工单授权" icon={<LockKeyhole />} />
        : data.data.map(row => <div className="record-row access-row" key={row.id}>
          <div className="access-identity">
            <a href={routeFor(project, 'work', row.ticket, 'context')}><strong>{row.title}</strong></a>
            <div className="inline-meta"><span>{row.readerOwner} · {row.readerAgent}</span><KnowledgeGrantStatus {...row} />
              {row.expires && row.state === 'granted' && <span>有效至 {date(new Date(row.expires).toISOString())}</span>}</div>
          </div>
          {(row.canGrant || row.canRevoke) && <Button size="sm" variant="outline" onClick={() => select(row)}>{row.canGrant ? '确认授权' : '撤回授权'}</Button>}
        </div>)}
    </Section>
    {selection && <Modal title={granting ? '确认工单资料授权' : '撤回工单资料授权'} close={() => select(undefined)}>
      <div className="form"><p>{selection.title} · {selection.readerOwner} 的 {selection.readerAgent}</p>
        <p className="muted-text">{granting ? `仅限当前工单与资料版本，有效期 ${chosen?.hours ?? selection.hours} 小时。` : '撤回后，系统将重新检查关联成果和派生知识的访问。'}</p>
        <div className="form-actions"><Button disabled={busy || !(granting ? chosen?.canGrant : chosen?.canRevoke)}
          variant={granting ? 'default' : 'destructive'} onClick={async () => {
            if (!chosen) return;
            if (await run(() => api('ticket/' + chosen.ticket + '/access/' + chosen.id, { state: granting ? 'granted' : 'revoked', hours: granting ? chosen.hours : undefined }),
              granting ? '已授权' : '已撤回授权')) select(undefined);
          }}>{granting ? `授权 ${chosen?.hours ?? selection.hours} 小时` : '确认撤回'}</Button></div>
      </div>
    </Modal>}
  </div></div>;
}

function MemoryHome({ project }: { project: string }) {
  const data = useData<MemoryRow[]>('project/' + project + '/memory', 3200);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const matches = useData<RecallHit[]>(submitted ? 'project/' + project + '/recall?q=' + encodeURIComponent(submitted) : '');
  return <div className="knowledge-detail">
    <header className="object-header"><div className="object-emblem"><BookOpen size={24} /></div><div><h1>协作沉淀</h1></div></header>
    <div className="detail-stack reading">
      <Section title="试查项目记忆">
        <form className="inline-form" onSubmit={event => { event.preventDefault(); setSubmitted(query.trim()); }}>
          <SearchBox label="输入下一次任务的问题" value={query} onChange={setQuery} />
          <Button type="submit" size="sm" variant="outline" disabled={!query.trim()}>检索</Button>
        </form>
        {submitted && (matches.error ? <Failure error={matches.error} /> : !matches.data ? <Loading />
          : matches.data.length ? matches.data.map(hit => <div className="record-row" key={hit.id}>
            <a className="text-button" href={routeFor(project, 'knowledge', hit.id)}>{hit.title}</a>
            {hit.pinned && <Pill tone="violet">常用口径</Pill>}
            <small>{hit.conditions}</small>
          </div>) : <p className="muted-text">未找到可供新工单装配的现行记忆。</p>)}
      </Section>
      {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
        : data.data.length ? <Section title="近期知识">
          {data.data.map(entry => <article className="revision-note" key={entry.id}>
            <div className="record-row">
              <a className="text-button" href={routeFor(project, 'knowledge', entry.id, entry.state === 'candidate' ? 'review' : entry.retirement ? 'history' : 'current')}>
                {entry.title}<ArrowRight size={14} /></a>
              <Pill tone={entry.state === 'candidate' ? 'amber' : entry.retirement ? 'neutral' : 'green'}>
                {entry.state === 'candidate' ? '待确认' : entry.retirement === 'superseded' ? '已替代' : entry.retirement ? '已失效' : '已采用'}
              </Pill>
              {entry.pinned && <Pill tone="violet">常用口径</Pill>}
            </div>
            <div className="record-row">{entry.ticket
              ? <a href={routeFor(project, 'work', entry.ticket, 'delivery')}>{entry.ticketTitle}</a>
              : <span>接入资料</span>}<small>{entry.owner}</small>{entry.at && <time>{date(entry.at)}</time>}</div>
            {entry.related && <a className="text-button" href={routeFor(project, 'knowledge', entry.related.id)}>
              {entry.related.sameBody ? '核对重复知识' : '对照同名现行口径'}
            </a>}
          </article>)}
        </Section> : <Empty title="等待项目沉淀" description="验收形成的候选和接入的资料会显示在这里。" icon={<BookOpen />} />}
    </div>
  </div>;
}

function KnowledgeDetail({ entry, project, workspace, openTask, route }: PageProps & { entry: Knowledge }) {
  const { run, busy } = useActions();
  const [dialog, show] = useState('');
  const owned = entry.owner === workspace.actor;
  const full = readable(entry) ? entry : undefined;
  const active = !!full && entry.state === 'published' && !full.retirement && route.tab !== 'history';
  const memory = useData<MemoryRow[]>('project/' + project.id + '/memory');
  const pinned = memory.data?.some(item => item.id === entry.id && item.pinned);
  const compare = memory.data?.find(item => item.id === entry.id)?.related;
  const source = full?.source;
  return <div className="knowledge-detail">
    <header className="object-header">
      <div className="object-emblem"><BookOpen size={24} /></div>
      <div className="min-w-0"><h1>{entry.title}</h1>
        <div className="object-meta">{badge(entry)}<span>{kinds[entry.kind] ?? entry.kind}</span>
          <span>{entry.visibility === 'restricted' ? '受限资料' : '项目可见'}</span><span>负责人 {entry.owner}</span></div>
      </div>
      {full && <a className="text-button object-action" href={routeFor(project.id, 'knowledge', entry.id, 'relations')}><Network size={16} />知识关系</a>}
    </header>
    <div className="detail-stack reading">
      {!full && <div className="info-callout"><LockKeyhole size={17} /><span>此资料需按工单申请授权。负责人批准后，本工单的执行 Agent 才能读取。</span></div>}
      {full && full.state === 'candidate' && <div className="info-callout"><PencilLine size={17} />
        {full.draft?.needsReview ? '验收形成的候选，采用前请确认结论和适用条件。' : '待负责人确认，采用后才进入现行检索。'}</div>}
      {full?.conditions && <section className="condition">
        <h2>适用条件</h2><Markdown text={full.conditions} />
      </section>}
      {full && <div className="knowledge-body"><Markdown text={full.body} /></div>}
      {(source || full?.ticket || full?.replaces || full?.retirement || !!full?.provenance?.length) && <Section title="来源与版本">
        {source && <div className="record-row"><Source channel={source.path ? 'github' : 'feishu-doc'} />
          <Ext href={source.url}>{source.path ?? '原始文档'}</Ext><code title={source.revision}>源版本 {short(source.revision, 12)}</code></div>}
        {full?.revision && <div className="record-row"><span>知识修订</span><code title={full.revision}>{short(full.revision, 12)}</code>
          {full.published && <small>{full.published.by} 于 {date(full.published.at)} 采用</small>}</div>}
        {full?.retirement?.replacement && <a className="text-button" href={routeFor(project.id, 'knowledge', full.retirement.replacement.id)}>查看替代版本 <ArrowRight size={15} /></a>}
        {full?.retirement?.reason && <p className="muted-text">失效原因 {full.retirement.reason}</p>}
        {full?.replaces && <a className="text-button" href={routeFor(project.id, 'knowledge', full.replaces.id, 'history')}><History size={15} />回看被替代版本</a>}
        {full?.acceptedSource ? <AcceptedEvidence source={full.acceptedSource} project={project.id} />
          : full?.ticket && <a className="text-button" href={routeFor(project.id, 'work', full.ticket, 'delivery')}>来源工单 <ArrowRight size={15} /></a>}
        {full?.provenance?.filter(e => !e.ticket && (!full.acceptedSource?.delivery || e.url !== full.acceptedSource.delivery.url)).map((e, index) => <div className="record-row" key={e.revision + index}>
          <Ext href={e.url}>{e.title}</Ext><code>{short(e.revision, 12)}</code>
        </div>)}
      </Section>}
      {full?.learning && <Section title="观测证据"><p>{full.learning.metric} · 基线 {full.learning.baseline} {full.learning.unit}</p><Markdown text={full.learning.evidence} /></Section>}
      {compare && <a className="text-button" href={routeFor(project.id, 'knowledge', compare.id, 'current')}>
        {compare.sameBody ? '核对相同结论' : '对照现行口径'} <ArrowRight size={14} />
      </a>}
      {full?.state === 'published' && <MemoryUseHistory project={project.id} id={entry.id} />}
      <div className="actions">
        {(active || !full && entry.state === 'published') && project.mayStart && <Button onClick={() => openTask(full?.learning && full.ticket
          ? { lesson: { id: entry.id, title: entry.title, ticket: full.ticket, metric: full.learning.metric, unit: full.learning.unit, baseline: full.learning.baseline } }
          : { material: [entry.id] })}>{full?.learning ? '复用经验' : '用于新工单'}<ArrowRight /></Button>}
        {full?.canReview && <Button variant="outline" disabled={busy} onClick={() => show('review')}><PencilLine />核对内容</Button>}
        {full?.canPublish && <Button disabled={busy} onClick={() => show('publish')}><Check />确认采用</Button>}
        {active && full.directory && project.mayStart && <Button variant="outline" onClick={() => show('directory')}>
          <LockKeyhole />{full.directory === 'hidden' ? '目录隐藏' : '公开标题，可申请'}
        </Button>}
        {active && owned && !full?.source && !full?.ticket && <Button variant="outline" onClick={() => show('replace')}><FilePlus2 />拟定新版</Button>}
        {active && owned && <Button variant="ghost" onClick={() => show('invalidate')}><XCircle />标记失效</Button>}
        {active && full.visibility === 'project' && full.body.length <= 1500 && full.conditions && project.maintain && memory.data
          && <Button variant="outline" size="sm" disabled={busy}
            onClick={() => void run(() => api('knowledge/' + entry.id + '/pin', { pinned: !pinned }), pinned ? '已取消固定' : '已固定为常用口径')}>
            {pinned ? '取消固定' : '固定为常用口径'}
          </Button>}
      </div>
    </div>
    {full && (dialog === 'review' || dialog === 'replace') && <KnowledgeEditor {...{ project, workspace, openTask, route }}
      close={() => show('')} entry={full} mode={dialog} />}
    {dialog === 'publish' && full && <PublishDialog entry={full} project={project} close={() => show('')} />}
    {dialog === 'directory' && full?.directory && <Modal title="受限知识目录" close={() => show('')}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const directory = new FormData(e.currentTarget).get('directory');
        if (await run(() => api('knowledge/' + full.id + '/directory', { revision: full.revision, directory }), '目录设置已保存')) show('');
      }}>
        <Field label="项目成员可见范围"><select name="directory" defaultValue={full.directory}>
          <option value="hidden">隐藏标题和来源</option><option value="requestable">公开标题，可按工单申请</option>
        </select></Field>
        <p className="muted-text">正文仍按工单授权。已授权的访问可在访问申请中撤回。</p>
        <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
      </form>
    </Modal>}
    {dialog === 'invalidate' && full && <Modal title="标记知识失效" close={() => show('')}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const reason = new FormData(e.currentTarget).get('reason');
        if (await run(() => api('knowledge/' + full.id + '/invalidate', { revision: full.revision, reason }), '该知识已退出现行检索')) {
          show(''); go(project.id, 'knowledge', full.id, 'history');
        }
      }}>
        <p>历史工单会保留此知识作为当时的依据。新的委托无法继续使用它。</p>
        <Field label="失效原因"><TextArea name="reason" maxLength={3500} required rows={3} /></Field>
        <div className="form-actions"><Button variant="destructive" type="submit" disabled={busy}>确认失效</Button></div>
      </form>
    </Modal>}
  </div>;
}

function MemoryUseHistory({ project, id }: { project: string; id: string }) {
  const data = useData<MemoryUse[]>('knowledge/' + id + '/uses', 3200);
  return <Section title="使用记录">
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
      : data.data.length ? data.data.map(item => <div className="record-row" key={item.run + ':' + item.attempt}>
        <a className="text-button" href={runRoute(project, item.ticket, item.run, item.attempt)}>{item.title}<ArrowRight size={14} /></a>
        <small>第 {item.version} 版 · #{item.run}/{item.attempt} {item.owner}</small>
        <Pill tone={item.cited ? 'green' : 'neutral'}>{item.cited ? '成果已引用' : '已装配'}</Pill>
        {item.recalled && <span>按任务检索</span>}
      </div>) : <p className="muted-text">暂无可查看的执行记录。</p>}
  </Section>;
}

function KnowledgeEditor({ project, entry, mode, close }: PageProps & { entry?: ReadableKnowledge; mode?: 'review' | 'replace'; close: () => void }) {
  const key = 'knowledge-edit:' + project.id + ':' + (entry?.id ?? 'new') + ':' + (mode ?? '');
  const initial = { title: entry?.title ?? '', body: entry?.body ?? '', conditions: entry?.conditions ?? '',
    visibility: entry?.visibility ?? 'restricted', kind: entry?.kind ?? 'reference', directory: entry?.directory ?? 'hidden' };
  const [draft, save] = useStored(key, initial);
  const update = (name: keyof typeof draft, value: string) => save({ ...draft, [name]: value });
  const { run, busy } = useActions();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const outcome = await run(() => mode === 'review' && entry
      ? api<{ id: string }>('knowledge/' + entry.id + '/review', { revision: entry.revision, title: draft.title.trim(), body: draft.body.trim(), conditions: draft.conditions.trim() })
      : api<{ id: string }>('knowledge/' + project.id, { ...draft, directory: !entry && draft.visibility === 'restricted' ? draft.directory ?? 'hidden' : undefined,
        ...(entry ? { replaces: { id: entry.id, revision: entry.revision } } : {}) }),
      mode === 'review' ? '复核已保存，等待采用' : '知识已保存');
    if (outcome) {
      save(initial);
      close();
      go(project.id, 'knowledge', outcome.id, entry ? 'review' : 'current');
    }
  }
  return <Modal title={mode === 'review' ? '核对知识候选' : mode === 'replace' ? '拟定知识新版' : '新增项目知识'} close={close}>
    <form className="form" onSubmit={submit}>
      <Field label="标题"><Input autoFocus maxLength={100} value={draft.title} onChange={e => update('title', e.target.value)} required /></Field>
      <Field label="正文"><TextArea value={draft.body} onChange={e => update('body', e.target.value)} rows={8} maxLength={16000} required /></Field>
      <Field label="适用条件"><TextArea value={draft.conditions} onChange={e => update('conditions', e.target.value)} rows={2} maxLength={600} required={!!mode} /></Field>
      {!entry && <div className="form-grid">
        <Field label="类型"><select value={draft.kind} onChange={e => update('kind', e.target.value)}>
          <option value="reference">资料</option><option value="procedure">流程</option><option value="decision">决策</option>
        </select></Field>
        <Field label="可见范围"><select value={draft.visibility} onChange={e => update('visibility', e.target.value)}>
          <option value="restricted">按工单授权</option><option value="project">项目成员</option>
        </select></Field>
      </div>}
      {!entry && draft.visibility === 'restricted' && <Field label="目录"><select value={draft.directory ?? 'hidden'} onChange={e => update('directory', e.target.value)}>
        <option value="hidden">隐藏标题和来源</option><option value="requestable">公开标题，可按工单申请</option>
      </select></Field>}
      <div className="form-actions"><Button type="submit" disabled={busy}>{mode === 'replace' ? '保存待确认版本' : '保存'}</Button></div>
    </form>
  </Modal>;
}

function PublishDialog({ entry, project, close }: { entry: ReadableKnowledge; project: PageProps['project']; close: () => void }) {
  const history = useData<Knowledge[]>(entry.ticket && !entry.replaces ? 'knowledge/' + project.id + '?history=1' : '');
  const eligible = (history.data ?? []).filter(readable).filter(e => e.id !== entry.id && e.state === 'published'
    && !e.retirement?.replacement && e.owner === entry.owner && e.kind === entry.kind && e.visibility === entry.visibility && !e.source);
  const [replace, setReplace] = useState('');
  const { run, busy } = useActions();
  return <Modal title="确认采用知识" close={close}>
    <form className="form" onSubmit={async e => {
      e.preventDefault(); const chosen = eligible.find(e => e.id === replace);
      if (await run(() => api('knowledge/' + entry.id + '/publish', { revision: entry.revision,
        ...(chosen ? { replaces: { id: chosen.id, revision: chosen.revision } } : {}) }), '已采用为现行知识')) {
        close(); go(project.id, 'knowledge', entry.id, 'current');
      }
    }}>
      <strong>{entry.title}</strong><p>{entry.conditions}</p>
      {entry.source && <p className="muted-text">采用时会复核源版本 {short(entry.source.revision, 12)}。</p>}
      {entry.replaces && <p className="muted-text">采用后会替换原先的现行版本，历史引用保留。</p>}
      {!!eligible.length && <Field label="替代已采用结论（选填）"><select value={replace} onChange={e => setReplace(e.target.value)}>
        <option value="">作为独立知识采用</option>{eligible.map(e => <option key={e.id} value={e.id}>{e.title} · {short(e.revision)}</option>)}
      </select></Field>}
      <div className="form-actions"><Button type="submit" disabled={busy}><Check />确认采用</Button></div>
    </form>
  </Modal>;
}

function ImportSource({ project, close }: PageProps & { close: () => void }) {
  const { run, busy } = useActions();
  const [selection, choose] = useState({ ref: project.importableSources[0]?.ref ?? '', file: '' });
  const source = project.importableSources.find(s => s.ref === selection.ref);
  return <Modal title="接入项目资料" close={close}><form className="form" onSubmit={async e => {
    e.preventDefault();
    const result = await run(() => api<Imported>('project/' + project.id + '/knowledge-import',
      { resource: selection.ref, path: selection.file || undefined }), '已核对来源版本');
    if (result) { close(); go(project.id, 'knowledge', result.id, result.state === 'published' ? 'current' : 'review'); }
  }}>
    <Field label="资料来源"><select value={selection.ref} onChange={e => choose({ ref: e.target.value, file: '' })} required>
      {project.importableSources.map(ref => <option key={ref.ref} value={ref.ref}>{ref.label}</option>)}
    </select></Field>
    {!!source?.files.length && <Field label="Markdown 文件"><select value={selection.file} onChange={e => choose({ ...selection, file: e.target.value })} required>
      <option value="">选择已配置路径</option>{source.files.map(file => <option key={file} value={file}>{file}</option>)}
    </select></Field>}
    {source && <div className="inline-meta"><Source channel={source.source} /><span>{source.visibility === 'restricted' ? '按工单授权' : '项目可见'}</span></div>}
    <div className="form-actions"><Button type="submit" disabled={busy || !source}><Import />读取版本</Button></div>
  </form></Modal>;
}
