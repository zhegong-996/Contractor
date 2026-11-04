import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function command(program: string, args: string[], cwd?: string, input?: string): Promise<string> {
  const child = execute(program, args, { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } });
  if (input !== undefined) child.child.stdin?.end(input);
  try { return (await child).stdout; }
  catch (error) { const e = error as Error & { stderr?: string }; throw new Error((e.stderr || e.message).slice(-1600)); }
}
