import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertWorkspaceAction } from './action-name.js';
declare const SUITME_STATE_DIR: string;
const plugin = definePlugin({
  async setup(ctx) {
    // Use an action even for reads: only the action transport supplies an immutable host actor.
    // Neither UI params nor an agent's payload may select the authenticated principal.
    ctx.actions.register('workspace', async (params, context) => {
      const config = JSON.parse(readFileSync(path.join(SUITME_STATE_DIR, 'config.json'), 'utf8'));
      if (!context.actor.companyId || context.actor.companyId !== config.companyId) throw new Error('Unauthorized company');
      const auth = JSON.parse(readFileSync(path.join(SUITME_STATE_DIR, 'secrets.json'), 'utf8'));
      const action = assertWorkspaceAction(params.action);
      const response = await fetch('http://127.0.0.1:' + config.bridgePort + '/workspace/' + action, {
        method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.workspacePluginToken },
        body: JSON.stringify({ hostActor: context.actor, payload: params.payload ?? {} }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Workspace operation failed');
      return result;
    });
  },
});
export default plugin;
runWorker(plugin, import.meta.url);
