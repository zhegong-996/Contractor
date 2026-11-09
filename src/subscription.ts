/**
 * 订阅生命周期（第四十一轮 · 对齐 DeepSeek Super-agent 的 Subscriptions）。
 *
 * 直通解决的是「同一会话的补充说明不要重新建单」。但上游还有两件事我们没做：
 *   - **释放（release）**：任务验收后，这条线程的订阅就该结束。旧实现里
 *     「已验收 → 不复活」是隐含在判定顺序里的副作用，没有留下「什么时候释放」
 *     的事实，事后也查不到；
 *   - **交回（hand-back）**：线程里出现「要改授权面」的要求（换人、改清单、
 *     加权限、换来源），执行端不该自己看着办，也不该被当成补充说明塞进上下文，
 *     而应原样交回主链路，由派活层与账号体系决定。
 *
 * 这里把两件事写成两个纯判定：
 *   `subscriptionStateOf`  订阅当前处于 held / handed-back / released；
 *   `classifyFollowupScope` 这句话在本任务授权范围内，还是越界。
 *
 * 交回的口径比「识别意图」更保守：只认四类**明确要改授权面**的说法，宁可漏、
 * 不可误——误判会把正常的补充说明推去建新单。漏判的代价只是沿用原链路。
 */

export const SUBSCRIPTION_STATES = ['held', 'handed-back', 'released'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** 越界意图：全部是「要改的授权面」，不是「换个说法继续」。模式刻意收紧。 */
export const OUT_OF_SCOPE_INTENTS: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: 'plan-change', label: '改验收清单',
    pattern: /((改|改掉|调整|删掉|去掉|增加|加).{0,6}(清单|标准|检查项))|((清单|标准|检查项).{0,6}(改|调整|删|去掉|加|少))/ },
  { id: 'reassign', label: '换执行方',
    pattern: /((换|更换|转给|交给|改由).{0,6}(别人|他人|同事|其他成员|另一个人|其他人))|((人员|执行方|执行人).{0,4}(换|更换))/ },
  { id: 'grant', label: '改权限或范围',
    pattern: /((给|授予|增加|放开|开放|取消).{0,10}(权限|授权|访问范围))|((权限|授权).{0,6}(给|开|放开|取消|收回))/ },
  { id: 'source-change', label: '换来源',
    pattern: /((改|换|增加|加|删掉|移除).{0,6}(来源|数据源|参考资料))|((来源|数据源|参考资料).{0,6}(改|换|增加|删掉|移除))/ },
];

export type ScopeVerdict = {
  scope: 'in-scope' | 'out-of-scope';
  intent: string | null;
  label: string | null;
  reason: string;
};

/**
 * 判定一句补充说明是否越界。
 * 没有命中任何越界意图 → in-scope（沿用原链路，交给原任务的承接方）。
 */
export function classifyFollowupScope(text: string): ScopeVerdict {
  const body = String(text ?? '');
  for (const intent of OUT_OF_SCOPE_INTENTS) {
    if (intent.pattern.test(body))
      return {
        scope: 'out-of-scope', intent: intent.id, label: intent.label,
        reason: `这条要求涉及「${intent.label}」，超出当前任务的授权范围，交回主链路处理`,
      };
  }
  return { scope: 'in-scope', intent: null, label: null, reason: '本任务的补充说明，未触及授权面' };
}

/**
 * 订阅当前状态。释放是**终态**：任务验收后同一绑定不再复活，只能新建单。
 * `released` 由审计事实（subscription.released）传入，不从 phase 猜——
 * phase 只是辅助，验收回执才是「释放已发生」的证据。
 */
export function subscriptionStateOf(input: {
  phase: string;
  released?: boolean;
  handedBack?: boolean;
}): SubscriptionState {
  if (input.released === true || input.phase === 'accepted') return 'released';
  if (input.handedBack === true) return 'handed-back';
  return 'held';
}

/** 订阅状态的下一步（给控制台 / 文档展示用，不参与判定）。 */
export function subscriptionNextStep(state: SubscriptionState): string {
  if (state === 'released') return '订阅已释放：在同一会话继续说话会按新需求处理，不会复活这张单';
  if (state === 'handed-back') return '已交回主链路：下一条消息按新需求或显式指令处理';
  return '订阅在持：同一会话的补充说明直接接续原任务，权限与验收范围不变';
}
