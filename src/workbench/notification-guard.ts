import type { OutboundMessage } from '../../upstream/superagent/src/core/index.ts';

/** Operational pause: retain delivery for retry, never pretend it was sent. */
export function notificationGuard(paused: boolean, testDingTalkConnector?: string, testFeishuReply?: string) {
  const permits = (address?: { kind: string; connector: string; direct: boolean }) => !paused ||
    (!!testDingTalkConnector && address?.kind === 'dingtalk' && address.connector === testDingTalkConnector && address.direct);
  function permitsFeishuReply(message: OutboundMessage) {
    const { address, source } = message.channel;
    return !!testFeishuReply && message.id === testFeishuReply && message.kind === 'reply' && !!message.ticketId
      && source === 'feishu' && !!address.conversationAuthor && !!address.chatId && !!address.messageId && !address.direct && !address.userId;
  }
  return {
    paused, permits,
    async deliver<T>(send: () => Promise<T>, address?: Parameters<typeof permits>[0], message?: OutboundMessage): Promise<T> {
      if (!permits(address) && !(message && permitsFeishuReply(message))) throw new Error('通知外发已暂停，保留原投递等待恢复。');
      return send();
    },
  };
}
