import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { OutboundMessage, Repositories } from '../../upstream/superagent/src/core/index.ts';
import { root } from '../config.ts';

export type PilotStore = Repositories & {
  db: DatabaseSync;
  close(): void;
  afterCommit(action: () => void): void;
  replyStatus(id: string): 'pending' | 'sent' | 'dropped' | undefined;
  receipts: {
    add(message: OutboundMessage): boolean;
    get(id: string): OutboundMessage | undefined;
    settle(message: OutboundMessage, outcome: 'sent' | 'channelGone'): void;
    withdraw(id: string): boolean;
  };
};

interface EffectPayloads {
  assessment: { triggerId: string };
  delivery: { ticketId: string; assignmentId?: string };
  reply: Record<string, never>;
}
export interface PilotEffects {
  enqueue<K extends keyof EffectPayloads>(kind: K, key: string, payload: EffectPayloads[K]): void;
  handle<K extends keyof EffectPayloads>(kind: K, run: (payload: EffectPayloads[K], key: string) => Promise<void>, options?: { ordered?: boolean }): void;
  start(): void;
  kick(): void;
  drain(): Promise<void>;
}

export async function openPilotStore(file: string): Promise<PilotStore> {
  const vendor = path.join(root, 'upstream/deepseek-harness/vendor');
  const aliases = new Map(['schemastery', 'cosmokit'].map(name => [
    '@deepseek-ai/' + name, pathToFileURL(path.join(vendor, name, 'src/index.ts')).href,
  ]));
  // Preserve import.meta.url for upstream's packaged prompts and skill paths.
  const hook = registerHooks({
    resolve(specifier, context, next) { return next(aliases.get(specifier) ?? specifier, context); },
  });
  try {
    const fileUrl = pathToFileURL(path.join(root, 'upstream/superagent/src/app/store.ts'));
    const { Store } = await import(fileUrl.href);
    return new Store(file);
  } finally { hook.deregister(); }
}

export async function openPilotEffects(store: PilotStore): Promise<PilotEffects> {
  const source = path.join(root, 'upstream/superagent/src');
  const { Effects } = await import(pathToFileURL(path.join(source, 'app/effects.ts')).href);
  const { HealthBoard } = await import(pathToFileURL(path.join(source, 'infra/health.ts')).href);
  return new Effects(store, new HealthBoard());
}
