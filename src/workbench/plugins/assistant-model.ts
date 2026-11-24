import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runtime } from '../../config.ts';
import { deepSeekModelIds, verifyDeepSeekModel } from '../deepseek-catalog.ts';
import type { AssistantService } from '../platform-assistant.ts';

export function textAssistant(): AssistantService {
  const file = runtime('assistant-deepseek.private.json');
  type Connection = { model?: string; models?: string[]; disconnected?: boolean; key?: string; revision: string };
  let saved: Connection | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const envKey = () => process.env.CONTRACTOR_DEEPSEEK_API_KEY?.trim();
  const key = () => envKey() || saved?.key;
  function resolveKey(input?: string) {
    if (envKey() && input) throw new Error('部署环境已管理此凭据，请使用现有凭据验证。');
    const token = input || key();
    if (!token) throw new Error('请填写 DeepSeek API Key。');
    return token;
  }
  function persist(value: Omit<Connection, 'revision'>) {
    const next = { ...value, revision: randomUUID() };
    const temporary = file + '.' + next.revision;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
    saved = next;
  }
  return {
    personalReply: 'text',
    connection: {
      status: () => ({ model: saved?.model, models: saved?.models, disconnected: saved?.disconnected, environmentKey: !!envKey(), revision: saved?.revision ?? 'initial' }),
      catalog: async input => deepSeekModelIds(resolveKey(input)),
      disconnect: () => persist({ disconnected: true }),
      async verify(model, input, models) {
        const token = resolveKey(input);
        await verifyDeepSeekModel(token, models ?? model);
        return () => persist({ model, models, key: envKey() ? undefined : token });
      },
    },
    available: provider => provider === 'ollama' || (!saved?.disconnected && !!key()),
    async complete({ provider, model, purpose, system, evidence }) {
      const deepseek = provider === 'deepseek';
      const response = await fetch(deepseek ? 'https://api.deepseek.com/chat/completions' : 'http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { 'content-type': 'application/json', ...(deepseek ? { authorization: 'Bearer ' + key() } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: evidence }],
          max_tokens: 1600, stream: false, ...(purpose !== 'personal' && { response_format: { type: 'json_object' } }), ...(deepseek && { thinking: { type: 'disabled' } }) }),
      });
      if (!response.ok) throw new Error('模型服务没有完成整理');
      return response.json();
    },
  };
}
