/** Operational pause: retain delivery for retry, never pretend it was sent. */
export function notificationGuard(paused: boolean, testDingTalkConnector?: string) {
  const permits = (address?: { kind: string; connector: string; direct: boolean }) => !paused ||
    (!!testDingTalkConnector && address?.kind === 'dingtalk' && address.connector === testDingTalkConnector && address.direct);
  return {
    paused, permits,
    async deliver<T>(send: () => Promise<T>, address?: Parameters<typeof permits>[0]): Promise<T> {
      if (!permits(address)) throw new Error('通知外发已暂停，保留原投递等待恢复。');
      return send();
    },
  };
}
