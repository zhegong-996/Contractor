import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const name = '@anthropic-ai/sandbox-runtime';
const version = '0.0.83';
const zodVersion = '4.6.7';

export class SandboxProviderError extends Error {}

/** The operator installs this OS-isolation tool separately from Contractor's packages. */
export function sandboxProvider(directory = process.env.CONTRACTOR_SANDBOX_ROOT) {
  try {
    if (directory && !path.isAbsolute(directory)) throw new Error('expected an absolute path');
    const root = realpathSync(directory || path.dirname(createRequire(import.meta.url).resolve(name + '/package.json')));
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const cli = path.join(root, 'dist', 'cli.js');
    if (manifest.name !== name || manifest.version !== version || !existsSync(cli)) throw new Error('unexpected runtime');
    const zod = createRequire(cli)('zod/package.json') as { version?: string };
    if (zod.version !== zodVersion) throw new Error('unexpected zod version');
    return { root, cli };
  } catch {
    throw new SandboxProviderError('执行机缺少已验证的隔离工具。请按执行端手册独立安装 SRT ' + version + ' 并设置 CONTRACTOR_SANDBOX_ROOT。');
  }
}
