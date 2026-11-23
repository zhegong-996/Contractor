import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, runtime } from '../config.ts';
import { formerName } from './compatibility.ts';
import type { RunnerAgent } from './runner-profile.ts';
import type { WorkerFactory } from './execution/protocol.ts';

const legacy = await import('../../upstream/autoloop/worker/worker.ts');
export const createWorker = legacy.createWorker as WorkerFactory;

export async function configureDeviceWorker(home: string, profile?: RunnerAgent) {
  const adapter = profile?.engine === 'claude' ? 'contractor-remote-claude' : 'contractor-isolated';
  const entry = path.join(home, 'plugins', adapter, 'agent.ts');
  await mkdir(path.dirname(entry), { recursive: true, mode: 0o700 });
  // The device state directory may be outside any Node.js package. Load generated adapters as ESM.
  await writeFile(path.join(home, 'plugins', 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  if (profile) {
    const source = profile.engine === 'claude' ? 'claude-runner-adapter.ts' : 'isolated-adapter.ts';
    const module = JSON.stringify(pathToFileURL(path.join(root, 'src/workbench', source)).href);
    await writeFile(entry, profile.engine === 'claude' ? 'import { claudeRunnerAdapter } from ' + module
      + '; export default claudeRunnerAdapter(' + JSON.stringify(profile.execution!.provider) + ');'
      : 'export { default } from ' + module, { mode: 0o600 });
  } else {
    const source = (name: string) => runtime('autoloop', 'plugins', name, 'agent.ts');
    await copyFile(source(adapter), entry).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return copyFile(source(formerName(adapter)), entry);
    });
  }
  await chmod(entry, 0o600);
  const historical = path.join(home, 'plugins', formerName(adapter), 'agent.ts');
  if (await stat(historical).then(() => true, () => false)) {
    await copyFile(entry, historical);
    await chmod(historical, 0o600);
  }
}
