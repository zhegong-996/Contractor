import path from 'node:path';
import claude from '../../upstream/autoloop/plugins/claude/agent.ts';
import type { Adapter } from '../../upstream/autoloop/worker/agents.ts';
import { root } from '../config.ts';

const emptyHeading = /^(?:#{1,6}[ \t]+)?(?:\*\*)?(?:conclusion|结论|建议)[：:]?(?:\*\*)?$/i;

/** Reuse AutoLoop's Claude adapter while giving it a usable first line. */
export function claudeRunnerAdapter(provider: string): Adapter {
  return {
    command(turn) {
      if (turn.access !== 'read') throw new Error('Claude 远程执行端只接只读委托');
      const [executable, , , ...options] = claude.command(turn);
      const permission = options.indexOf('--permission-mode');
      if (permission >= 0) options[permission + 1] = 'dontAsk';
      return [process.execPath, path.join(root, 'src/workbench/claude-runner-launch.mjs'),
        turn.contextFile, turn.prompt.replaceAll(turn.contextFile, '随本轮输入提供的上下文'), provider, executable!, '-p', ...options,
        '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--disable-slash-commands', '--no-chrome', '--setting-sources', '', '--permission-prompts', 'none',
        ...(provider === 'deepseek' ? ['--safe-mode'] : [])];
    },
    read(stdout, code, stderr) {
      const { sessionUsage: _estimatedPrice, text, ...reading } = claude.read(stdout, code, stderr);
      if (text === undefined) return reading;
      const lines = text.trimStart().split(/\r?\n/);
      if (!emptyHeading.test(lines[0]!.trim())) return { ...reading, text };
      const body = lines.slice(1).join('\n').trimStart();
      return body ? { ...reading, text: body } : { ...reading, error: 'Claude 只返回了标题，未给出可交付内容' };
    },
  };
}
