import type { AssistantService } from '../platform-assistant.ts';

export function textAssistant(): AssistantService {
  return {
    available: provider => provider === 'ollama' || !!process.env.CONTRACTOR_DEEPSEEK_API_KEY?.trim(),
    async complete({ provider, model, system, evidence }) {
      const deepseek = provider === 'deepseek';
      const response = await fetch(deepseek ? 'https://api.deepseek.com/chat/completions' : 'http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { 'content-type': 'application/json', ...(deepseek ? { authorization: 'Bearer ' + process.env.CONTRACTOR_DEEPSEEK_API_KEY } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: evidence }],
          max_tokens: 1600, stream: false, response_format: { type: 'json_object' }, ...(deepseek && { thinking: { type: 'disabled' } }) }),
      });
      if (!response.ok) throw new Error('模型服务没有完成整理');
      return response.json();
    },
  };
}
