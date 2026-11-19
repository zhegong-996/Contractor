import path from 'node:path';
import { createRequire } from 'node:module';
import { root } from '../config.ts';
import type { Adapter } from './execution/protocol.ts';
import { consultationReplyType } from './channel-links.ts';
const loader = createRequire(path.join(root, 'package.json')).resolve('tsx');

export default {
  command(turn) {
    return [process.execPath, '--import', loader, path.join(root, 'src/workbench/octop-launch.ts'),
      ...(turn.command ?? []), turn.contextFile, turn.model ?? ''];
  },
  read(stdout, code) {
    if (code === null) return {};
    if (code !== 0) return { error: '只读模型执行失败，请核对本机配置和模型服务' };
    try {
      const { text, session, usage, consultation, stopReason } = JSON.parse(stdout.trim());
      if (typeof text !== 'string' || typeof session !== 'string') return { error: '只读模型未返回有效回执' };
      if (stopReason !== 'end_turn' && stopReason !== 'stop')
        return { session, usage: usage ?? undefined, error: '只读模型未正常结束，成果不完整' };
      const body = text.trim();
      if (!body || consultation && [...body].length > 4000)
        return { session, usage: usage ?? undefined, error: '只读模型回复为空或超出长度' };
      const message = consultation ? '咨询已回复\n\n```agent-autoloop\n' + JSON.stringify({
        events: [{ id: 'consultation-reply', type: consultationReplyType, detail: body }],
      }) + '\n```' : body.replace(/\s+/g, ' ');
      return { text: message, session, usage: usage ?? undefined, finished: true, started: true };
    } catch { return { error: '只读模型回执无法读取' }; }
  },
} satisfies Adapter;
