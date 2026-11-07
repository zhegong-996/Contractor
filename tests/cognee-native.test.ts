// Cognee 原生管线：配置打开、凭据只走进程环境、缺配置明确报错、链路不静默降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, configPath, loadConfig } from '../src/config.ts';
import { resolveCogneeNative, cogneeNativeStatus, assertCogneeNativeReady,
  cogneeNativeEnv } from '../src/cognee-native.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const config = loadConfig();
const readyEnv = {
  COGNEE_LLM_BASE_URL: 'https://llm.example.test/v1',
  COGNEE_LLM_API_KEY: 'sk-test-only-123',
  COGNEE_EMBEDDING_BASE_URL: 'https://embed.example.test/v1',
  COGNEE_EMBEDDING_API_KEY: 'sk-embed-test-456',
} as NodeJS.ProcessEnv;

test('Cognee 原生管线默认打开，配置里只存环境变量名', () => {
  assert.equal(config.knowledge.cogneeNative.enabled, true);
  assert.match(config.knowledge.cogneeNative.llm.apiKeyEnv, /COGNEE_LLM_API_KEY/);
  assert.match(config.knowledge.cogneeNative.embedding.apiKeyEnv, /COGNEE_EMBEDDING_API_KEY/);
  const raw = readFileSync(configPath, 'utf8');
  assert.doesNotMatch(raw, /sk-test-only-123|sk-embed-test-456/);
});

test('未配置外部模型时列出缺失的环境变量名，状态接口不泄露凭据', () => {
  const missing = cogneeNativeStatus(config, {});
  assert.equal(missing.enabled, true);
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['COGNEE_LLM_BASE_URL', 'COGNEE_LLM_API_KEY',
    'COGNEE_EMBEDDING_BASE_URL', 'COGNEE_EMBEDDING_API_KEY']);
  const serialized = JSON.stringify(missing);
  assert.doesNotMatch(serialized, /sk-test-only-123|llm\.example\.test/);
  assert.equal(missing.externalApi, true);
  assert.match(missing.privacy, /外部模型服务/);
  assert.throws(() => assertCogneeNativeReady(config, {}), /缺少配置.*COGNEE_LLM_BASE_URL/);
});

test('配置齐全时解析出端点 / 模型，并把凭据只放进子进程环境', () => {
  const resolved = resolveCogneeNative(config, readyEnv);
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.llm.endpoint, 'https://llm.example.test/v1');
  assert.equal(resolved.embedding.model, 'openai/text-embedding-3-small');
  const ready = assertCogneeNativeReady(config, readyEnv);
  assert.equal(ready.llm.apiKey, 'sk-test-only-123');
  const childEnv = cogneeNativeEnv(ready);
  assert.equal(childEnv.LLM_PROVIDER, 'custom');
  assert.equal(childEnv.LLM_API_KEY, 'sk-test-only-123');
  assert.equal(childEnv.EMBEDDING_PROVIDER, 'custom');
  assert.equal(childEnv.DATA_ROOT_DIRECTORY.includes('cognee-native'), true);
  // embedding 未单独配置时复用 LLM 端点与凭据
  const reused = resolveCogneeNative(config, {
    COGNEE_LLM_BASE_URL: 'https://llm.example.test/v1', COGNEE_LLM_API_KEY: 'sk-test-only-123',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(reused.missing, []);
  assert.equal(reused.embedding.endpoint, 'https://llm.example.test/v1');
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
  assert.match(settings, /Cognee 原生管线/);
  assert.doesNotMatch(settings, /不调用任何外部或云端模型网关/);
});
