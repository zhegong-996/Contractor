import path from 'node:path';
import claude from '../../upstream/autoloop/plugins/claude/agent.ts';
import type { Adapter } from '../../upstream/autoloop/worker/agents.ts';
import { root } from '../config.ts';
import { runnerOllamaUrl } from './config.ts';

/** This read-only Claude deployment uses local Ollama and receives assembled text through stdin. */
export default {
  command(turn) {
    if (turn.access !== 'read') throw new Error('Claude 远程执行端只接只读委托');
    const [executable, , , ...options] = claude.command(turn);
    const permission = options.indexOf('--permission-mode');
    if (permission >= 0) options[permission + 1] = 'dontAsk';
    return [process.execPath, path.join(root, 'src/workbench/claude-runner-launch.mjs'),
      turn.contextFile, turn.prompt.replaceAll(turn.contextFile, '随本轮输入提供的上下文'), runnerOllamaUrl, executable!, '-p', ...options,
      '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--disable-slash-commands', '--no-chrome', '--setting-sources', '', '--permission-prompts', 'none'];
  },
  read(stdout, code, stderr) {
    const { sessionUsage: _estimatedPrice, ...reading } = claude.read(stdout, code, stderr);
    return reading;
  },
} satisfies Adapter;
