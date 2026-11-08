/**
 * Cognee 原生管线（LLM 实体抽取 / embedding / cognify / 语义检索）的接入层。
 *
 * 用户 2026-11-07 明确打开此能力，并允许外部 OpenAI-compatible 模型 API。
 * 用户 2026-11-08 拍板分工：LLM 走外部 DeepSeek v4 flash（正文外发做实体抽取），
 * embedding 走本机 fastembed（pinned Cognee venv 自带 CPU 模型，不出本机）。
 * 隐私边界：**业务材料会发往所配置的外部 LLM 服务**；配置里只保存环境变量名。
 * 凭据来源（第三十四轮起，用户拍板「key 持久化」）：进程环境优先；
 * `.runtime/cognee-env.json`（gitignored、0600）作为本机持久化兜底，由
 * server / CLI 启动时装载进进程环境——resolve 本身不读文件，测试与隔离
 * 冒烟不经启动装载路径，因此不会意外读到真实凭据触发真实外部调用。
 * 未配置时明确报错，不静默降级成设备端能力（设备端语义加权是另一条独立链路）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
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
  const persisted = readPersistedCogneeEnv();
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
    autoCognify: config.knowledge.cogneeNative.autoCognify,
    dataset: config.knowledge.cogneeNative.dataset,
    credentialsPersisted: Object.keys(persisted).length > 0,
    credentialsSource: Object.keys(persisted).length
      ? '进程环境（server / CLI 启动时会把 .runtime/cognee-env.json 装载进来；显式设置的进程环境优先）'
      : '进程环境',
    privacy: resolved.embeddingLocal
      ? (config.knowledge.cogneeNative.autoCognify
        ? '业务材料会发往所配置的外部 LLM 服务做实体抽取（含图谱投影成功后的自动外发）；embedding 在本机 fastembed 运行，不出本机'
        : '业务材料会发往所配置的外部 LLM 服务做实体抽取；embedding 在本机 fastembed 运行，不出本机')
      : '业务材料会发往所配置的外部模型服务',
  };
}

export function assertCogneeNativeReady(config: Config, env: NodeJS.ProcessEnv = process.env): CogneeNativeConfig {
  const resolved = resolveCogneeNative(config, env);
  if (!resolved.enabled) throw new Error('Cognee 原生管线未启用；请在 .runtime/config.json 打开 knowledge.cogneeNative.enabled');
  if (resolved.missing.length)
    throw new Error(`Cognee 原生管线缺少配置：${resolved.missing.join('、')}。请在进程环境设置这些变量，或用 cognee:native persist 写入本机凭据文件（.runtime/cognee-env.json，不入库）`);
  return resolved;
}

/** 本机凭据持久化文件（gitignored；第三十四轮用户拍板「key 持久化」落地）。 */
export const cogneeEnvFile = () => runtime('cognee-env.json');

export function readPersistedCogneeEnv(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cogneeEnvFile(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);
    return Object.fromEntries(entries);
  } catch { return {}; }
}

/** 把持久化凭据装载进进程环境（已设的变量不覆盖）。只在 server / CLI 启动时调用。 */
export function loadPersistedCogneeEnvIntoProcess(env: NodeJS.ProcessEnv = process.env): string[] {
  const persisted = readPersistedCogneeEnv();
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(persisted)) {
    if (!(env[key] ?? '').trim()) { env[key] = value; loaded.push(key); }
  }
  return loaded;
}

/** 写入 / 合并本机凭据文件（0600）。值只进 .runtime/cognee-env.json，不进仓库。 */
export function persistCogneeEnv(values: Record<string, string>): Record<string, string> {
  const merged = { ...readPersistedCogneeEnv(), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.length > 0)) };
  writeFileSync(cogneeEnvFile(), JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  return merged;
}

/** 删除本机凭据文件（忘记凭据）。 */
export function forgetPersistedCogneeEnv(): boolean {
  try { unlinkSync(cogneeEnvFile()); return true; } catch { return false; }
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

/** cognify 在进程内串行排队：lancedb / DeepSeek 调用不并发，失败不阻断队列后续。 */
let cognifyQueue: Promise<unknown> = Promise.resolve();

/**
 * 调用 pinned Cognee venv 里的原生管线；失败返回明确中文错误，不静默降级。
 * 默认 10 分钟超时（真实外部调用可能较慢；挂死会被 SIGTERM 终止并如实报错）。
 */
export async function runCogneeNative(config: Config, action: CogneeNativeAction,
  payload: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env,
  options: { timeoutMs?: number } = {}): Promise<Record<string, any>> {
  const exec = async () => {
    const python = runtime('cognee-venv', 'bin', 'python');
    if (!existsSync(python)) throw new Error('Cognee 尚未安装，请运行 npm run setup:graph');
    const resolved = action === 'status' ? null : assertCogneeNativeReady(config, env);
    const child = spawn(python, [path.join(root, 'scripts', 'cognee-native.py'), action], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, ...(resolved ? cogneeNativeEnv(resolved) : {}) },
    });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, options.timeoutMs ?? 600000);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.stdin.end(JSON.stringify(payload));
    const code = await new Promise<number>(resolve => child.on('close', resolve));
    clearTimeout(timer);
    if (timedOut) throw new Error(`Cognee ${action} 超时（${Math.round((options.timeoutMs ?? 600000) / 1000)} 秒）被终止；请重试`);
    let parsed: Record<string, any>;
    try { parsed = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1) ?? '{}'); }
    catch { throw new Error(`Cognee 原生管线没有返回可解析结果（exit ${code}）：${(err || out).slice(0, 300)}`); }
    if (code !== 0 || parsed.ok === false)
      throw new Error(`Cognee ${action} 失败：${String(parsed.error ?? err).slice(0, 300)}`);
    return parsed;
  };
  if (action !== 'cognify') return exec();
  const queued = cognifyQueue.then(exec, exec);
  cognifyQueue = queued.catch(() => {});
  return queued;
}

/**
 * 图谱投影成功后的自动 cognify（用户 2026-11-08 拍板：费用可接受，默认开）。
 * 发后即忘：L1 零模型投影主链路不受影响；成功 / 失败都写审计，失败不重试不回滚。
 * runner 可注入以便测试（测试绝不触发真实外部调用）。
 */
export function triggerAutoCognify(config: Config, source: { title?: unknown; body?: unknown },
  sourceId: string, revision: string,
  audit: (event: string, id: string, detail: Record<string, unknown>) => void,
  run: typeof runCogneeNative = runCogneeNative,
  env: NodeJS.ProcessEnv = process.env): { triggered: boolean; dataset?: string; reason?: string } {
  const native = config.knowledge.cogneeNative;
  if (!native.enabled) return { triggered: false, reason: 'cogneeNative 未启用' };
  if (!native.autoCognify) return { triggered: false, reason: 'autoCognify 已关闭（.runtime/config.json knowledge.cogneeNative.autoCognify）' };
  const resolved = resolveCogneeNative(config, env);
  if (resolved.missing.length) return { triggered: false, reason: `凭据未配置（${resolved.missing.join('、')}）` };
  const text = `${String(source.title ?? '')}\n\n${String(source.body ?? '')}`.trim();
  if (!text) return { triggered: false, reason: '来源正文为空' };
  const dataset = native.dataset;
  void run(config, 'cognify', { texts: [text], dataset })
    .then(result => audit('knowledge.native-cognified', sourceId, { revision, engine: 'cognee-native',
      external: true, dataset, documents: Number(result.documents ?? 1), llmModel: resolved.llm.model,
      embeddingLocal: resolved.embeddingLocal }))
    .catch(error => audit('knowledge.native-cognify-failed', sourceId, { revision, dataset,
      error: String((error as Error)?.message ?? error).slice(0, 300) }));
  return { triggered: true, dataset };
}
