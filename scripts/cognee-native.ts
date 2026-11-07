/** Cognee 原生管线 CLI：状态 / cognify / 语义检索。凭据只从进程环境读取。 */
import { loadConfig } from '../src/config.ts';
import { cogneeNativeStatus, runCogneeNative } from '../src/cognee-native.ts';

const [action = 'status', ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const config = loadConfig();

if (action === 'status') {
  console.log(JSON.stringify(cogneeNativeStatus(config), null, 2));
} else if (action === 'cognify') {
  const text = option('--text');
  if (!text) { console.error('用法：cognee:native cognify --text "要抽取的正文" [--dataset 名称] [--ontology 路径]'); process.exit(2); }
  const payload: Record<string, unknown> = { texts: [text], dataset: option('--dataset') ?? 'suitme-native' };
  if (option('--ontology')) payload.ontologyFilePath = option('--ontology');
  console.log(JSON.stringify(await runCogneeNative(config, 'cognify', payload), null, 2));
} else if (action === 'search') {
  const query = option('--query');
  if (!query) { console.error('用法：cognee:native search --query "问题" [--dataset 名称]'); process.exit(2); }
  console.log(JSON.stringify(await runCogneeNative(config, 'search',
    { query, dataset: option('--dataset') ?? 'suitme-native' }), null, 2));
} else {
  console.error('用法：cognee:native status | cognify | search');
  process.exit(2);
}
