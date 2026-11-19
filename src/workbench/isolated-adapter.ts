import codex from '../../upstream/autoloop/plugins/codex/agent.ts';
import { isolatedCommand } from './isolation.ts';
import { findProgram, type Turn } from '../../upstream/autoloop/worker/agents.ts';
// AutoLoop retains the upstream Codex parser, session usage accounting, cards and lifecycle.
export default {
  command: (turn: Turn) => isolatedCommand(turn, (input, executable) => {
    findProgram('codex', () => [executable]);
    return codex.command(input as Turn);
  }),
  read: codex.read,
};
