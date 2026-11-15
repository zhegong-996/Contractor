import codex from '../../upstream/autoloop/plugins/codex/agent.ts';
import { isolatedCommand } from './isolation.ts';
import type { Turn } from '../../upstream/autoloop/worker/agents.ts';
// AutoLoop retains the upstream Codex parser, session usage accounting, cards and lifecycle.
export default { command: (turn: Turn) => isolatedCommand(turn, codex.command), read: codex.read };
