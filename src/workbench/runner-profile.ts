import { z } from 'zod';
import { executionCapabilities } from './execution-capabilities.ts';

export const runnerAgentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  owner: z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/),
  engine: z.enum(['codex', 'claude', 'acp', 'command', 'cursor', 'octop']),
  model: z.string().max(100).optional(),
  execution: z.object({
    kind: z.enum(['sandbox', 'remote', 'test', 'harness']),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/),
    credential: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/).optional(),
    effort: z.enum(['low', 'medium', 'high']).default('low'),
    domains: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/)).max(12).default([]),
  }).strict().optional(),
});
export type RunnerAgent = z.infer<typeof runnerAgentSchema>;
export const runnerOllamaUrl = 'http://127.0.0.1:11434';

export function remoteEngine(agent: RunnerAgent) {
  return executionCapabilities(agent).remote;
}
