import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const lock = JSON.parse(read('sources.lock.json')) as {
  sources: Record<string, { url: string; commit: string; license: string }>;
  vendored: Record<string, { commit: string; license: string; licenseFile: string; files: Record<string, string> }>;
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
  const license = directory + '/LICENSE';
  if (!existsSync(path.join(root, license))) {
    problems.push(`${directory} 缺少 LICENSE，请初始化 submodule`);
    continue;
  }
  if (source.license !== 'MIT' || !read(license).startsWith('MIT License'))
    problems.push(`${directory} 的许可证与已核准来源不一致`);
  if (git('-C', directory, 'rev-parse', 'HEAD') !== source.commit)
    problems.push(`${directory} 检出提交与锁文件不一致`);
  if (git('-C', directory, 'status', '--porcelain'))
    problems.push(`${directory} 存在上游源码改动`);
  console.log(`${directory} · ${source.license} @ ${source.commit.slice(0, 12)}`);
}

type Package = { license?: string; version?: string; integrity?: string; resolved?: string; dev?: boolean;
  inBundle?: boolean; bundleDependencies?: string[] };
type Scope = 'workbench' | 'test example' | 'external sandbox';
const runtimeExceptions = { '@ungap/structured-clone': 'ISC', 'lucide-react': 'ISC', yaml: 'ISC' };
const buildExceptions = { 'detect-libc': 'Apache-2.0', 'graceful-fs': 'BlueOak-1.0.0', picocolors: 'ISC',
  'source-map-js': 'BSD-3-Clause', tslib: '0BSD' };
const externalExceptions = { '@anthropic-ai/sandbox-runtime': 'Apache-2.0', 'node-forge': '(BSD-3-Clause OR GPL-2.0)' };
const testExceptions = { playwright: 'Apache-2.0', 'playwright-core': 'Apache-2.0' };

function permits(scope: Scope, name: string, dependency: Package) {
  const license = dependency.license;
  if (license === 'MIT' || license === 'MIT License' && name === '@figma/rest-api-spec') return true;
  const matches = (list: Record<string, string>) => Object.hasOwn(list, name) && list[name] === license;
  if (scope === 'external sandbox') return matches(externalExceptions);
  if (scope === 'test example') return matches(testExceptions);
  if (!dependency.dev) return matches(runtimeExceptions);
  return matches(buildExceptions)
    || license === 'Apache-2.0' && (name === 'typescript' || /^@typescript\/typescript-[\w-]+$/.test(name))
    || license === 'MPL-2.0' && /^lightningcss(?:-[\w-]+)?$/.test(name);
}

function auditLock(scope: Scope, directory: string) {
  const manifest = JSON.parse(read(path.join(directory, 'package.json')));
  const { packages } = JSON.parse(read(path.join(directory, 'package-lock.json'))) as { packages: Record<string, Package> };
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const dependency = packages['node_modules/' + name];
    if (dependency?.version !== version || !dependency?.integrity)
      problems.push(`${scope} 的 ${name} 版本或 integrity 未锁定`);
  }
  let audited = 0;
  for (const [location, dependency] of Object.entries(packages)) {
    if (!location) continue;
    audited++;
    const split = location.lastIndexOf('node_modules/');
    const name = location.slice(split + 'node_modules/'.length);
    const parent = packages[location.slice(0, split - 1)];
    // npm's WASM build embeds published packages in the parent tarball, protected by its integrity.
    const fromBundle = dependency.dev && dependency.inBundle
      && location.startsWith('node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/')
      && parent?.integrity && parent.bundleDependencies?.includes(name);
    const fromRegistry = dependency.integrity && dependency.resolved?.startsWith('https://registry.npmjs.org/');
    if (!dependency.version || !(fromRegistry || fromBundle) || !permits(scope, name, dependency))
      problems.push(`${scope} 的 ${location} 完整性或许可需核对 (${dependency.license ?? '未声明'})`);
  }
  console.log(`${scope} · ${audited} locked packages`);
}
if (JSON.parse(read('package.json')).license !== 'MIT' || !read('LICENSE').startsWith('MIT License'))
  problems.push('Contractor 的项目许可不一致');
auditLock('workbench', '.');
auditLock('test example', 'integrations/github/store-small-screen/.github/contractor-store-small-screen');
auditLock('external sandbox', 'fixtures/sandbox-provider');
if (process.argv.includes('--browser')) {
  const sections = read('dist/workbench/browser-dependency-licenses.txt').split(/^## /m).slice(1);
  const supplements: Record<string, string> = {
    '@ant-design/icons-svg - 4.6.0 (MIT)': 'licenses/ant-design-icons-MIT.txt',
    'is-mobile - 5.0.0 (MIT)': 'licenses/is-mobile-MIT.txt',
  };
  const combined = read('dist/workbench/component-licenses.txt');
  if (!sections.length || !combined.includes(read(lock.vendored.octop!.licenseFile).trim()))
    problems.push('浏览器构建缺少组件许可证');
  for (const section of sections) {
    const [heading, ...body] = section.split('\n');
    const match = /^(.+) - \S+ \((.+)\)$/.exec(heading!);
    const notice = supplements[heading!];
    if (!match || !permits('workbench', match[1]!, { license: match[2] })
      || !body.join('\n').trim() && (!notice || !combined.includes(read(notice).trim())))
      problems.push('浏览器构建缺少许可或出现未审核的分发范围：' + heading);
  }
  console.log(`browser · ${sections.length} dependency notices`);
}
for (const file of ['THIRD_PARTY_NOTICES.md', 'licenses/ant-design-icons-MIT.txt', 'licenses/is-mobile-MIT.txt',
  'licenses/harness-vendor-MIT.txt']) {
  if (!existsSync(path.join(root, file))) problems.push(`缺少 ${file}`);
}
for (const [name, vendor] of Object.entries(lock.vendored)) {
  const directory = `workbench/src/${name}`;
  if (!existsSync(path.join(root, vendor.licenseFile))) problems.push(`缺少 ${vendor.licenseFile}`);
  for (const [file, source] of Object.entries(vendor.files)) {
    const local = `${directory}/${file}`;
    if (!existsSync(path.join(root, local)) || !read(local).split('\n', 1)[0]?.includes(vendor.commit + ', ' + source))
      problems.push(local + ' 缺少锁定的上游来源');
  }
  console.log(`${directory} · ${vendor.license} @ ${vendor.commit.slice(0, 12)}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
