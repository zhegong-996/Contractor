import { isolatedCommand } from '../isolation.ts';
import { codexArguments, readCodex } from './cli.ts';
import type { Adapter } from './protocol.ts';

export default { command: turn => isolatedCommand(turn, codexArguments), read: readCodex } satisfies Adapter;
