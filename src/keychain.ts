/**
 * V6 密钥存储抽象：默认文件（现状），可选迁移到 macOS 钥匙串。
 *
 * 边界：这是「可选增强」，不是默认行为。单机本地下 secrets.json 0600 已够用；
 * 钥匙串解决的是「有本机读权限的人不能直接抄走密钥」——那已经是多机/共享机器的场景。
 * 所以这里只提供能力，迁移是显式动作（`migrateToKeychain`），不自动改现状。
 */
import { execFileSync } from 'node:child_process';

const SERVICE = 'ai-native-collab';

export function keychainAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try { execFileSync('security', ['--help'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function keychainGet(account: string): string | null {
  if (!keychainAvailable()) return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch { return null; }
}

export function keychainSet(account: string, value: string): void {
  if (!keychainAvailable()) throw new Error('macOS 钥匙串不可用');
  keychainDelete(account);   // add 之前先删，避免「条目已存在」报错
  execFileSync('security', ['add-generic-password', '-s', SERVICE, '-a', account, '-w', value, '-U'],
    { stdio: 'ignore' });
}

export function keychainDelete(account: string): void {
  if (!keychainAvailable()) return;
  try {
    execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' });
  } catch { /* 不存在就跳过 */ }
}

/**
 * 把 secrets.json 里的敏感字段迁到钥匙串，并在原文件里清空（留空串占位）。
 * 只有显式调用才发生；失败抛错、不动原文件，避免迁一半。
 */
export function migrateToKeychain(secrets: Record<string, unknown>, keys: string[]): string[] {
  if (!keychainAvailable()) throw new Error('当前环境没有 macOS 钥匙串，不能迁移');
  for (const key of keys) {
    const value = String(secrets[key] ?? '').trim();
    if (!value) continue;
    keychainSet(key, value);
  }
  return keys.filter(key => String(secrets[key] ?? '').trim());
}
