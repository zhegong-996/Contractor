import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Ext } from './ui.tsx';

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => <Ext href={href}>{children}</Ext>,
    img: ({ alt }) => alt ? <span>〔{alt}〕</span> : null,
  }}>{text}</ReactMarkdown></div>;
}
