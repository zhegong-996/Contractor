import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formerName } from './compatibility.ts';

export const runnerEndpoint = z.url().transform(value => new URL(value)).refine(url =>
  (url.protocol === 'https:' || url.protocol === 'http:' && url.hostname === '127.0.0.1')
  && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
'请使用团队 HTTPS 地址，或由部署方配置的回环地址').transform(url => url.origin);
export const runnerSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const runnerEngines = z.array(z.enum(['codex', 'claude'])).min(1).max(2).refine(items => new Set(items).size === items.length);
export const runnerRequestId = z.uuid();
export const runnerConnectInput = z.object({
  id: runnerRequestId, name: z.string().trim().min(1).max(100), engines: runnerEngines,
}).strict();
export type RunnerConnectInput = z.infer<typeof runnerConnectInput>;

// Only the private polling secret, stored by the requesting machine, can recover its device credential.
export function enrollmentToken(id: string, secret: string, former = false) {
  const scope = 'contractor-runner-enrollment-v1:';
  return createHash('sha256').update((former ? formerName(scope) : scope) + id + ':' + secret).digest('base64url');
}
