import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { Field } from './ui.tsx';

type CaseDraft = { title: string; expectation: string };

export function CaseEditor({ value, onChange }: { value: CaseDraft[]; onChange: (cases: CaseDraft[]) => void }) {
  function edit(index: number, key: keyof CaseDraft, text: string) {
    onChange(value.map((item, at) => at === index ? { ...item, [key]: text } : item));
  }
  return <>
    {value.map((item, index) => <fieldset key={index} className="selection">
      <legend>人工核对项 {index + 1}</legend>
      <Field label="核对项"><Input value={item.title} onChange={e => edit(index, 'title', e.target.value)} required maxLength={140} /></Field>
      <Field label="通过条件"><TextArea value={item.expectation} onChange={e => edit(index, 'expectation', e.target.value)}
        rows={2} required maxLength={660} /></Field>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, at) => at !== index))}>移除本项</Button>
    </fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={value.length >= 8}
      onClick={() => onChange([...value, { title: '', expectation: '' }])}>添加人工核对项</Button>
  </>;
}
