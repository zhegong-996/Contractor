import { lazy, Suspense } from 'react';
// Cognee's graph component uses Next's client-only dynamic boundary. The
// Paperclip plugin runs only in the browser, so reuse it with React Suspense.
export default function dynamic(load: () => Promise<any>, _options?: unknown) {
  const Component = lazy(load);
  return function ClientGraph(props: any) { return <Suspense fallback={<p role="status">正在加载图谱…</p>}><Component {...props} /></Suspense>; };
}
