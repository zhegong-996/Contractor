import type { Adapter, Reading } from '../../upstream/autoloop/worker/agents.ts';

export default {
  command: turn => [
    turn.command![0]!, '--print', '--output-format', 'stream-json', '--sandbox', 'enabled',
    ...(turn.access === 'edit' ? ['--trust'] : []),
    ...(turn.access === 'read' ? ['--mode', 'ask'] : []),
    ...(turn.model ? ['--model', turn.model] : []),
    ...(turn.resume ? ['--resume', turn.resume] : []),
    turn.prompt,
  ],
  read(stdout, code, stderr) {
    const receipt: Reading = {};
    for (const line of stdout.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (typeof event.session_id === 'string') receipt.session = event.session_id;
        if (event.type === 'system' && event.subtype === 'init') receipt.started = true;
        if (event.type === 'result' && event.subtype === 'success' && !event.is_error && typeof event.result === 'string') {
          receipt.finished = true;
          receipt.text = event.result;
        }
      } catch { /* The last streamed line can be incomplete. */ }
    }
    if (code !== null && (code !== 0 || !receipt.finished)) receipt.error = stderr.trim().slice(-450) || 'Cursor 未完成本轮。';
    return receipt;
  },
} satisfies Adapter;
