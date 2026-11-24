import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runtime } from '../../config.ts';
import { verifyDeepSeekModel } from '../deepseek-catalog.ts';
import type { AssistantService } from '../platform-assistant.ts';

export function textAssistant(): AssistantService {
  const file = runtime('assistant-deepseek.private.json');
  type Connection = { model: string; key?: string; revision: string };
  let saved: Connection | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const envKey = () => process.env.CONTRACTOR_DEEPSEEK_API_KEY?.trim();
  const key = () => envKey() || saved?.key;
  return {
    personalReply: 'text',
    connection: {
      status: () => ({ model: saved?.model, environmentKey: !!envKey(), revision: saved?.revision ?? 'initial' }),
      async verify(model, input) {
        if (envKey() && input) throw new Error('部署环境已管理此凭据，请使用现有凭据验证。');
        const token = input || key();
        if (!token) throw new Error('请填写 DeepSeek API Key。');
        await verifyDeepSeekModel(token, model);
        return () => {
          const next = { revision: randomUUID(), model, key: envKey() ? undefined : token };
          const temporary = file + '.' + next.revision;
          writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, file);
          saved = next;
        };
      },
    },
    available: provider => provider === 'ollama' || !!key(),
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
