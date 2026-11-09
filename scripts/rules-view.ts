// 规则视图 CLI（第四十一轮）。只读：读 config.json，打印一份按问题组织的规则视图。
//   npm run rules:view           人话视图
//   npm run rules:view -- --json 机器可读
import { loadConfig } from '../src/config.ts';
import { buildRulesView, renderRulesViewText } from '../src/rules-view.ts';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const view = buildRulesView(loadConfig());
  if (json) { console.log(JSON.stringify(view, null, 2)); }
  else {
    console.log(renderRulesViewText(view));
    if (view.defaulted.length) console.log(`\n提示：${view.defaulted.length} 处配置取默认值，可用 --json 查看来源路径。`);
  }
} catch (error) {
  console.error('读不到配置：' + String(error instanceof Error ? error.message : error));
  console.error('先运行 npm run setup 生成 .runtime/config.json。');
  process.exitCode = 1;
}
