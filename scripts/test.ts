import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { platformFingerprint } from '../src/platform-evidence.ts';
import { root, runtime } from '../src/config.ts';
const fingerprint = platformFingerprint(), files = readdirSync('tests').filter(f => f.endsWith('.test.ts')).sort().map(f => 'tests/' + f);
// 测试进程统一把路由决策写进内存，不污染 .runtime/routing/events.jsonl（真实业务 Trace）。
const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files],
  { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, COLLAB_TEST_TRACE: 'memory' } });
let output = '';
child.stdout.on('data', b => { output += b; process.stdout.write(b); });
child.stderr.on('data', b => process.stderr.write(b));
const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
const cases = output.split('\n').flatMap(line => {
  const spec = /^([✔✖]) (.+?) \([\d.]+m?s\)$/.exec(line), tap = /^(ok|not ok) \d+ - (.+)$/.exec(line);
  return spec ? [{ name: spec[2], passed: spec[1] === '✔' }] : tap ? [{ name: tap[2], passed: tap[1] === 'ok' }] : [];
});
mkdirSync(runtime(), { recursive: true, mode: 0o700 });
writeFileSync(runtime('platform-validation.json'), JSON.stringify({ kind: 'platform-tests', at: new Date().toISOString(), exitCode: code,
  tests: Number(/(?:ℹ|#) tests (\d+)/.exec(output)?.[1] ?? 0), cases, fingerprint, fingerprintUnchanged: fingerprint === platformFingerprint() }, null, 2), { mode: 0o600 });
process.exitCode = code ?? 1;
