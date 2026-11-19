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

export function claudeRunnerEnvironment(provider: string | undefined) {
  if (provider === 'ollama') return { ANTHROPIC_BASE_URL: runnerOllamaUrl, ANTHROPIC_AUTH_TOKEN: 'ollama' };
  if (provider !== 'deepseek') throw new Error('不支持的 Claude Code 模型服务');
  const endpoint = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!endpoint || !/^https:\/\/api\.deepseek\.com\/anthropic\/?$/.test(endpoint) || !token?.trim())
    throw new Error('请在此执行端配置 DeepSeek 的 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN');
  return { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: token };
}

export async function checkClaudeRunnerModel(profile: RunnerAgent) {
  const provider = profile.execution?.provider;
  const env = claudeRunnerEnvironment(provider);
  if (provider !== 'ollama') return;
  const listing = await fetch(env.ANTHROPIC_BASE_URL + '/api/tags', { signal: AbortSignal.timeout(3500), redirect: 'error' })
    .then(response => response.ok ? response.json() : undefined).catch(() => undefined);
  const available = z.object({ models: z.array(z.object({ name: z.string() })) }).safeParse(listing);
  if (!available.success || !available.data.models.some(item => item.name === profile.model))
    throw new Error('请启动此设备的 Ollama 并准备模型 ' + profile.model + '，再次连接执行端');
}

export function remoteEngine(agent: RunnerAgent) {
  return executionCapabilities(agent).remote;
}
