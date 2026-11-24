export async function deepSeekModelIds(key: string): Promise<string[]> {
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(8000),
  }).catch(() => { throw new Error('连接 DeepSeek 超时或网络不可用，请检查网络后重试。'); });
  if ([401, 403].includes(response.status)) throw new Error('DeepSeek 拒绝了 API Key，请核对凭据。');
  if (!response.ok) throw new Error('DeepSeek 模型目录暂不可用，请稍后重试。');
  const catalog = await response.json().catch(() => null);
  if (!Array.isArray(catalog?.data)) throw new Error('DeepSeek 未返回模型目录。');
  return [...new Set<string>(catalog.data.flatMap((item: { id?: unknown } | null) =>
    typeof item?.id === 'string' ? [item.id] : []))].sort();
}

/** Check the exact model with the provider, without sending a prompt or project data. */
export async function verifyDeepSeekModel(key: string, model: string | string[]) {
  const ids = await deepSeekModelIds(key);
  const missing = (Array.isArray(model) ? model : [model]).find(id => !ids.includes(id));
  if (missing) throw new Error('此 API Key 的模型目录中没有 ' + missing + '，请核对模型 ID。');
}
