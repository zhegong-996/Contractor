// Upstream-adapter boundary audit (P3 code tidy-up).
// Read-only: verifies that we kept the "pinned submodule + separate adapter"
// contract. It never modifies an upstream worktree or a gitlink.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const problems: string[] = [];
const notes: string[] = [];

const modules = readFileSync(path.join(root, '.gitmodules'), 'utf8');
const paths = [...modules.matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)].map(m => m[1]!);
const lock = JSON.parse(readFileSync(path.join(root, 'sources.lock.json'), 'utf8')) as {
  sources: Record<string, { url: string; commit: string; license: string }>;
};
const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Our own adapter surface. Upstream source is never edited or copied here. */
const ADAPTERS: Record<string, string[]> = {
  paperclip: ['src/paperclip.ts', 'src/store.ts', 'src/controller.ts', 'src/server.ts', 'src/commands.ts',
    'plugins/knowledge-workspaces/src/ui/index.tsx', 'plugins/knowledge-workspaces/src/ui/styles.ts',
    'plugins/knowledge-workspaces/src/ui/v06-panels.tsx', 'plugins/knowledge-workspaces/src/worker.ts',
    'scripts/build-chinese-shell.ts', 'locales/shell.zh-CN.json',
    'scripts/install-workspace-plugin.ts', 'scripts/install-wiki.ts'],
  superagent: ['src/upstream.ts', 'src/feishu-sources.ts'],
  autoloop: ['src/upstream.ts', 'src/native-worker.ts', 'src/assistant-turn.ts'],
  'prime-agent': ['src/vendor/prime-query.ts', 'src/team-memory.ts'],
  'deepseek-harness': ['src/upstream.ts', 'src/harness-composition.ts'],
  cognee: ['src/graph.ts', 'src/org-extraction.ts', 'src/ontology.ts', 'src/team-memory.ts',
    'scripts/cognee-graph.py', 'scripts/cognee-recall.py', 'scripts/setup-graph.ts'],
  acceptance: ['src/acceptance-interop.ts', 'src/v06.ts', 'scripts/export-acceptance.ts'],
};

for (const submodulePath of paths) {
  const name = path.basename(submodulePath);
  const entry = lock.sources[name];
  if (!entry) { problems.push(`${name}: .gitmodules 有条目但 sources.lock.json 未锁定`); continue; }
  if (!existsSync(path.join(root, submodulePath, 'LICENSE')))
    problems.push(`${name}: 缺少上游原版 LICENSE`);
  if (!['MIT', 'Apache-2.0'].includes(entry.license))
    problems.push(`${name}: 许可证 ${entry.license} 不在已评审的 MIT / Apache-2.0 白名单`);
  if (!flat(notices).includes(flat(name)))
    problems.push(`${name}: THIRD_PARTY_NOTICES.md 未提及`);
  // Use the index (not HEAD) so a newly pinned submodule can be audited
  // before its commit lands; after commit the index equals HEAD.
  const indexLine = git('ls-files', '-s', submodulePath);
  const gitlink = indexLine.split(/\s+/)[1] ?? '';
  if (gitlink !== entry.commit)
    problems.push(`${name}: gitlink ${gitlink.slice(0, 12)} 与锁文件 ${entry.commit.slice(0, 12)} 不一致`);
  const head = git('-C', submodulePath, 'rev-parse', 'HEAD');
  if (head !== entry.commit) problems.push(`${name}: 检出提交与锁文件不一致`);
  for (const file of ADAPTERS[name] ?? []) if (!existsSync(path.join(root, file)))
    problems.push(`${name}: 适配层文件 ${file} 缺失`);
  notes.push(`${name}: ${entry.license} @ ${entry.commit.slice(0, 12)} · 适配层 ${(ADAPTERS[name] ?? []).length} 个文件`);
}

// A staged gitlink (new/updated submodule) is normal; what must stay clean is
// each upstream worktree itself. Check those instead of the parent index.
for (const submodulePath of paths) {
  let inner = '';
  try { inner = git('-C', submodulePath, 'status', '--porcelain'); }
  catch (error) { problems.push(`${submodulePath}: 无法读取上游工作树状态：${String(error).split('\n')[0]}`); continue; }
  if (inner) problems.push(`${submodulePath}: 上游工作树存在改动或未跟踪内容：\n${inner}`);
}

for (const file of ['THIRD_PARTY_NOTICES.md', 'licenses/cognee-APACHE-2.0.txt',
  'licenses/a2a-js-APACHE-2.0.txt', 'licenses/harness-vendor-MIT.txt', 'licenses/acceptance-APACHE-2.0.txt'])
  if (!existsSync(path.join(root, file))) problems.push(`缺少声明/许可证文件 ${file}`);
for (const file of readdirSync(path.join(root, 'licenses'))) {
  const text = readFileSync(path.join(root, 'licenses', file), 'utf8');
  if (/\b(AGPL|SSPL|GPLv3|GNU General Public License version 3)\b/i.test(text))
    problems.push(`${file}: 出现强传染性协议文本，需要重新评审`);
}

// L2 extraction must stay read-only against Cognee: no project/cognify call.
const extraction = readFileSync(path.join(root, 'src/org-extraction.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
if (/\b(cognify|embed|add_nodes|add_edges|project)\s*\(/.test(extraction))
  problems.push('src/org-extraction.ts 疑似调用 Cognee 写入/模型管线');
const graphSource = readFileSync(path.join(root, 'src/graph.ts'), 'utf8');
if (!/readProjection/.test(graphSource)) problems.push('L1 只读投影 readProjection 缺失');

const output = { at: new Date().toISOString(), scope: 'upstream adapter boundary',
  submodules: paths.map(p => path.basename(p)), adapters: Object.fromEntries(Object.entries(ADAPTERS).map(([k, v]) => [k, v.length])),
  notes, problems, clean: problems.length === 0 };
mkdirSync(runtime(), { recursive: true, mode: 0o700 });
writeFileSync(runtime('upstream-audit.json'), JSON.stringify(output, null, 2), { mode: 0o600 });
console.log(JSON.stringify(output, null, 2));
if (problems.length) { console.error('上游适配边界审计未通过'); process.exitCode = 1; }
