import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { root, runtime, secrets } from '../src/config.ts';
import path from 'node:path';

const url = 'http://127.0.0.1:3100/api/health';
const existing = await fetch(url).then(r => r.ok).catch(() => false);
if (existing) { console.log('Paperclip already responds at http://127.0.0.1:3100'); process.exit(0); }
mkdirSync(runtime(), { recursive: true });
if (!existsSync(runtime('secrets.json'))) throw new Error('Run npm run setup -- --prepare-only first');
const child = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), 'src/index.ts'], {
  cwd: path.join(root, 'upstream/paperclip/server'), stdio: 'inherit',
  env: { ...process.env, PAPERCLIP_HOME: runtime('paperclip'), PAPERCLIP_TELEMETRY_DISABLED: '1',
    PAPERCLIP_AGENT_JWT_SECRET: secrets().jwtSecret, PAPERCLIP_MIGRATION_AUTO_APPLY: 'true',
    HOST: '127.0.0.1', PORT: '3100', SERVE_UI: 'true' },
});
writeFileSync(runtime('paperclip.pid'), String(child.pid));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
