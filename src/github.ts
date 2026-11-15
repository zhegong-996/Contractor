import { command } from './commands.ts';

export function allowedFile(file: string, allowed: string[]): boolean {
  if (!file || file.startsWith('/') || file.split('/').some(p => p === '..') || file.includes('\\')) return false;
  return allowed.some(prefix => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);
}
export function parsePr(url: string, repository: string): number {
  const u = new URL(url); const expected = `/${repository}/pull/`;
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || !u.pathname.toLowerCase().startsWith(expected.toLowerCase())) throw new Error('PR is outside the configured repository');
  const value = u.pathname.slice(expected.length); if (!/^\d+\/?$/.test(value)) throw new Error('Invalid PR URL'); return Number(value.replace('/', ''));
}

export async function githubApi(repository: string, route: string) {
  return JSON.parse(await command('gh', ['api', `repos/${repository}/${route}`]));
}
