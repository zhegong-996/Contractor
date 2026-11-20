import { lstat, readFile } from 'node:fs/promises';

export async function readPrivateRunnerFile(filename: string) {
  const info = await lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077) throw new Error('执行端凭据文件必须仅本人可读写');
  return readFile(filename, 'utf8');
}

export function expiredCodexLogin(auth: string) {
  try {
    const data = JSON.parse(auth);
    if (data.auth_mode && data.auth_mode !== 'chatgpt') return false;
    const payload = data.tokens?.access_token?.split('.')[1];
    if (!payload) return false;
    // Treat local expiry as a readiness hint. Provider authentication still happens in Codex.
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(exp) && exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}
