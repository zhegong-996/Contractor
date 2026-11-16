#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('SuitMe 执行端需要 Node.js 24。');
  process.exit(1);
}
const cli = fileURLToPath(new URL('../src/workbench/runner-cli.ts', import.meta.url));
const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
