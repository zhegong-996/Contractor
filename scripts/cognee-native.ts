/** Cognee 原生管线 CLI：状态 / cognify / 语义检索 / 凭据持久化。
 * 凭据优先从进程环境读取；`.runtime/cognee-env.json`（gitignored、0600）兜底。
 * 用法：
 *   npm run cognee:native status
 *   npm run cognee:native -- cognify --text "正文" [--dataset 名称]        （-- 把参数完整传给脚本）
 *   npm run cognee:native cognify "正文"                                   （位置参数写法，不需要 --）
 *   npm run cognee:native -- search --query "问题" [--dataset 名称]
 *   npm run cognee:native search "问题"
 *   npm run cognee:native -- persist --base-url URL --api-key KEY [--model 模型]
 *   npm run cognee:native forget
 */
import { loadConfig } from '../src/config.ts';
import { cogneeNativeStatus, runCogneeNative, loadPersistedCogneeEnvIntoProcess,
  persistCogneeEnv, forgetPersistedCogneeEnv, readPersistedCogneeEnv } from '../src/cognee-native.ts';

const [action = 'status', ...rest] = process.argv.slice(2);
// 启动即装载本机凭据文件（进程环境已设的变量优先，不会被覆盖）。
loadPersistedCogneeEnvIntoProcess();
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
/** 位置参数兜底：npm 不加 -- 会吞掉 --text 这类旗标，但纯文本位置参数能透传。 */
const positional = () => rest.find(arg => !arg.startsWith('--') && arg !== action);
const config = loadConfig();

if (action === 'status') {
  console.log(JSON.stringify(cogneeNativeStatus(config), null, 2));
} else if (action === 'cognify') {
  const text = option('--text') ?? positional();
  if (!text) { console.error('用法：cognee:native -- cognify --text "要抽取的正文" [--dataset 名称] [--ontology 路径]；或 cognify "正文"'); process.exit(2); }
  const payload: Record<string, unknown> = { texts: [text], dataset: option('--dataset') ?? config.knowledge.cogneeNative.dataset };
  if (option('--ontology')) payload.ontologyFilePath = option('--ontology');
  console.log(JSON.stringify(await runCogneeNative(config, 'cognify', payload), null, 2));
} else if (action === 'search') {
  const query = option('--query') ?? positional();
  if (!query) { console.error('用法：cognee:native -- search --query "问题" [--dataset 名称]；或 search "问题"'); process.exit(2); }
  console.log(JSON.stringify(await runCogneeNative(config, 'search',
    { query, dataset: option('--dataset') ?? config.knowledge.cogneeNative.dataset }), null, 2));
} else if (action === 'persist') {
  // 把凭据写进 .runtime/cognee-env.json（gitignored、0600）；已设的进程环境仍然优先。
  const values: Record<string, string> = {};
  const map: [string, string][] = [['--base-url', 'COGNEE_LLM_BASE_URL'], ['--api-key', 'COGNEE_LLM_API_KEY'], ['--model', 'COGNEE_LLM_MODEL']];
  for (const [flag, envName] of map) { const v = option(flag); if (v) values[envName] = v; }
  if (!Object.keys(values).length) { console.error('用法：cognee:native -- persist --base-url URL --api-key KEY [--model 模型]'); process.exit(2); }
  const merged = persistCogneeEnv(values);
  console.log(JSON.stringify({ ok: true, action: 'persist', written: Object.keys(values),
    persistedKeys: Object.keys(merged), file: '.runtime/cognee-env.json（gitignored，权限 0600）',
    note: '已写入本机凭据文件；server 重启后自动装载，进程环境变量仍优先' }, null, 2));
} else if (action === 'forget') {
  const removed = forgetPersistedCogneeEnv();
  console.log(JSON.stringify({ ok: true, action: 'forget', removed,
    note: removed ? '已删除 .runtime/cognee-env.json；正在运行的进程需重启才会失去凭据' : '没有可删除的本机凭据文件' }, null, 2));
} else if (action === 'load-env') {
  const loaded = loadPersistedCogneeEnvIntoProcess();
  console.log(JSON.stringify({ ok: true, action: 'load-env', loaded,
    persistedKeys: Object.keys(readPersistedCogneeEnv()) }, null, 2));
} else {
  console.error('用法：cognee:native status | cognify | search | persist | forget');
  process.exit(2);
}
