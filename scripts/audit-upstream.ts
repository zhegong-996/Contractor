import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const lock = JSON.parse(read('sources.lock.json')) as {
  sources: Record<string, { url: string; commit: string; license: string }>;
};
const problems: string[] = [];
const index = new Map(git('ls-files', '-s', 'upstream').split('\n').filter(Boolean).map(line => {
  const [mode, sha, , file] = line.split(/\s+/);
  if (mode !== '160000') problems.push(`${file} 应为上游 submodule`);
  return [file!, sha!];
}));
const paths = [...read('.gitmodules').matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)].map(match => match[1]!);
const expected = Object.keys(lock.sources).map(name => 'upstream/' + name).sort();
if (JSON.stringify(paths.sort()) !== JSON.stringify(expected)
  || JSON.stringify([...index.keys()].sort()) !== JSON.stringify(expected))
  problems.push('.gitmodules、sources.lock.json 与上游 gitlink 不一致');

for (const [name, source] of Object.entries(lock.sources)) {
  const directory = 'upstream/' + name;
  if (index.get(directory) !== source.commit) problems.push(`${directory} gitlink 与锁定提交不一致`);
  const remote = git('config', '-f', '.gitmodules', '--get', `submodule.${directory}.url`);
  if (remote.replace(/\.git$/, '') !== source.url) problems.push(`${directory} 来源地址不一致`);
  if (!existsSync(path.join(root, directory, 'LICENSE'))) {
    problems.push(`${directory} 缺少 LICENSE，请初始化 submodule`);
    continue;
  }
  if (git('-C', directory, 'rev-parse', 'HEAD') !== source.commit)
    problems.push(`${directory} 检出提交与锁文件不一致`);
  if (git('-C', directory, 'status', '--porcelain'))
    problems.push(`${directory} 存在上游源码改动`);
  console.log(`${directory} · ${source.license} @ ${source.commit.slice(0, 12)}`);
}

const manifest = JSON.parse(read('package.json'));
const packages = JSON.parse(read('package-lock.json')).packages;
for (const name of ['casbin', '@backstage/catalog-model']) {
  const dependency = packages['node_modules/' + name];
  if (dependency?.version !== manifest.dependencies[name] || !dependency?.integrity)
    problems.push(`${name} 的版本或 integrity 未锁定`);
}
for (const file of ['THIRD_PARTY_NOTICES.md', 'licenses/casbin-APACHE-2.0.txt',
  'licenses/backstage-APACHE-2.0.txt', 'licenses/backstage-NOTICE.txt', 'licenses/entire-MIT.txt',
  'licenses/harness-vendor-MIT.txt', 'licenses/vue-MIT.txt']) {
  if (!existsSync(path.join(root, file))) problems.push(`缺少 ${file}`);
}
if (!read('workbench/vendor/vue.global.prod.js').includes('vue v3.5.45'))
  problems.push('Vue 本地版本与第三方声明不一致');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
