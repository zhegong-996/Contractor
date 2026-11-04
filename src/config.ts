import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentSchema = z.object({
  name: z.string(), mode: z.enum(['managed', 'manual']),
  use: z.enum(['codex', 'claude', 'command', 'acp']).default('command'),
  command: z.array(z.string()).optional(), access: z.enum(['read', 'edit']).default('edit'),
  enabled: z.boolean().default(true), model: z.string().optional(), effort: z.string().optional(),
  paperclipId: z.string().optional(),
});
export const configSchema = z.object({
  paperclipUrl: z.string().url().refine(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname), 'Local control plane required'),
  bridgePort: z.number().int().min(1024).max(65535).default(4180),
  companyId: z.string().optional(), projectId: z.string().optional(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  checkout: z.string(), allowedPaths: z.array(z.string()).min(1),
  defaultAgent: z.string(), agents: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), agentSchema),
  feishu: z.object({ profile: z.string(), enabled: z.boolean().default(false), botId: z.string().default(''), appId: z.string().default(''),
    allowedSenders: z.array(z.string()).default([]), allowedChats: z.array(z.string()).default([]) }),
  pollMs: z.number().int().min(1000).default(15000),
});
export type Config = z.infer<typeof configSchema>;
export type Agent = Config['agents'][string];
const stateRoot = process.env.COLLAB_STATE_DIR ?? path.join(root, '.runtime');
export const configPath = process.env.COLLAB_CONFIG ?? path.join(stateRoot, 'config.json');
export function loadConfig(): Config { return configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8'))); }
export function secrets(): { adminToken: string; agentTokens: Record<string, string>; paperclipTokens?: Record<string, string>; jwtSecret: string } {
  return JSON.parse(readFileSync(path.join(stateRoot, 'secrets.json'), 'utf8'));
}
export const runtime = (...parts: string[]) => path.join(stateRoot, ...parts);
