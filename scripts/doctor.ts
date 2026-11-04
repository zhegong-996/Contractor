import { loadConfig, root } from '../src/config.ts';
import { adapterFor } from '../src/upstream.ts';
import { command } from '../src/commands.ts';
const config = loadConfig();
const status: Record<string, unknown> = { root, repository: config.repository, agents: {} };
status.paperclip = await fetch(`${config.paperclipUrl}/api/health`).then(r => ({ reachable: r.ok })).catch(() => ({ reachable: false }));
status.bridge = await fetch(`http://127.0.0.1:${config.bridgePort}/health`).then(r => r.json()).catch(() => ({ reachable: false }));
for (const [key, agent] of Object.entries(config.agents)) {
  let error: string | null = null;
  if (agent.enabled && agent.mode === 'managed') { try { const adapter = await adapterFor(agent.use); error = adapter.check?.() ?? (agent.use === 'command' && !agent.command?.length ? 'Command not configured' : null); } catch (e) { error = String(e); } }
  (status.agents as Record<string, unknown>)[key] = { enabled: agent.enabled, mode: agent.mode, readiness: !agent.enabled ? 'disabled' : agent.mode === 'manual' ? 'connector-ready; external session not verified' : error ?? 'cli-ready; live run still required' };
}
try {
  const auth = JSON.parse(await command('lark-cli', ['--profile', config.feishu.profile, 'auth', 'status', '--json', '--verify']));
  status.feishu = { enabled: config.feishu.enabled, botReady: auth.identities?.bot?.verified ?? false, appId: auth.appId };
} catch { status.feishu = { enabled: false, setupRequired: true }; }
console.log(JSON.stringify(status, null, 2));
