import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateRoot = process.env.COLLAB_STATE_DIR ?? path.join(root, '.runtime');
export const runtime = (...parts: string[]) => path.join(stateRoot, ...parts);
