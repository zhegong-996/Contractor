import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownBlock } from '@paperclipai/plugin-sdk/ui';
import CogneeGraph from 'suitme/cognee-graph';
import { emptySchema, schemaReducer } from 'suitme/cognee-schema';

const dictionaryDrafts = new Map<string, any>();
const names: Record<string, string> = { string: '文本', number: '数字', boolean: '是／否', date: '日期', enum: '枚举', relation: '关系' };
const displayLabel = (value: unknown) => String(value ?? '').replaceAll('<', '＜').replaceAll('>', '＞');

export function GraphPanel({ ui, source }: { ui: any; source: any }) {
  const [graph, setGraph] = useState<any>(), [selected, setSelected] = useState<any>(), [error, setError] = useState(''), [loading, setLoading] = useState(false), [reading, setReading] = useState(true);
  const graphApi = useRef<any>(null), controls = useRef<any>({});
  controls.current = { setSelectedNode: setSelected, getSelectedNode: () => selected };
  useEffect(() => { let live = true; setGraph(undefined); setSelected(undefined); setError('');
    setReading(true);
    void ui.read('knowledge-graph', { sourceId: source.id, revision: source.record.revision }).then((g: any) => { if (live) setGraph(g); }).catch((e: any) => { if (live && !String(e.message).includes('尚未生成图谱')) setError(e.message); }).finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [source.id, source.record.revision]);
  const visual = useMemo(() => graph && ({ nodes: graph.nodes.map((node: any) => ({ ...node, label: displayLabel(node.name) })),
    links: graph.edges.map((edge: any) => ({ ...edge, label: edge.relation === 'has_field' ? '包含字段' : displayLabel(edge.relation) })) }), [graph]);
  async function project() { setLoading(true); setError(''); try { setGraph(await ui.invoke('knowledge-graph', { sourceId: source.id, revision: source.record.revision, project: true })); setSelected(undefined); } catch (e: any) { setError(e.message); } finally { setLoading(false); } }
  return <section className="sm-stack"><div className="sm-row sm-spread sm-wrap"><span className="sm-small sm-muted">Cognee · Ladybug · 来源版本 {source.record.revision.slice(0, 8)}</span><div className="sm-actions"><button className="sm-button" onClick={() => graphApi.current?.zoomToFit?.(400, 30)} disabled={!graph}>适应视图</button><button className="sm-button" disabled={loading || ui.busy} onClick={() => void project()}>{loading ? '正在生成…' : graph ? '更新此版本图谱' : '生成此版本图谱'}</button></div></div>
    <p className="sm-small sm-muted">当前只投影此版本的正文、字段与来源关系。自动实体抽取和模型记忆整理尚未启用；待审阅内容保持待审阅状态。</p>
    {error && <p className="sm-error" role="alert">{error}</p>}
    {reading ? <p role="status">正在读取图谱…</p> : graph?.nodes.length ? <><div className="sm-cognee-graph" aria-label="知识实体与关系图"><CogneeGraph ref={graphApi} data={visual} graphControls={controls} /></div><p className="sm-small sm-muted">{graph.nodes.length} 个节点 · {graph.edges.length} 条关系 · 本次模型调用 {graph.modelCalls} 次</p>
      <label className="sm-field">查看节点<select className="sm-input" value={selected?.id ?? ''} onChange={e => setSelected(graph.nodes.find((n: any) => n.id === e.target.value))}><option value="">选择节点</option>{graph.nodes.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      {selected && <div className="sm-document sm-section"><h4>{selected.name}</h4>{selected.value_json !== undefined ? <p>{selected.data_type === 'boolean' ? JSON.parse(selected.value_json) ? '是' : '否' : String(JSON.parse(selected.value_json))}</p> : <MarkdownBlock content={selected.body ?? ''} />}<p className="sm-small sm-muted">来源版本 {String(selected.source_revision).slice(0, 8)}</p></div>}</> : <div className="sm-empty"><strong>此版本尚无图谱</strong>生成后可查看正文、字段和来源关系；不会调用模型。</div>}
  </section>;
}

export function DictionaryPanel({ ui, space }: { ui: any; space: string }) {
  const key = ui.prefix + 'ontology:' + space, [draft, setDraft] = useState<any>(() => dictionaryDrafts.get(key)), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [entityId, setEntityId] = useState(''), [conceptName, setConceptName] = useState(''), [definition, setDefinition] = useState(''), [fieldName, setFieldName] = useState(''), [fieldType, setFieldType] = useState('string'), [target, setTarget] = useState(''), [multiple, setMultiple] = useState(false), [enumValues, setEnumValues] = useState('');
  function retain(value: any) { dictionaryDrafts.set(key, value); setDraft(value); setSaved(false); }
  useEffect(() => { let live = true; setLoaded(false); setError('');
    void ui.read('ontology-view', { space }).then((value: any) => { if (!live) return; const previous = dictionaryDrafts.get(key); setDraft(previous ?? value); if (!previous) dictionaryDrafts.set(key, value); setLoaded(true); }).catch((e: any) => live && setError(e.message));
    return () => { live = false; };
  }, [key]);
  const schema = draft?.schema ?? emptySchema(), entity = schema.entities.find((e: any) => e._id === entityId) ?? schema.entities[0];
  function change(action: any) { retain({ ...draft, schema: schemaReducer(schema, action) }); }
  async function reload() { setError(''); try { const value = await ui.read('ontology-view', { space }); dictionaryDrafts.set(key, value); setDraft(value); setSaved(false); } catch (e: any) { setError(e.message); } }
  async function save() { setError(''); try { const result = await ui.invoke('ontology-save', { space, schema, revision: draft.revision }); dictionaryDrafts.set(key, result); setDraft(result); setSaved(true); } catch (e: any) { setError(e.message); } }
  return <section className="sm-stack"><div className="sm-section-head"><h3>知识字典与图谱模型</h3><span className="sm-small sm-muted">Cognee 原生 Schema{draft?.revision ? ' · ' + draft.revision.slice(0, 8) : ''}</span></div>
    {error && <div className="sm-error" role="alert"><span>{error}</span><button className="sm-button" onClick={() => void reload()}>载入已保存版本</button></div>}{!loaded ? <p role="status">正在读取知识字典…</p> : <>
      <form className="sm-form" onSubmit={e => { e.preventDefault(); change({ type: 'ADD_ENTITY', name: conceptName.trim(), description: definition.trim() }); setConceptName(''); setDefinition(''); }}><div className="sm-form-grid"><label className="sm-field">概念名称<input className="sm-input" value={conceptName} onChange={e => setConceptName(e.target.value)} required /></label><label className="sm-field">定义<input className="sm-input" value={definition} onChange={e => setDefinition(e.target.value)} /></label></div><div><button className="sm-button" disabled={!conceptName.trim()}>添加概念</button></div></form>
      {!schema.entities.length ? <div className="sm-empty"><strong>尚未定义知识字典</strong>概念、属性和关系由公司自己配置。</div> : <div className="sm-space-layout"><div className="sm-source-list">{schema.entities.map((e: any) => <button key={e._id} aria-current={entity?._id === e._id} onClick={() => setEntityId(e._id)}><strong>{e.name}</strong><span>{e.fields.length} 个属性与关系</span></button>)}</div><div className="sm-stack">
        <label className="sm-field sm-mobile-select">概念<select className="sm-input" value={entity?._id ?? ''} onChange={e => setEntityId(e.target.value)}>{schema.entities.map((e: any) => <option key={e._id} value={e._id}>{e.name}</option>)}</select></label>
        {entity && <><div className="sm-row sm-spread"><h4>{entity.name}</h4><button className="sm-button" disabled={schema.entities.some((e: any) => e.fields.some((f: any) => f.kind === 'relation' && f.relation.targetEntityName === entity.name))} title="先移除指向此概念的关系，再移除概念；保存后仍可在版本记录中查看。" onClick={() => change({ type: 'DELETE_ENTITY', entityId: entity._id })}>移除概念</button></div><label className="sm-field">定义<textarea className="sm-input" value={entity.description ?? ''} onChange={e => change({ type: 'UPDATE_ENTITY', entityId: entity._id, updates: { description: e.target.value } })} /></label>
          <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>属性／关系</th><th>类型</th><th>关联范围</th><th>操作</th></tr></thead><tbody>{entity.fields.map((f: any) => <tr key={f._id}><td>{f.name}</td><td>{names[f.kind === 'primitive' ? f.primitiveType : f.kind]}</td><td>{f.kind === 'relation' ? f.relation.targetEntityName + (f.relation.cardinality === 'many' ? '（多个）' : '（一个）') : f.kind === 'enum' ? f.enumValues.join('、') : '—'}</td><td><button className="sm-button" onClick={() => change({ type: 'DELETE_FIELD', entityId: entity._id, fieldId: f._id })}>移除</button></td></tr>)}</tbody></table></div>
          <form className="sm-form" onSubmit={e => { e.preventDefault(); const field = fieldType === 'relation' ? { name: fieldName.trim(), kind: 'relation', relation: { targetEntityName: target, cardinality: multiple ? 'many' : 'one' } } : fieldType === 'enum' ? { name: fieldName.trim(), kind: 'enum', enumValues: enumValues.split(/[\n,，]/).map(s => s.trim()).filter(Boolean) } : { name: fieldName.trim(), kind: 'primitive', primitiveType: fieldType }; change({ type: 'ADD_FIELD', entityId: entity._id, field }); setFieldName(''); }}>
            <div className="sm-form-grid"><label className="sm-field">属性或关系名<input className="sm-input" value={fieldName} onChange={e => setFieldName(e.target.value)} required /></label><label className="sm-field">类型<select className="sm-input" value={fieldType} onChange={e => setFieldType(e.target.value)}>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
            {fieldType === 'enum' && <label className="sm-field">枚举值<input className="sm-input" required placeholder="用逗号分隔" value={enumValues} onChange={e => setEnumValues(e.target.value)} /></label>}
            {fieldType === 'relation' && <div className="sm-form-grid"><label className="sm-field">目标概念<select className="sm-input" value={target} onChange={e => setTarget(e.target.value)} required><option value="">选择概念</option>{schema.entities.map((e: any) => <option key={e._id} value={e.name}>{e.name}</option>)}</select></label><label className="sm-check"><input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} />可关联多个</label></div>}
            <div><button className="sm-button" disabled={!fieldName.trim() || fieldType === 'relation' && !target}>添加属性／关系</button></div></form></>}
      </div></div>}
      <div className="sm-actions"><button className="sm-button" data-variant="primary" disabled={ui.busy} onClick={() => void save()}>保存知识字典</button>{draft?.issueId && <a className="sm-button" {...ui.nav.linkProps('/issues/' + draft.issueId)}>版本记录</a>}{saved && <span role="status">已保存；未启用自动抽取。</span>}</div><p className="sm-small sm-muted">复用 Cognee 的概念模型、关系约束和 JSON Schema 转换。保存字典不修改已有事实，也不启动模型。</p>
    </>}
  </section>;
}
