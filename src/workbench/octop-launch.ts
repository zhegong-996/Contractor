import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { octopPythonEnv, octopScript } from './octop-bridge.ts';

const args = process.argv.slice(2);
const [python, credential, directory, prompt] = args;
const [mode, context, model] = args.length === 6 ? ['task', ...args.slice(4)] : args.slice(4);
if (!python || !credential || !directory || !prompt || !context || !model) throw new Error('缺少 Octop 受托执行配置');
const workspace = await mkdtemp(path.join(directory, 'workspace-'));
try {
  const { apiKey: key } = z.object({ apiKey: z.string().min(10).max(512) }).strict().parse(JSON.parse(await readFile(credential, 'utf8')));
  const [instructions, supplied] = await Promise.all([readFile(prompt, 'utf8'), readFile(context, 'utf8')]);
  const input = { key, prompt: instructions + '\n本轮上下文随输入提供，只读。产出完整中文结论。',
    context: supplied, model, session: randomUUID(), consultation: mode === 'consultation' };
  const result = spawnSync(python, [octopScript, 'execute'], { input: JSON.stringify(input), encoding: 'utf8',
    timeout: 100_000, maxBuffer: 512 * 1024, env: octopPythonEnv(workspace) });
  if (result.status !== 0) throw new Error('Octop 运行失败');
  const receipt = z.object({ text: z.string().max(24000),
    model: z.string().max(100).nullable(), session: z.uuid(),
    stopReason: z.string().nullable(),
    usage: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), cached: z.number().int().nonnegative() }).nullable() })
    .parse(JSON.parse(result.stdout));
  if (receipt.model) await writeFile(path.join(directory, 'model'), receipt.model, { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, consultation: input.consultation }));
} finally {
  await rm(workspace, { recursive: true, force: true });
  await rm(prompt, { force: true });
}
