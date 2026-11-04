import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, runtime, loadConfig } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';

// Install the pinned upstream UI and storage, without reimplementing a wiki or enabling organization-wide ingestion.
const repo = path.join(root, 'upstream/paperclip'), folder = path.join(repo, 'packages/plugins/plugin-llm-wiki');
const result = spawnSync('corepack', ['pnpm', '--filter', '@paperclipai/plugin-llm-wiki', 'build'], {
  cwd: repo, stdio: 'inherit', env: { ...process.env, PATH: `${runtime('corepack-bin')}${path.delimiter}${process.env.PATH}` },
});
if (result.status !== 0) throw new Error('Pinned Wiki build failed');
// The plugin declares React as a peer; the host supplies the same installed UI React for local tests.
if (!existsSync(path.join(folder, 'node_modules/react'))) symlinkSync(realpathSync(path.join(repo, 'ui/node_modules/react')), path.join(folder, 'node_modules/react'), 'dir');
const config = loadConfig(), pc = new Paperclip(config.paperclipUrl);
let plugin = (await pc.get<any[]>('/plugins')).find(p => p.pluginKey === 'paperclipai.plugin-llm-wiki');
if (!plugin) plugin = await pc.post('/plugins/install', { packageName: folder, isLocalPath: true });
if (plugin.status !== 'ready') throw new Error(`Wiki plugin is ${plugin.status}; inspect its lifecycle before retrying`);
const base = `/plugins/${plugin.id}`;
const action = (key: string, params: unknown) => pc.post(`${base}/actions/${key}`, { companyId: config.companyId, params });
mkdirSync(runtime('knowledge-wiki'), { recursive: true });
await pc.request('PUT', `${base}/companies/${config.companyId}/local-folders/wiki-root`, { path: runtime('knowledge-wiki') });
await action('bootstrap-space', { wikiId: 'default', spaceSlug: 'default' });
// The upstream bootstrap-root creates a native Claude agent using settings unsupported by this pinned native runner.
// Supported selection actions reuse our existing manual endpoint instead; no background model is launched.
await action('select-managed-agent', { agentId: config.agents.manual!.paperclipId });
await action('select-managed-project', { projectId: config.projectId });
const overview = await pc.post(`${base}/data/overview`, { companyId: config.companyId, params: {} });
if (!overview.data.folder.healthy || overview.data.eventIngestion.enabled) throw new Error('Wiki readiness or ingestion scope needs review');
console.log(JSON.stringify({ pluginId: plugin.id, status: plugin.status, folderHealthy: true, automaticIngestion: false, privateKnowledgeIndexing: false }));
