import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { api } from './client.ts';
const [action, id, value, ...rest] = process.argv.slice(2);
const agent = process.env.COLLAB_AGENT;
let result: unknown;
if (action === 'tasks') result = await api('/tasks', undefined, agent);
else if (action === 'task' && id) result = await api(`/tasks/${id}`, undefined, agent);
else if (action === 'claim' && id) result = await api(`/tasks/${id}/claim`, { agent: agent ?? value, lease: process.env.COLLAB_LEASE ?? randomUUID() }, agent);
else if (action === 'receipt' && id && value) result = await api(`/tasks/${id}/receipt`, JSON.parse(await readFile(value, 'utf8')), agent);
else if (['publish', 'sync', 'preview', 'reconcile'].includes(action ?? '') && id) result = await api(`/tasks/${id}/${action}`, {}, agent);
else if (action === 'handoff' && id && value) result = await api(`/tasks/${id}/handoff`, { agent: value });
else if (action === 'reply' && id && value) result = await api(`/tasks/${id}/reply`, { text: [value, ...rest].join(' ') });
else if (action === 'accept' && id && value) result = await api(`/tasks/${id}/accept`, { sha: value, cases: rest.map(name => ({ name, passed: true })) });
else { console.log('tasks | task ID | claim ID AGENT | receipt ID FILE | publish ID | sync ID | preview ID | handoff ID AGENT | reply ID TEXT | accept ID SHA CASE...'); process.exit(action ? 1 : 0); }
console.log(JSON.stringify(result, null, 2));
