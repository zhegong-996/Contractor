import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, loadConfig } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
const folder = path.join(root, 'plugins/knowledge-workspaces');
const sdk = path.join(root, 'upstream/paperclip/packages/plugins/sdk');
mkdirSync(path.join(folder, 'node_modules/@paperclipai'), { recursive: true });
if (!existsSync(path.join(folder, 'node_modules/@paperclipai/plugin-sdk'))) symlinkSync(sdk, path.join(folder, 'node_modules/@paperclipai/plugin-sdk'), 'dir');
const fromWiki = createRequire(path.join(root, 'upstream/paperclip/packages/plugins/plugin-llm-wiki/package.json'));
const esbuild = fromWiki('esbuild');
const { createPluginBundlerPresets } = await import(pathToFileURL(path.join(sdk, 'dist/bundlers.js')).href);
const presets = createPluginBundlerPresets({ uiEntry: 'src/ui/index.tsx' });
for (const [kind, options] of Object.entries(presets.esbuild)) await esbuild.build({ ...(options as object), absWorkingDir: folder,
  define: kind === 'worker' ? { SUITME_STATE_DIR: JSON.stringify(runtime()) } : {}, jsx: 'automatic' });
if (process.argv.includes('--build-only')) { console.log('Workspace worker, manifest and UI built from the pinned SDK'); process.exit(0); }
const pc = new Paperclip(loadConfig().paperclipUrl), plugins = await pc.get<any[]>('/plugins');
let plugin = plugins.find(p => p.pluginKey === 'suitme.knowledge-workspaces');
if (!plugin) plugin = await pc.post('/plugins/install', { packageName: folder, isLocalPath: true });
else {
  await pc.post('/plugins/' + plugin.id + '/disable', { reason: 'Reload compiled local workspace extension' });
  await pc.post('/plugins/' + plugin.id + '/enable', {});
}
console.log(JSON.stringify({ pluginId: plugin.id, route: '/knowledge-workspaces', upstreamModified: false }));
