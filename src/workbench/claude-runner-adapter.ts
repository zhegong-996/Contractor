import path from 'node:path';
import { executable, readClaude } from './execution/cli.ts';
import { homedir } from 'node:os';
import type { Adapter } from './execution/protocol.ts';
import { root } from '../config.ts';

export function claudeRunnerAdapter(provider: string): Adapter {
  return {
    command(turn) {
      if (turn.access !== 'read') throw new Error('Claude 远程执行端只接只读委托');
      const program = executable('claude', [path.join(homedir(), '.local/bin/claude')]);
      return [process.execPath, path.join(root, 'src/workbench/claude-runner-launch.mjs'),
        turn.contextFile, turn.prompt.replaceAll(turn.contextFile, '随本轮输入提供的上下文'), provider, program, '-p',
        '--output-format', 'stream-json', '--verbose',
        ...(turn.resume ? ['--resume', turn.resume] : ['--session-id', turn.session]),
        ...(turn.model ? ['--model', turn.model] : []), ...(turn.effort ? ['--effort', turn.effort] : []),
        '--permission-mode', 'dontAsk', '--add-dir', turn.folder,
        '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--disable-slash-commands', '--no-chrome', '--setting-sources', '', '--permission-prompts', 'none',
        ...(provider === 'deepseek' ? ['--safe-mode'] : [])];
    },
    read: readClaude,
  };
}
