import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { allowedFile } from '../github.ts';

export const codeLimit = 8 * 1024 * 1024;
export const codeHash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const safeName = z.string().max(240).refine(name => allowedFile(name, [name]) && !name.split('/').some(part =>
  ['.git', '.codex', '.cursor', '.entire', 'node_modules'].includes(part) || part === '.env' || part.startsWith('.env.')));
const bytes = z.string().max(Math.ceil(codeLimit / 3) * 4).refine(value => Buffer.from(value, 'base64').toString('base64') === value);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const codeBundleSchema = z.object({
  files: z.record(safeName, bytes), paths: z.array(z.string()).min(1).max(10),
}).strict().superRefine((bundle, ctx) => {
  if (Object.keys(bundle.files).length > 4000 || Object.values(bundle.files).reduce((n, value) => n + Buffer.byteLength(value, 'base64'), 0) > codeLimit)
    ctx.addIssue({ code: 'custom', message: '远端代码包超过 8 MiB 或 4000 个文件，请缩小项目范围' });
  if (bundle.paths.some(item => !safeName.safeParse(item.endsWith('/') ? item + 'file' : item).success))
    ctx.addIssue({ code: 'custom', message: '远端代码写入路径不合法' });
  const names = new Set(Object.keys(bundle.files));
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/')))
      ctx.addIssue({ code: 'custom', message: '代码文件和目录冲突' });
  }
});
export type CodeBundle = z.infer<typeof codeBundleSchema>;
export const codeDeltaSchema = z.object({ base: sha, files: z.record(safeName, bytes.nullable()) }).strict()
  .superRefine((delta, ctx) => {
    if (Object.keys(delta.files).length > 4000 || Object.values(delta.files).reduce((n, value) => n + (value ? Buffer.byteLength(value, 'base64') : 0), 0) > codeLimit)
      ctx.addIssue({ code: 'custom', message: '远端代码回执过大' });
  });
export type CodeDelta = z.infer<typeof codeDeltaSchema>;
export const bundleHash = (bundle: CodeBundle) => codeHash(JSON.stringify({ paths: bundle.paths,
  files: Object.fromEntries(Object.entries(bundle.files).sort(([a], [b]) => a.localeCompare(b))) }));

/** The caller creates an empty private directory. No archives, symlinks or Git metadata are accepted. */
export async function materializeCode(folder: string, input: CodeBundle) {
  const bundle = codeBundleSchema.parse(input);
  for (const [name, data] of Object.entries(bundle.files)) {
    const file = path.join(folder, name);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, Buffer.from(data, 'base64'), { mode: 0o600, flag: 'wx' });
  }
  return Object.fromEntries(Object.entries(bundle.files).map(([name, data]) => [name, codeHash(Buffer.from(data, 'base64'))]));
}
