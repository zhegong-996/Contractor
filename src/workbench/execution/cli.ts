import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { Adapter, Reading, Turn, Usage } from './protocol.ts';

export function executable(name: string, alternatives: string[] = []) {
  const paths = (process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute);
  for (const file of [...paths.map(directory => path.join(directory, name)), ...alternatives]) {
    try { accessSync(file, constants.X_OK); return file; } catch { /* Try the next installation. */ }
  }
  throw new Error('执行机未找到 ' + name);
}

export function codexProgram() {
  return executable('codex', [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  ]);
}

export function codexArguments(turn: Turn, program: string) {
  const sandbox = turn.access === 'full' ? 'danger-full-access' : turn.access === 'edit' ? 'workspace-write' : 'read-only';
  return [program, 'exec', ...(turn.resume ? ['resume'] : []), '--json', '--skip-git-repo-check',
    '-c', 'approval_policy="never"', '-c', 'sandbox_mode=' + JSON.stringify(sandbox),
    ...(turn.model ? ['--model', turn.model] : []),
    ...(turn.effort ? ['-c', 'model_reasoning_effort=' + JSON.stringify(turn.effort)] : []),
    ...(turn.resume ? [turn.resume] : []), turn.prompt];
}

const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length ? value : undefined;
function jsonLines(stdout: string): any[] {
  const output = [];
  for (const line of stdout.split('\n')) {
    try {
      const value = JSON.parse(line);
      if (Array.isArray(value)) output.push(...value.filter(item => item && typeof item === 'object'));
      else if (value && typeof value === 'object') output.push(value);
    } catch { /* Stream may contain a partial last line or CLI diagnostics. */ }
  }
  return output;
}

export function readCodex(stdout: string, code: number | null): Reading {
  const events = jsonLines(stdout);
  const result = events.findLast(event => event.type === 'turn.completed' || event.type === 'turn.failed');
  const output = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  const counters = result?.usage;
  const usage = counters && {
    input: number(counters.input_tokens), output: number(counters.output_tokens), cached: number(counters.cached_input_tokens),
  } satisfies Usage;
  const text = result?.type === 'turn.completed' && code === 0 ? string(output?.item?.text) : undefined;
  return { session: string(events.find(event => event.type === 'thread.started')?.thread_id),
    started: events.some(event => event.type === 'turn.started'), finished: !!result, sessionUsage: usage, text,
    ...(code !== null && !text && { error: 'Codex 未完整交付本轮成果' }) };
}

/** Codex reports the session total, including turns completed before a resume. */
export function codexAttemptUsage(reading: Reading, resumed: string | null, baseline?: Usage): Usage | undefined {
  const total = reading.sessionUsage;
  if (!total || !reading.session) return;
  if (reading.session !== resumed) return total;
  if (!baseline) return;
  const delta: Usage = {};
  for (const key of ['input', 'output', 'cached'] as const) {
    const current = total[key];
    const earlier = baseline[key];
    if (current !== undefined && earlier !== undefined && current >= earlier) delta[key] = current - earlier;
  }
  return Object.keys(delta).length ? delta : undefined;
}

const headerOnly = /^(?:#{1,6}\s+)?(?:\*\*)?(?:conclusion|结论|建议)[:：]?(?:\*\*)?$/i;
export function readClaude(stdout: string, code: number | null): Reading {
  const events = jsonLines(stdout);
  const event = events.findLast(item => item.type === 'result');
  const raw = typeof event?.result === 'string' ? event.result.trim() : '';
  const [first, ...rest] = raw.split(/\r?\n/);
  const body = headerOnly.test(first ?? '') ? rest.join('\n').trimStart() : raw;
  const counters = event?.usage;
  const cacheRead = number(counters?.cache_read_input_tokens);
  const cacheWrite = number(counters?.cache_creation_input_tokens);
  const usage = counters && {
    input: number(counters.input_tokens), output: number(counters.output_tokens),
    cached: cacheRead === undefined && cacheWrite === undefined ? undefined : (cacheRead ?? 0) + (cacheWrite ?? 0),
  } satisfies Usage;
  const completed = code === 0 && event?.subtype === 'success' && !event.is_error && !!body
    && !events.slice(events.lastIndexOf(event) + 1).some(item => item.type === 'user' || item.type === 'assistant');
  return { session: string(event?.session_id ?? events.find(item => item.session_id)?.session_id),
    started: events.some(item => item.type === 'assistant' || item.subtype === 'init'), usage, finished: !!event,
    ...(completed ? { text: body } : code === null ? {} : { error: raw && !body ? 'Claude 只返回了标题，未给出可交付内容' : 'Claude Code 未完整交付本轮成果' }) };
}

export const commandAdapter: Adapter = {
  command(turn) {
    if (!turn.command?.length) throw new Error('缺少可信的执行命令');
    return turn.command.map(argument => argument.replaceAll('{context}', turn.contextFile).replaceAll('{prompt}', turn.prompt));
  },
  read: (stdout, code) => code === 0 ? { text: stdout, finished: true } : { error: '执行命令没有成功结束' },
};
