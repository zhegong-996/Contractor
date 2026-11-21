import { useState } from 'react';
import { BookOpen, Library, Plus, SlidersHorizontal } from 'lucide-react';
import type { AssistantHarness, AssistantHarnessStamp, AssistantPurpose, AssistantSkill, HarnessBindings } from '../../src/workbench/assistant-harness.ts';
import type { SkillRef } from '../../src/workbench/octop-resources.ts';
import { api, useData } from './api.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { Failure, Field, Loading, Modal, Pill, SearchBox, Section, short, useActions } from './ui.tsx';

const scopeNames = { builtin: '内置', team: '团队', personal: '仅本人' };
const shortRevision = (id: string) => short(id, 8);
type Editor = { mode: 'library' } | { mode: 'edit'; previous?: AssistantSkill };

export function HarnessSkills({ path, purpose, scope, bindings, mounts, onChange }: {
  path: string; purpose: AssistantPurpose; scope: 'team' | 'personal';
  bindings: HarnessBindings; mounts: ReturnType<AssistantHarness['mounts']>; onChange: (value: HarnessBindings) => void;
}) {
  const data = useData<AssistantSkill[]>(path);
  const [editor, setEditor] = useState<Editor>();
  const [preview, setPreview] = useState<string>();
  const [query, setQuery] = useState('');
  const [versions, setVersions] = useState<Record<string, string>>({});
  const { busy, clearError, run } = useActions();
  const catalog = (data.data ?? []).filter(row => row.purposes.includes(purpose));
  const groups = new Map<string, AssistantSkill[]>();
  for (const row of catalog) {
    const group = groups.get(row.id);
    if (group) group.push(row);
    else groups.set(row.id, [row]);
  }
  const changeEditor = (next?: Editor) => { clearError(); setEditor(next); };
  const attach = (ref: SkillRef) => onChange({ ...bindings, skills: bindings.skills.some(row => row.id === ref.id)
    ? bindings.skills.map(row => row.id === ref.id ? ref : row) : [...bindings.skills, ref] });
  const roomFor = (id?: string) => bindings.skills.length < 8 || bindings.skills.some(row => row.id === id);
  const matching = [...groups.values()].filter(rows => (rows[0]!.title + ' ' + rows[0]!.slug).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Section title="技能" action={<Button type="button" size="sm" variant="outline"
    onClick={() => { setQuery(''); changeEditor({ mode: 'library' }); void data.refetch(); }}><Library size={15} />技能库</Button>}>
    {bindings.skills.length ? <ul className="harness-skills">
      {bindings.skills.map(ref => {
        const registered = catalog.find(row => row.id === ref.id && row.revision === ref.revision);
        const saved = mounts.find(row => row.id === ref.id && row.revision === ref.revision);
        const active = registered?.active ?? saved?.active ?? false;
        return <li key={ref.id} className="harness-skill-row">
          <BookOpen size={16} aria-hidden="true" />
          <div className="harness-skill-info"><strong>{registered?.title ?? saved?.title ?? '技能版本不可用'}</strong>
            <code title={ref.revision}>{shortRevision(ref.revision)}</code>
            {registered && <span className="muted-text">{scopeNames[registered.scope]}</span>}
            {!active && <Pill tone="amber">当前不可用</Pill>}
          </div>
          <Button size="sm" variant="ghost" type="button" aria-label={`移除技能 ${registered?.title ?? saved?.title ?? shortRevision(ref.revision)}`}
            onClick={() => onChange({ ...bindings, skills: bindings.skills.filter(row => row.id !== ref.id) })}>移除</Button>
        </li>;
      })}
    </ul> : <p className="muted-text">未挂载技能</p>}
    {editor && <Modal title={editor.mode === 'library' ? '技能库' : editor.previous ? '发布技能新版本' : scope === 'team' ? '新建团队技能' : '新建个人技能'}
      close={() => changeEditor()}>
      {editor.mode === 'library' ? <>
        <div className="harness-library-toolbar">
          <SearchBox label="搜索技能" value={query} onChange={setQuery} />
          <Button variant="outline" disabled={busy} onClick={() => changeEditor({ mode: 'edit' })}><Plus size={15} />新建技能</Button>
        </div>
        {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
          : matching.length ? <div className="harness-library">
            {matching.map(rows => {
              const latest = rows[0]!;
              const selected = rows.find(row => row.revision === versions[latest.id]) ?? latest;
              const attached = bindings.skills.find(row => row.id === latest.id);
              const current = attached?.revision === selected.revision;
              return <article className="harness-library-card" key={latest.id}>
                <div className="harness-skill-info"><strong>{latest.title}</strong><span className="muted-text">{scopeNames[latest.scope]}</span>
                  {!latest.active && <Pill tone="amber">已停用</Pill>}</div>
                <div className="harness-skill-actions">
                  {rows.length > 1 ? <select aria-label={latest.title + '版本'} value={selected.revision}
                    onChange={event => setVersions({ ...versions, [latest.id]: event.target.value })}>
                    {rows.map(row => <option value={row.revision} key={row.revision}>
                      {shortRevision(row.revision)}{row === latest ? ' · 最新' : ''}{attached?.revision === row.revision ? ' · 已选' : ''}</option>)}
                  </select> : <code title={selected.revision}>{shortRevision(selected.revision)}</code>}
                  <Button size="sm" variant="ghost" aria-expanded={preview === latest.id}
                    onClick={() => setPreview(preview === latest.id ? undefined : latest.id)}>{preview === latest.id ? '收起正文' : '查看正文'}</Button>
                  <Button size="sm" variant="outline" disabled={busy || current || !selected.active || !roomFor(selected.id)}
                    onClick={() => { attach({ id: selected.id, revision: selected.revision }); changeEditor(); }}>
                    {current ? '已选此版本' : attached ? '切换此版本' : '挂载技能'}</Button>
                </div>
                {preview === latest.id && <pre className="harness-text">{selected.instructions}</pre>}
                {latest.editable && <div className="harness-skill-actions harness-publish-actions">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => changeEditor({ mode: 'edit', previous: latest })}>发布新版本</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(path, {
                    action: 'status', id: latest.id, active: !latest.active,
                  }), latest.active ? '该技能已停用' : '该技能已恢复')}>{latest.active ? '停用技能' : '恢复技能'}</Button>
                </div>}
              </article>;
            })}
          </div> : <p className="muted-text">没有匹配的技能</p>}
        {bindings.skills.length >= 8 && <p className="muted-text">本用途已选 8 个技能，可以切换现有版本或移除后再添加。</p>}
      </> : <SkillEditor previous={editor.previous} scope={scope} mayAttach={roomFor(editor.previous?.id) && editor.previous?.active !== false}
        path={path} close={() => changeEditor({ mode: 'library' })}
        attach={ref => { attach(ref); changeEditor(); }} />}
    </Modal>}
  </Section>;
}

function SkillEditor({ previous, scope, mayAttach, path, close, attach }: {
  previous?: AssistantSkill; scope: 'team' | 'personal'; mayAttach: boolean; path: string;
  close: () => void; attach: (ref: SkillRef) => void;
}) {
  const { run, busy } = useActions();
  return <form className="form" onSubmit={async event => {
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(event.currentTarget);
    const toAttach = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'attach';
    const slug = String(data.get('slug')).trim();
    const body = String(data.get('body')).trim();
    const markdown = /^---[ \t]*\r?\n/.test(body) ? body : '---\nname: ' + slug + '\n---\n' + body;
    const result = await run(() => api<SkillRef>(path, { action: 'publish', title: data.get('title'), slug, markdown }), '技能版本已保存');
    if (result) {
      if (toAttach) attach(result);
      else close();
    }
  }}>
    <div className="form-grid">
      <Field label="技能名称"><Input aria-label="技能名称" name="title" required maxLength={100} defaultValue={previous?.title} /></Field>
      <Field label="技能标识" hint="使用小写字母、数字和连字符"><Input aria-label="技能标识" name="slug" required
        pattern="[a-z][a-z0-9\-]{0,47}" maxLength={48} defaultValue={previous?.slug} readOnly={!!previous} /></Field>
    </div>
    <Field label="技能正文" hint="可填写 Markdown，或粘贴含相同 name 的 SKILL.md。">
      <TextArea aria-label="技能正文" name="body" rows={7} required maxLength={6000} defaultValue={previous?.instructions} />
    </Field>
    {scope === 'team' && <p className="muted-text">团队成员可以查看和挂载已发布的团队技能。</p>}
    <div className="form-actions"><Button type="button" variant="ghost" onClick={close} disabled={busy}>返回技能库</Button>
      <Button type="submit" name="save" value="publish" variant={mayAttach ? 'outline' : 'default'} disabled={busy}>保存版本</Button>
      {mayAttach && <Button type="submit" name="save" value="attach" disabled={busy}>保存版本并挂载</Button>}</div>
  </form>;
}

export function ContextModules({ modules, bindings, onChange }: {
  modules: ReturnType<AssistantHarness['modules']>; bindings: HarnessBindings; onChange: (value: HarnessBindings) => void;
}) {
  return <div className="harness-modules">{modules.map(module => {
    const value = bindings.context[module.id] ?? module.defaultEnabled;
    return <label className="harness-module" key={module.id}>
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span><strong>{module.title}</strong><small>{module.description}</small></span>
      <input type="checkbox" aria-label={module.title + '组件'} checked={value}
        onChange={event => {
          const context = { ...bindings.context };
          if (event.target.checked === module.defaultEnabled) delete context[module.id];
          else context[module.id] = event.target.checked;
          onChange({ ...bindings, context });
        }} />
    </label>;
  })}</div>;
}

export function HarnessPrompt({ value, contract, limit, onChange }: {
  value: string; contract: string; limit: number; onChange: (value: string) => void;
}) {
  return <Section title="提示词">
    <TextArea aria-label="提示词" rows={5} maxLength={limit} value={value} showCount
      placeholder="填写希望 Agent 遵循的判断口径、工作方法或输出格式" onChange={event => onChange(event.target.value)} />
    <details className="minor-disclosure harness-contract">
      <summary>查看平台运行规则</summary><p>{contract}</p>
    </details>
  </Section>;
}

export function HarnessCallDetails({ stamp }: { stamp: AssistantHarnessStamp }) {
  return <details className="minor-disclosure harness-call">
    <summary>运行配置 <code title={stamp.revision}>{shortRevision(stamp.revision)}</code></summary>
    <dl className="facts">
      <dt>技能版本</dt><dd>{stamp.skills.length ? stamp.skills.map(row => <span key={row.id}>
        {row.title} <code title={row.revision}>{shortRevision(row.revision)}</code>
      </span>) : '未挂载'}</dd>
      {stamp.context.length > 0 && <><dt>上下文组件</dt><dd>{stamp.context.map(row => <span key={row.id}>{row.title} · {row.version}</span>)}</dd></>}
    </dl>
  </details>;
}

export function HarnessSave({ conflict, busy, dirty, savedAt, refresh, keep }: {
  conflict: boolean; busy: boolean; dirty: boolean; savedAt: string; refresh: () => void; keep: () => void;
}) {
  return <div className="harness-save">
    {conflict ? <div className="record-row" role="status"><span>配置已有更新，当前输入已保留。</span>
      <Button type="button" size="sm" variant="outline" onClick={keep}>以当前草稿继续编辑</Button>
      <Button type="button" size="sm" variant="ghost" onClick={refresh}>读取已保存配置</Button>
    </div> : <span className="muted-text">{dirty ? '有未保存的更改' : savedAt}</span>}
    <Button type="submit" disabled={busy || conflict || !dirty}>保存配置</Button>
  </div>;
}
