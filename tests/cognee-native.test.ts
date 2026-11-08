// Cognee 原生管线：配置打开、凭据只走进程环境、缺配置明确报错、链路不静默降级。
// 第三十三轮起：embedding 默认本机 fastembed（用户拍板），外部端点是显式回退形态。
// 第三十四轮起：凭据可持久化到 .runtime/cognee-env.json（启动时装载）；图谱投影
// 成功后自动 cognify（autoCognify，用户拍板费用可接受）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, configPath, loadConfig, configSchema } from '../src/config.ts';
import { resolveCogneeNative, cogneeNativeStatus, assertCogneeNativeReady,
  cogneeNativeEnv, triggerAutoCognify, type CogneeNativeConfig } from '../src/cognee-native.ts';

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

test('第三十四轮：autoCognify 默认开、共享数据集默认 suitme-knowledge，状态如实标注', () => {
  assert.equal(config.knowledge.cogneeNative.autoCognify, true);
  assert.equal(config.knowledge.cogneeNative.dataset, 'suitme-knowledge');
  const status = cogneeNativeStatus(config, readyEnv);
  assert.equal(status.autoCognify, true);
  assert.equal(status.dataset, 'suitme-knowledge');
  assert.match(status.privacy, /自动外发/);
  const off = cogneeNativeStatus(configSchema.parse(
    { ...JSON.parse(readFileSync(configPath, 'utf8')),
      knowledge: { ...loadConfig().knowledge, cogneeNative: { ...loadConfig().knowledge.cogneeNative, autoCognify: false } } }), readyEnv);
  assert.equal(off.autoCognify, false);
  assert.doesNotMatch(off.privacy, /自动外发/);
});

test('autoCognify 触发器：未配置凭据 / 开关关闭时如实跳过，不触发外部调用', () => {
  const audits: { event: string; detail: any }[] = [];
  const audit = (event: string, _id: string, detail: any) => audits.push({ event, detail });
  // 凭据未配置（显式空 env，确定性）→ 跳过
  const skipped = triggerAutoCognify(config, { title: 't', body: 'b' }, 'src-1', 'rev-1', audit,
    () => { throw new Error('测试不应触发真实调用'); }, {});
  assert.equal(skipped.triggered, false);
  assert.match(skipped.reason ?? '', /凭据未配置/);
  // 开关关闭 + 凭据就绪 → 跳过并给出关闭原因
  const offConfig = configSchema.parse(
    { ...JSON.parse(readFileSync(configPath, 'utf8')),
      knowledge: { ...loadConfig().knowledge, cogneeNative: { ...loadConfig().knowledge.cogneeNative, autoCognify: false } } });
  const off = triggerAutoCognify(offConfig, { title: 't', body: 'b' }, 'src-1', 'rev-1', audit,
    () => { throw new Error('测试不应触发真实调用'); }, readyEnv);
  assert.equal(off.triggered, false);
  assert.match(off.reason ?? '', /autoCognify 已关闭/);
  assert.equal(audits.length, 0);
});

test('autoCognify 触发器：凭据就绪时后台触发，成功与失败各写一条审计', async () => {
  const audits: { event: string; id: string; detail: any }[] = [];
  const audit = (event: string, id: string, detail: any) => audits.push({ event, id, detail });
  // 注入 fake runner：绝不触发真实外部调用
  const calls: any[] = [];
  const fakeRun = async (_config: any, action: string, payload: any) => {
    calls.push({ action, payload });
    if (calls.length === 1) return { ok: true, documents: 1 };
    throw new Error('模拟外部调用失败');
  };
  const ok = triggerAutoCognify(config, { title: '标题', body: '正文' }, 'src-ok', 'rev-ok', audit, fakeRun as any, readyEnv);
  assert.equal(ok.triggered, true);
  assert.equal(ok.dataset, 'suitme-knowledge');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'cognify');
  assert.match(calls[0].payload.texts[0], /标题[\s\S]*正文/);
  assert.equal(calls[0].payload.dataset, 'suitme-knowledge');
  assert.deepEqual(audits.map(a => a.event), ['knowledge.native-cognified']);
  assert.equal(audits[0].detail.external, true);
  assert.equal(audits[0].detail.revision, 'rev-ok');
  // 第二次：runner 失败 → 失败审计，不抛出
  triggerAutoCognify(config, { title: '标题', body: '正文' }, 'src-bad', 'rev-bad', audit, fakeRun as any, readyEnv);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(audits.map(a => a.event), ['knowledge.native-cognified', 'knowledge.native-cognify-failed']);
  assert.match(audits[1].detail.error, /模拟外部调用失败/);
});

test('第三十四轮：cognee-search 管理端 action 已注册且走只读通道；检索结果结构化', () => {
  const server = read('src/server.ts');
  assert.match(server, /cognee-search/);
  assert.match(server, /workspaces\.manager\(workspaceActor\);\s*\n\s*const query/);
  const python = read('scripts/cognee-native.py');
  assert.match(python, /to_jsonable/);
  const cli = read('scripts/cognee-native.ts');
  assert.match(cli, /persist/);
  assert.match(cli, /positional/);
  // graph.ts 的投影钩子：成功投影后触发，失败不影响投影结果
  const graph = read('src/graph.ts');
  assert.match(graph, /triggerAutoCognify/);
  assert.match(graph, /nativeCognify/);
});

test('凭据持久化：resolve 不读文件（隔离冒烟不经启动装载），装载函数只在启动路径调用', () => {
  // 显式传入的 env 是唯一来源——这正是测试与冒烟的确定性保证
  const resolved: CogneeNativeConfig = resolveCogneeNative(config, {});
  assert.deepEqual(resolved.missing, ['COGNEE_LLM_BASE_URL', 'COGNEE_LLM_API_KEY']);
  const server = read('src/server.ts');
  assert.match(server, /loadPersistedCogneeEnvIntoProcess\(\)/);
  const cli = read('scripts/cognee-native.ts');
  assert.match(cli, /loadPersistedCogneeEnvIntoProcess\(\)/);
  // 凭据文件路径固定在 .runtime（gitignored）
  assert.match(read('src/cognee-native.ts'), /cognee-env\.json/);
});
