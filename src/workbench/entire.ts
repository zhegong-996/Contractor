import { z } from 'zod';
import { command } from '../commands.ts';
import type { Settings } from './config.ts';
import { commitSha } from './github-delivery.ts';

const id = z.string().regex(/^(?:[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25})$/i);
const envelope = z.object({
  checkpoint_id: id,
  sessions: z.array(z.object({ session_id: z.string().min(1), agent: z.string() })),
});
export type Checkpoint = z.infer<typeof envelope>;

/** Reuse Entire's commit resolution and metadata-only exporter from its pinned CLI release. */
export async function entireCheckpoint(config: Settings['attribution'], repository: string, sha: string): Promise<Checkpoint | undefined> {
  const checkout = Object.entries(config?.checkouts ?? {}).find(([name]) => name.toLowerCase() === repository.toLowerCase())?.[1];
  if (!checkout || !config || !commitSha.safeParse(sha).success) return;
  try {
    const remote = (await command('git', ['remote', 'get-url', 'origin'], checkout)).trim();
    if (remote.toLowerCase() !== ('https://github.com/' + repository + '.git').toLowerCase()) return;
    const local = (await command('git', ['rev-parse', '--verify', sha + '^{commit}'], checkout)).trim();
    if (local !== sha) return;
    // The checkout is configured by the runtime operator. Only export checkpoint metadata.
    const raw = await command(config.entireCommand, ['checkpoint', 'explain', '--json', '--commit', sha], checkout);
    return envelope.parse(JSON.parse(raw));
  } catch { return; }
}

export function checkpointAgent(value: string) {
  const name = value.toLowerCase();
  if (name === 'codex' || name === 'openai codex') return 'codex';
  if (name === 'cursor') return 'cursor';
}
