/**
 * Cognee 原生管线（LLM 实体抽取 / embedding / cognify / 语义检索）的接入层。
 *
 * 用户 2026-11-07 明确打开此能力，并允许外部 OpenAI-compatible 模型 API。
 * 用户 2026-11-08 拍板分工：LLM 走外部 DeepSeek v4 flash（正文外发做实体抽取），
 * embedding 走本机 fastembed（pinned Cognee venv 自带 CPU 模型，不出本机）。
 * 隐私边界：**业务材料会发往所配置的外部 LLM 服务**；配置里只保存环境变量名，
 * Key 与端点值只在进程环境中传递，绝不写进 .runtime/config.json、secrets.json 或仓库。
 * 未配置时明确报错，不静默降级成设备端能力（设备端语义加权是另一条独立链路）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, type Config } from './config.ts';

interface ModelEndpoint { endpoint: string; apiKey: string; model: string }

export interface CogneeNativeConfig {
  enabled: boolean;
  /** embedding 是本机 fastembed（true）还是外部端点（false）。 */
  embeddingLocal: boolean;
  llm: ModelEndpoint;
  embedding: ModelEndpoint & { dimensions: number };
  /** 缺失的环境变量名（不是值），供界面给出可照做的提示。 */
  missing: string[];
}

const value = (env: NodeJS.ProcessEnv, name: string) => (env[name] ?? '').trim();

export function resolveCogneeNative(config: Config, env: NodeJS.ProcessEnv = process.env): CogneeNativeConfig {
  const native = config.knowledge.cogneeNative;
  const llmBase = value(env, native.llm.baseUrlEnv);
  const llmKey = value(env, native.llm.apiKeyEnv);
  const embeddingLocal = native.embedding.provider === 'fastembed';
  const missing: string[] = [];
  if (!llmBase) missing.push(native.llm.baseUrlEnv);
  if (!llmKey) missing.push(native.llm.apiKeyEnv);
  if (embeddingLocal) {
    // 本机 fastembed：无端点无凭据，模型可用环境变量覆盖，否则用本机默认。
    return {
      enabled: native.enabled,
      embeddingLocal: true,
      llm: { endpoint: llmBase, apiKey: llmKey, model: value(env, native.llm.modelEnv) || native.llm.defaultModel },
      embedding: { endpoint: '', apiKey: '',
        model: value(env, native.embedding.modelEnv) || native.embedding.fastembedModel,
        dimensions: native.embedding.fastembedDimensions },
      missing: [...new Set(missing)],
    };
  }
  // embedding 未单独配置时复用 LLM 的端点与凭据（Cognee .env.template 同样的约定）。
  const embeddingBase = value(env, native.embedding.baseUrlEnv) || llmBase;
  const embeddingKey = value(env, native.embedding.apiKeyEnv) || llmKey;
  if (!embeddingBase) missing.push(native.embedding.baseUrlEnv);
  if (!embeddingKey) missing.push(native.embedding.apiKeyEnv);
  return {
    enabled: native.enabled,
    embeddingLocal: false,
    llm: { endpoint: llmBase, apiKey: llmKey, model: value(env, native.llm.modelEnv) || native.llm.defaultModel },
    embedding: { endpoint: embeddingBase, apiKey: embeddingKey,
      model: value(env, native.embedding.modelEnv) || native.embedding.defaultModel, dimensions: native.embedding.dimensions },
    missing: [...new Set(missing)],
  };
}

/** 只返回布尔与模型名，绝不返回 Key 或端点值。 */
export function cogneeNativeStatus(config: Config, env: NodeJS.ProcessEnv = process.env) {
  const resolved = resolveCogneeNative(config, env);
  return {
    enabled: resolved.enabled,
    configured: resolved.enabled && resolved.missing.length === 0,
    missing: resolved.missing,
    llmModel: resolved.llm.model,
    embeddingModel: resolved.embedding.model,
    embeddingLocal: resolved.embeddingLocal,
    dimensions: resolved.embedding.dimensions,
    extractor: 'llm' as const,
    externalApi: true,
    privacy: resolved.embeddingLocal
      ? '业务材料会发往所配置的外部 LLM 服务做实体抽取；embedding 在本机 fastembed 运行，不出本机'
      : '业务材料会发往所配置的外部模型服务',
  };
}

export function assertCogneeNativeReady(config: Config, env: NodeJS.ProcessEnv = process.env): CogneeNativeConfig {
  const resolved = resolveCogneeNative(config, env);
  if (!resolved.enabled) throw new Error('Cognee 原生管线未启用；请在 .runtime/config.json 打开 knowledge.cogneeNative.enabled');
  if (resolved.missing.length)
    throw new Error(`Cognee 原生管线缺少配置：${resolved.missing.join('、')}。请在进程环境中设置这些环境变量（凭据不写入 .runtime 或仓库）`);
  return resolved;
}

/** 传给 Cognee Python 进程的环境变量；Key 只在这里出现在内存中。 */
export function cogneeNativeEnv(resolved: CogneeNativeConfig): Record<string, string> {
  const data = runtime('cognee-native', 'data');
  const system = runtime('cognee-native', 'system');
  mkdirSync(data, { recursive: true });
  mkdirSync(system, { recursive: true });
  const embedding: Record<string, string> = resolved.embeddingLocal
    // 本机 fastembed：不传端点与凭据，provider 直接落在本地引擎上。
    ? { EMBEDDING_PROVIDER: 'fastembed', EMBEDDING_MODEL: resolved.embedding.model,
        EMBEDDING_DIMENSIONS: String(resolved.embedding.dimensions) }
    : { EMBEDDING_PROVIDER: 'custom', EMBEDDING_ENDPOINT: resolved.embedding.endpoint,
        EMBEDDING_API_KEY: resolved.embedding.apiKey, EMBEDDING_MODEL: resolved.embedding.model,
        EMBEDDING_DIMENSIONS: String(resolved.embedding.dimensions) };
  return {
    TELEMETRY_DISABLED: '1',
    LLM_PROVIDER: 'custom', LLM_ENDPOINT: resolved.llm.endpoint, LLM_API_KEY: resolved.llm.apiKey, LLM_MODEL: resolved.llm.model,
    ...embedding,
    DATA_ROOT_DIRECTORY: data, SYSTEM_ROOT_DIRECTORY: system,
  };
}

export type CogneeNativeAction = 'status' | 'cognify' | 'search';

/** 调用 pinned Cognee venv 里的原生管线；失败返回明确中文错误，不静默降级。 */
export async function runCogneeNative(config: Config, action: CogneeNativeAction,
  payload: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, any>> {
  const python = runtime('cognee-venv', 'bin', 'python');
  if (!existsSync(python)) throw new Error('Cognee 尚未安装，请运行 npm run setup:graph');
  const resolved = action === 'status' ? null : assertCogneeNativeReady(config, env);
  const child = spawn(python, [path.join(root, 'scripts', 'cognee-native.py'), action], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env, ...(resolved ? cogneeNativeEnv(resolved) : {}) },
  });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  child.stdin.end(JSON.stringify(payload));
  const code = await new Promise<number>(resolve => child.on('close', resolve));
  let parsed: Record<string, any>;
  try { parsed = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1) ?? '{}'); }
  catch { throw new Error(`Cognee 原生管线没有返回可解析结果（exit ${code}）：${(err || out).slice(0, 300)}`); }
  if (code !== 0 || parsed.ok === false)
    throw new Error(`Cognee ${action} 失败：${String(parsed.error ?? err).slice(0, 300)}`);
  return parsed;
}
