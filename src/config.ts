import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateRoot = process.env.COLLAB_STATE_DIR ?? path.join(root, '.runtime');
export const runtime = (...parts: string[]) => path.join(stateRoot, ...parts);

export function isTemporaryDirectory(dir: string) {
  const temporary = path.resolve(os.tmpdir());
  const target = path.resolve(dir);
  const relative = path.relative(temporary, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function requirePersistentStateDir(dir: string | undefined, label: string) {
  if (!dir || !path.isAbsolute(dir)) throw new Error(`${label}需要 COLLAB_STATE_DIR 绝对路径。`);
  if (isTemporaryDirectory(dir) && process.env.COLLAB_ALLOW_TMP_STATE !== '1')
    throw new Error(`COLLAB_STATE_DIR 不能指向系统临时目录（${dir}）。请改用持久目录，例如 ~/Library/Application Support/contractor/runtime；仅用于一次性联调时可设 COLLAB_ALLOW_TMP_STATE=1。`);
  return dir;
}
