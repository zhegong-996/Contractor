// Cognee 原生管线：配置打开、凭据只走进程环境、缺配置明确报错、链路不静默降级。
// 第三十三轮起：embedding 默认本机 fastembed（用户拍板），外部端点是显式回退形态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, configPath, loadConfig, configSchema } from '../src/config.ts';
import { resolveCogneeNative, cogneeNativeStatus, assertCogneeNativeReady,
  cogneeNativeEnv } from '../src/cognee-native.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const config = loadConfig();
const readyEnv = {
  COGNEE_LLM_BASE_URL: 'https://llm.example.test/v1',
  COGNEE_LLM_API_KEY: 'sk-test-only-123',
} as NodeJS.ProcessEnv;
/** 显式回退到外部 embedding 端点时使用的配置（默认 fastembed 不需要端点与凭据）。 */
const customEmbeddingConfig = configSchema.parse(
  { ...JSON.parse(readFileSync(configPath, 'utf8')),
    knowledge: { ...loadConfig().knowledge, cogneeNative: { ...loadConfig().knowledge.cogneeNative,
      embedding: { ...loadConfig().knowledge.cogneeNative.embedding, provider: 'custom' } } } });

test('Cognee 原生管线默认打开，配置里只存环境变量名，embedding 默认本机 fastembed', () => {
  assert.equal(config.knowledge.cogneeNative.enabled, true);
  assert.equal(config.knowledge.cogneeNative.embedding.provider, 'fastembed');
  assert.equal(config.knowledge.cogneeNative.embedding.fastembedModel, 'jinaai/jina-embeddings-v2-base-zh');
  assert.equal(config.knowledge.cogneeNative.embedding.fastembedDimensions, 768);
  assert.match(config.knowledge.cogneeNative.llm.apiKeyEnv, /COGNEE_LLM_API_KEY/);
  assert.match(config.knowledge.cogneeNative.embedding.apiKeyEnv, /COGNEE_EMBEDDING_API_KEY/);
  const raw = readFileSync(configPath, 'utf8');
  assert.doesNotMatch(raw, /sk-test-only-123|sk-embed-test-456/);
});

test('未配置外部 LLM 时只列 LLM 的缺失环境变量名；状态接口不泄露凭据', () => {
  const missing = cogneeNativeStatus(config, {});
  assert.equal(missing.enabled, true);
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['COGNEE_LLM_BASE_URL', 'COGNEE_LLM_API_KEY']);
  assert.equal(missing.embeddingLocal, true);
  assert.equal(missing.embeddingModel, 'jinaai/jina-embeddings-v2-base-zh');
  assert.equal(missing.dimensions, 768);
  const serialized = JSON.stringify(missing);
  assert.doesNotMatch(serialized, /sk-test-only-123|llm\.example\.test/);
  assert.equal(missing.externalApi, true);
  assert.match(missing.privacy, /外部 LLM 服务/);
  assert.match(missing.privacy, /本机 fastembed/);
  assert.throws(() => assertCogneeNativeReady(config, {}), /缺少配置.*COGNEE_LLM_BASE_URL/);
});

test('本机 fastembed：只配 LLM 即就绪，子进程环境不带 embedding 端点与凭据', () => {
  const resolved = resolveCogneeNative(config, readyEnv);
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.embeddingLocal, true);
  assert.equal(resolved.llm.endpoint, 'https://llm.example.test/v1');
  assert.equal(resolved.embedding.model, 'jinaai/jina-embeddings-v2-base-zh');
  assert.equal(resolved.embedding.endpoint, '');
  const ready = assertCogneeNativeReady(config, readyEnv);
  assert.equal(ready.llm.apiKey, 'sk-test-only-123');
  const childEnv = cogneeNativeEnv(ready);
  assert.equal(childEnv.LLM_PROVIDER, 'custom');
  assert.equal(childEnv.LLM_API_KEY, 'sk-test-only-123');
  assert.equal(childEnv.EMBEDDING_PROVIDER, 'fastembed');
  assert.equal(childEnv.EMBEDDING_MODEL, 'jinaai/jina-embeddings-v2-base-zh');
  assert.equal(childEnv.EMBEDDING_DIMENSIONS, '768');
  assert.equal('EMBEDDING_ENDPOINT' in childEnv, false);
  assert.equal('EMBEDDING_API_KEY' in childEnv, false);
  assert.equal(childEnv.DATA_ROOT_DIRECTORY.includes('cognee-native'), true);
  // 模型可用 COGNEE_EMBEDDING_MODEL 覆盖（仍是本机 fastembed 清单里的模型）
  const overridden = resolveCogneeNative(config, { ...readyEnv, COGNEE_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5' } as NodeJS.ProcessEnv);
  assert.equal(overridden.embedding.model, 'BAAI/bge-small-zh-v1.5');
});

test('显式回退 custom：embedding 端点/凭据缺失会列出，未单独配置时复用 LLM 端点与凭据', () => {
  const missing = cogneeNativeStatus(customEmbeddingConfig, {});
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['COGNEE_LLM_BASE_URL', 'COGNEE_LLM_API_KEY',
    'COGNEE_EMBEDDING_BASE_URL', 'COGNEE_EMBEDDING_API_KEY']);
  assert.equal(missing.embeddingLocal, false);
  const resolved = resolveCogneeNative(customEmbeddingConfig, readyEnv);
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.embedding.model, 'openai/text-embedding-3-small');
  assert.equal(resolved.embedding.endpoint, 'https://llm.example.test/v1');
  assert.equal(resolved.embedding.dimensions, 1536);
  const childEnv = cogneeNativeEnv(assertCogneeNativeReady(customEmbeddingConfig, readyEnv));
  assert.equal(childEnv.EMBEDDING_PROVIDER, 'custom');
  assert.equal(childEnv.EMBEDDING_ENDPOINT, 'https://llm.example.test/v1');
  assert.equal(childEnv.EMBEDDING_DIMENSIONS, '1536');
});

test('原生 Python 链路走 LLM 抽取 + cognify，失败明确报错且入口已注册', () => {
  const script = read('scripts/cognee-native.py');
  assert.match(script, /"extractor": "llm"/);
  assert.match(script, /cognee\.cognify/);
  assert.match(script, /cognee\.add/);
  assert.match(script, /cognee\.search/);
  assert.match(script, /except Exception as error/);
  assert.match(script, /ensure_ascii=False/);
  assert.match(read('scripts/cognee-native.ts'), /runCogneeNative/);
  assert.match(read('package.json'), /"cognee:native"/);
  // 设备端语义加权是独立链路，不应被原生管线替换或声称「没有外部调用」。
  assert.match(read('src/config.ts'), /设备端语义加权/);
  assert.match(read('src/server.ts'), /cogneeNative/);
  assert.match(read('src/ontology.ts'), /cogneeNative\.enabled/);
});

test('系统状态如实区分「已配置」与「未就绪」，不再写死外部调用为无', () => {
  const server = read('src/server.ts');
  assert.match(server, /modelApi: cogneeNative\.configured/);
  assert.match(server, /externalLlmCallsNote/);
  const settings = read('plugins/knowledge-workspaces/src/ui/settings.tsx');
  assert.match(settings, /原生知识管线/);
  assert.doesNotMatch(settings, /不调用任何外部或云端模型网关/);
});
