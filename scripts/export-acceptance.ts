// Export one sealed v0.6 acceptance round into an ingestible
// lobehub/acceptance round directory (result.json + assets + report.md).
// Usage: npm run acceptance:export -- <taskId>
import { api } from '../src/client.ts';
import { runtime } from '../src/config.ts';
import { writeAcceptanceBundle, type AcceptanceReport } from '../src/acceptance-interop.ts';
import type { CollabEvent } from '../src/event-stream.ts';

const taskId = process.argv[2];
if (!taskId) throw new Error('Usage: npm run acceptance:export -- <taskId>');
const result = await api('/workspace/v06-acceptance-export', { taskId }) as any;
const report = result?.report as AcceptanceReport;
if (!report?.cases?.length) throw new Error('未取得逐项验收报告');
let events: CollabEvent[] = [];
try { events = ((await api('/workspace/trace-view', { taskId })) as any)?.events ?? []; } catch { events = []; }
const dir = runtime('acceptance', taskId.replace(/[^a-zA-Z0-9_-]/g, '_'));
const files = writeAcceptanceBundle(dir, report, { events });
console.log(JSON.stringify({ taskId, dir, upstream: result.upstream, verdict: report.summary.verdict,
  cases: report.cases.length, files }, null, 2));
