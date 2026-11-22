import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.md'], {
  cwd: root,
  encoding: 'utf8',
}).split('\n').filter(Boolean).sort();
const failures = [];
let links = 0;

for (const file of files) {
  const source = readFileSync(path.join(root, file), 'utf8');
  for (const [index, line] of source.split('\n').entries()) {
    for (const match of line.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (!target || target.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      if (target.startsWith('<')) target = target.slice(1, target.indexOf('>'));
      else target = target.split(/\s+/, 1)[0];
      target = decodeURIComponent(target.replace(/[?#].*$/, ''));
      if (!target) continue;
      links++;
      const resolved = path.resolve(path.dirname(path.join(root, file)), target);
      if (!existsSync(resolved)) failures.push(`${file}:${index + 1} -> ${target}`);
    }
  }
}

if (failures.length) {
  console.error('文档链接检查失败：\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`文档链接检查通过 · ${files.length} files · ${links} links`);
}
