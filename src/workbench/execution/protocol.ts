import { z } from 'zod';

const bounded = (max: number) => z.string().refine(value => [...value].length <= max);
const prose = (max: number) => bounded(max).refine(value => !!value.trim());
const usage = z.object({ input: z.number().nonnegative().optional(), output: z.number().nonnegative().optional(),
  cached: z.number().nonnegative().optional(), cost: z.number().nonnegative().optional() }).catchall(z.number().nonnegative().finite());
const event = z.object({ id: prose(200), type: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  subject: z.string().max(100).regex(/^[A-Za-z0-9#._:/@-]*$/).default(''), summary: bounded(200).default(''),
  detail: bounded(4000).default(''), link: bounded(500).refine(value => !value || /^https?:\/\/[\x21-\x7e]+$/.test(value)).default(''),
  hops: z.number().int().nonnegative().default(0) }).strict();
const ask = z.object({ title: prose(200), text: prose(4000), options: z.array(prose(200)).min(2).max(5),
  recommend: z.number().int().nonnegative().optional(), about: bounded(4000).optional(), key: bounded(100).optional() }).strict()
  .refine(item => item.recommend === undefined || item.recommend < item.options.length);
const timer = z.object({ key: prose(100), at: z.iso.datetime({ offset: true }).optional(), about: prose(4000).optional(),
  cancel: z.literal(true).optional() }).strict().refine(row => row.cancel ? !row.at : !!row.at && !!row.about);
const result = z.object({ outcome: z.enum(['done', 'nothing', 'failed', 'cancelled']),
  summary: bounded(500).optional(), error: bounded(500).optional(), session: bounded(500).optional(), usage: usage.optional(),
  ask: z.array(ask).max(5).optional(), notice: z.array(z.object({ title: prose(200), text: prose(4000), key: bounded(100).optional() }).strict()).max(10).optional(),
  resolve: z.array(z.object({ card: z.number().int().positive(), reason: prose(1000) }).strict()).max(50).optional(),
  later: z.array(timer).max(10).optional(), events: z.array(event).max(100).optional() }).strict();

export type Result = z.infer<typeof result>;
export type Usage = { input?: number; output?: number; cached?: number; cost?: number };
export type EventInput = z.infer<typeof event>;
export type Rejected = { card?: number; what?: string; reason: string };
export function parseResult(input: unknown): Result {
  const parsed = result.parse(input);
  // Legacy acknowledgements hash fields in transport order. Keep that order so pending receipts remain replayable.
  return { ...input as Result, ...(parsed.events && { events: parsed.events }) };
}
export const parseEvent = (input: unknown): EventInput => event.parse(input);

export type Job = {
  run: number; token: string; attempt: number;
  rule: { name: string; cwd: string; skill?: string; prompt?: string; emits?: { source: string; types: string[] } };
  agent: { id: string; name: string; use: string; model?: string; effort?: string; access: string; command?: string[]; timeout?: number; provider?: string };
  session: string | null;
  askFirst: string[];
  context: {
    events: (Omit<EventInput, 'hops'> & { source: string; sourceName: string; receivedAt: string; hops?: number })[];
    answers: { card: number; title: string; options: string[]; choice: number | null; text: string | null;
      about: string; by: string | null; at: string }[];
    timers: { key: string; about: string; at: string }[];
    waiting: { key: string; about: string; at: string }[];
    open: { card: number; title: string; text: string; at: string }[];
    decided: { card: number; title: string; choice: string | null; at: string }[];
  };
};

export type WorkRequest = { claim: string; running: number[]; wait: number; capacity: boolean; engines?: ('codex' | 'claude')[] };
export type Started = { session: string; link?: string };
export type WorkerHub = {
  work(request: WorkRequest): Promise<{ job?: Job | null; cancel?: number[] }>;
  started(run: number, token: string, value: Started): unknown;
  result(run: number, token: string, value: Result): Promise<{ rejected: Rejected[] }>;
};
export type WorkerEntry = { run: number; attempt: number; token: string; turn: number; dir: string; job: Job; pid?: number };
export type Worker = { tick(): Promise<unknown>; tidy(): void; entries(): WorkerEntry[] };
export type WorkerFactory = (options: { hub: WorkerHub; name: string; capacity?: number; wait?: number; log?: (message: string) => void }) => Worker;

export type Turn = { prompt: string; session: string; resume: string | null; cwd: string; model?: string; effort?: string;
  access?: string; command?: string[]; contextFile: string; folder: string };
export type Reading = { text?: string; error?: string; started?: boolean; session?: string; usage?: Usage;
  sessionUsage?: Usage; finished?: boolean };
export type Adapter = { command(turn: Turn): string[]; read(stdout: string, code: number | null, stderr?: string): Reading;
  link?(session: string, cwd: string): string; sessionUsage?(session: string, cwd: string): Usage | undefined };
