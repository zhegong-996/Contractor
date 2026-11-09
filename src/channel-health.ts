/**
 * 第三十九轮 · 通道体检（只读）。
 *
 * 为什么要有它：本轮的边界原来是「还没有新的飞书真实工单」—— 一句什么都说明不了
 * 的话：是通道坏了？凭据缺了？还是没人发？人每次都要重新排查一遍。
 *
 * 这里把「通道能不能用」压成一张可以反复看的表：每条通道只回答三件事 ——
 *   ① 现在什么状态（ready / partial / blocked / off）；
 *   ② 依据是哪些事实（凭据在不在、白名单几人、上次真实工单是什么时候）；
 *   ③ 缺什么、下一步做什么（一句话，可照做）。
 *
 * 纪律：
 *   - **不探测网络**：这里只读配置与本地台账，不发任何外部请求，因此可以在任何
 *     时刻被调用，也不会因为对方超时把「体检」变成「故障」；
 *   - **partial 不是失败**：能连但没人能发、能收但没有历史工单，都是 partial，
 *     如实说清楚，不粉饰成 ready；
 *   - **不冒充**：真实工单的证据只从任务台账里取（真实 chatId + 真实 sender），
 *     没有就写没有，不用模拟任务充数。
 */

export type ChannelVerdict = 'ready' | 'partial' | 'blocked' | 'off';

export type ChannelCheck = {
  id: string;
  name: string;
  /** 这条通道是「收」「发」还是「既收又发」。 */
  direction: 'inbound' | 'outbound' | 'both';
  verdict: ChannelVerdict;
  facts: string[];
  missing: string[];
  /** 一句话可照做的下一步；ready 时写「无需动作」。 */
  next: string;
};

export type ChannelHealthInput = {
  /** state 直接来自 bridge 的 feishuState：connecting / ready / disconnected / disabled。 */
  feishu: { enabled: boolean; state: 'connecting' | 'ready' | 'disconnected' | 'disabled'; appId: string; allowedSenders: number; allowedChats: number };
  github: { enabled: boolean; repository: string; tokenConfigured: boolean; webhookSecretConfigured: boolean };
  im: { dingtalkConfigured: boolean; wecomConfigured: boolean };
  inbox: { enabled: boolean; claimed: string[]; pending: number; mirrored: number };
  /** 真实来源工单的证据（来自任务台账，不是模拟数据）。 */
  realStories: { total: number; lastAt?: string; lastIdentifier?: string };
};

export type ChannelHealthReport = {
  at: string;
  checks: ChannelCheck[];
  summary: { ready: number; partial: number; blocked: number; off: number };
  /**
   * 一句话结论：能干活吗。只按 blocked 判定 —— partial 表示「能用但有缺口」，
   * 不能因为某个通道没配就把整体说成不可用。
   */
  verdict: 'ready' | 'degraded' | 'blocked';
  note: string;
};

const stamp = (at?: string): string => (at ? at.replace('T', ' ').slice(0, 16) : '从未');

export function buildChannelHealth(input: ChannelHealthInput, now: Date = new Date()): ChannelHealthReport {
  const checks: ChannelCheck[] = [];

  // 飞书：唯一的「人对人」入口。判据是长连接起来 + 至少一个人能发。
  // 「刚启动还在 connecting」与「断开」必须分开说：前者是几秒钟的事，后者要人动手。
  {
    const state = input.feishu.state;
    const label = { ready: '长连接已就绪', connecting: '长连接正在建立', disconnected: '长连接已断开', disabled: '未启用' }[state];
    const facts: string[] = [
      `监听状态：${label}`,
      `应用：${input.feishu.appId || '未配置'}`,
      `白名单：${input.feishu.allowedSenders} 人 / ${input.feishu.allowedChats} 群`,
    ];
    const missing: string[] = [];
    if (!input.feishu.enabled || state === 'disabled') missing.push('通道被关闭（feishu.enabled=false）');
    if (!input.feishu.appId) missing.push('缺 appId');
    if (state === 'disconnected') missing.push('长连接已断开（lark-cli 进程退出或授权过期）');
    if (state === 'connecting') missing.push('长连接还在建立（刚启动时正常，超过 30 秒仍如此需查授权）');
    if (!input.feishu.allowedSenders && !input.feishu.allowedChats) missing.push('白名单为空，任何人都发不进来');
    const verdict: ChannelVerdict = !input.feishu.enabled || state === 'disabled' ? 'off'
      : !input.feishu.appId || state === 'disconnected' ? 'blocked'
        : state === 'connecting' ? 'partial'
          : (input.feishu.allowedSenders || input.feishu.allowedChats) ? 'ready' : 'partial';
    checks.push({
      id: 'feishu', name: '飞书', direction: 'both', verdict, facts, missing,
      next: verdict === 'ready' ? '无需动作；在白名单群里发一句话即可建单'
        : verdict === 'off' ? '需要时把 feishu.enabled 打开'
          : state === 'disconnected' ? '看 bridge 日志里 lark-cli 的退出原因；重跑授权后执行 npm run doctor 复核'
            : state === 'connecting' ? '稍等几秒再看；仍不 ready 就重跑 lark-cli 授权'
              : '把要发起需求的人加进 feishu.allowedSenders（或群加进 allowedChats）',
    });
  }

  // GitHub：轮询（token）与 webhook（secret）任一即可收，两个都有最稳。
  {
    const facts = [
      `仓库：${input.github.repository || '未配置'}`,
      `轮询令牌：${input.github.tokenConfigured ? '已配置' : '未配置'}`,
      `Webhook 密钥：${input.github.webhookSecretConfigured ? '已配置' : '未配置'}`,
    ];
    const missing: string[] = [];
    if (!input.github.enabled) missing.push('监听被关闭');
    // 两个都没配也判 partial 而不是 blocked：轮询优先走 gh CLI，本机已登录时照样能收，
    // 而体检不探测 gh 登录态（那需要进程调用），不能把「不确定」说成「不可用」。
    if (!input.github.tokenConfigured && !input.github.webhookSecretConfigured) {
      missing.push('token 与 webhook 密钥都没配；若本机 gh 已登录，轮询仍可用（体检不探测登录态）');
    }
    const verdict: ChannelVerdict = !input.github.enabled ? 'off'
      : input.github.tokenConfigured && input.github.webhookSecretConfigured ? 'ready' : 'partial';
    checks.push({
      id: 'github', name: 'GitHub', direction: 'inbound', verdict, facts, missing,
      next: verdict === 'ready' ? '无需动作'
        : !input.github.tokenConfigured ? '补 GITHUB_WATCH_TOKEN 可启用轮询（不依赖公网回调）'
          : '补 GITHUB_WEBHOOK_SECRET 可启用 webhook 实时推送',
    });
  }

  // 事件收件箱：登记了来源才算有入站面；密钥缺失由 event-inbox-status 细查。
  {
    const facts = [
      `接管来源：${input.inbox.claimed.length ? input.inbox.claimed.join('、') : '无'}`,
      `待分流 ${input.inbox.pending} 条 / 已留痕 ${input.inbox.mirrored} 条`,
    ];
    const verdict: ChannelVerdict = !input.inbox.enabled ? 'off' : input.inbox.claimed.length ? 'ready' : 'off';
    checks.push({
      id: 'event-inbox', name: '通用事件源', direction: 'inbound', verdict,
      facts,
      missing: input.inbox.claimed.length ? [] : ['没有登记来源，POST /events/:source 一律拒收'],
      next: input.inbox.claimed.length ? '无需动作' : '要接 GitLab 或业务系统时，在 eventInbox.sources 登记来源与密钥',
    });
  }

  // 钉钉 / 企微：按需开启，没配不算问题，但也别写成 ready。
  {
    const on = [input.im.dingtalkConfigured ? '钉钉' : '', input.im.wecomConfigured ? '企微' : ''].filter(Boolean);
    checks.push({
      id: 'im', name: '钉钉 / 企微', direction: 'both', verdict: on.length ? 'ready' : 'off',
      facts: [`已配置：${on.length ? on.join('、') : '无'}`],
      missing: on.length ? [] : ['未配置出站 webhook（按需）'],
      next: on.length ? '无需动作' : '需要把进展同步到钉钉/企微时，再配对应的 webhook 与加签密钥',
    });
  }

  // 真实工单：这不是通道，是「通道真的被用过」的证据 —— 单列一条，避免自证。
  {
    const facts = [
      `真实来源工单：${input.realStories.total} 条`,
      `最近一条：${input.realStories.lastIdentifier ? `${input.realStories.lastIdentifier}（${stamp(input.realStories.lastAt)}）` : '无'}`,
    ];
    checks.push({
      id: 'real-story', name: '真实工单证据', direction: 'inbound',
      verdict: input.realStories.total > 0 ? 'ready' : 'partial',
      facts,
      missing: input.realStories.total > 0 ? [] : ['台账里还没有来自真实 IM 会话的工单（模拟/本机任务不算）'],
      next: input.realStories.total > 0 ? '无需动作' : '在飞书白名单群里发一句真实需求，即可产生第一条真实工单',
    });
  }

  const summary = { ready: 0, partial: 0, blocked: 0, off: 0 };
  for (const check of checks) summary[check.verdict === 'ready' ? 'ready' : check.verdict === 'partial' ? 'partial' : check.verdict === 'blocked' ? 'blocked' : 'off'] += 1;
  const verdict: ChannelHealthReport['verdict'] = summary.blocked > 0 ? 'blocked' : summary.partial > 0 ? 'degraded' : 'ready';
  return {
    at: now.toISOString(),
    checks,
    summary,
    verdict,
    note: verdict === 'blocked' ? '有通道连不上，先按 missing / next 补齐'
      : verdict === 'degraded' ? '没有硬阻断；partial 表示「能用但还缺一块」，不粉饰成 ready'
        : '通道齐备；未配置的通道标 off，不算故障',
  };
}
