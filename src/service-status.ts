import { request as httpRequest } from 'node:http';

/**
 * 国内服务清单的唯一数据来源。
 *
 * 原则：只有真正探测到、且身份校验通过的本机服务才带 url；
 * 未接通（或探测失败）的服务只带状态、原因与可照做的接通说明，
 * 绝不带 url / 可点入口。前端据此渲染，避免「写了名字但没有连接」的空壳链接。
 */

export type ServiceState = 'connected' | 'unavailable' | 'degraded';
export type ServiceCategory = 'local' | 'domestic' | 'overseas';

export interface ServiceEntry {
  id: string;
  name: string;
  category: ServiceCategory;
  state: ServiceState;
  detail: string;
  /** 仅 connected 且通过 loopback 校验时才存在。 */
  url?: string;
  /** 未接通时给出可照做的步骤，纯文本，不是入口。 */
  setup?: string;
  /** 状态来源，便于用户判断这是实时探测还是监听器事件推断。 */
  source: string;
}

export interface ServiceStatusReport {
  ok: boolean;
  checkedAt: string;
  loopbackOnly: boolean;
  connected: number;
  unavailable: number;
  services: ServiceEntry[];
  note: string;
}

export interface ProbeResult {
  statusCode: number;
  body: Record<string, unknown> | null;
  /** 非 JSON 响应（如 Paperclip 工作台的 HTML 回退）仍需保留原文用于身份判断。 */
  text?: string;
}

export type Probe = (port: number, path?: string) => Promise<ProbeResult | null>;

/** 直连 loopback 探测，绕过可能失效的环境代理。绝不请求外部地址。 */
export function loopbackProbe(port: number, path = '/health', timeoutMs = 900): Promise<ProbeResult | null> {
  return new Promise(resolve => {
    let settled = false;
    const done = (value: ProbeResult | null) => { if (!settled) { settled = true; resolve(value); } };
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { parsed = null; }
        done({ statusCode: res.statusCode ?? 0, body: parsed, text: body.slice(0, 2000) });
      });
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end();
  });
}

/** 前端也用同一套规则：只放行本机 loopback 的 http 链接。 */
export function safeLoopbackUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export interface ServiceStatusInput {
  paperclipPort: number;
  deliveryPort: number;
  gitPort: number;
  visionPort: number;
  reportPort: number;
  acceptanceMode: string;
  visualReviewerMode: string;
  feishuState: string;
  probes: Record<string, ProbeResult | null>;
  checkedAt?: string;
}

const isOk = (probe: ProbeResult | null | undefined, extra?: (body: Record<string, unknown>) => boolean): boolean =>
  probe?.statusCode === 200 && probe.body?.ok === true && (!extra || extra(probe.body));

/** 只认本机交付台自己的健康响应，避免端口被别的服务占用时误判为「已接通」。 */
function deliveryVerified(probe: ProbeResult | null | undefined, port: number): boolean {
  return isOk(probe, body => body.scope === 'loopback-only' && body.provider === 'local-git' && body.port === port);
}

const NOT_CONNECTED: Array<Omit<ServiceEntry, 'state' | 'detail'>> = [
  { id: 'wecom', name: '企业微信', category: 'domestic',
    setup: '先在企业微信后台配置应用凭据与可信 IP，再实现并实测消息/组织接口；接通后此页自动出现入口。', source: '凭据检查' },
  { id: 'tencent-docs', name: '腾讯文档 / 腾讯问卷', category: 'domestic',
    setup: '先取得开放平台授权并确认可用 scope，再实现文档读写适配器；接通后此页自动出现入口。', source: '凭据检查' },
  { id: 'dingtalk', name: '钉钉', category: 'domestic',
    setup: '先配置钉钉应用凭据与事件订阅，再实测消息与组织同步；接通后此页自动出现入口。', source: '凭据检查' },
  { id: 'domestic-git', name: 'Gitee / CNB / 工蜂', category: 'domestic',
    setup: '先确认仓库、账号与 token，并把交付适配器切到对应 provider 后实测 push / pull；当前默认走本机 Git。', source: '凭据检查' },
  { id: 'cloud-ci', name: '公有云 CI', category: 'domestic',
    setup: '先配置流水线与凭据，再让交付记录引用真实构建结果；当前 CI 在本机校验。', source: '凭据检查' },
];

/**
 * 纯函数：把探测结果组装成清单。便于单元测试覆盖「接通 / 未接通 / 冒名服务」三种情况，
 * 也保证前端拿到的数据结构在任何机器上都是一致的。
 */
export function buildServiceStatus(input: ServiceStatusInput): ServiceStatusReport {
  const { probes } = input;
  const services: ServiceEntry[] = [];
  const loopbackUrl = (port: number, path = '/') => `http://127.0.0.1:${port}${path}`;

  // Paperclip 的 /health 是 SPA 回退：任何人访问都返回 200 + HTML，不是 JSON。
  // 因此既接受 JSON {status:'ok'}，也接受带 <html 的 200；其他响应不算接通。
  const paperclipProbe = probes.paperclip;
  const paperclipOk = paperclipProbe?.statusCode === 200
    && (paperclipProbe.body?.status === 'ok' || /<html[\s>]/i.test(paperclipProbe.text ?? ''));
  services.push({
    id: 'paperclip', name: '本机协作服务', category: 'local',
    state: paperclipOk ? 'connected' : 'unavailable',
    detail: paperclipOk ? '本机服务运行中（工作台入口返回 200），当前页面由其承载' : '本机服务未响应，工作台可能无法加载',
    ...(paperclipOk ? { url: safeLoopbackUrl(loopbackUrl(input.paperclipPort))! } : { setup: '运行 npm run up 启动本机工作台与 Bridge。' }),
    source: '本机 /health 实时探测',
  });

  // Bridge 就是正在响应本次读取的进程，无需再发一次 HTTP 请求。
  services.push({
    id: 'bridge', name: '中文协作台数据通道', category: 'local', state: 'connected',
    detail: '当前会话已连接；本次状态读取由它直接回答', source: '进程内判定',
  });

  const deliveryOk = deliveryVerified(probes.delivery, input.deliveryPort);
  services.push({
    id: 'delivery', name: '本机代码交付台', category: 'local',
    state: deliveryOk ? 'connected' : 'unavailable',
    detail: deliveryOk
      ? `已接通 · 本机 Git 服务（git://127.0.0.1:${input.gitPort}/），含本机 CI、合并审批与固定版本预览`
      : '未启动，或该端口被非交付台服务占用（已拒绝误判）',
    ...(deliveryOk ? { url: safeLoopbackUrl(loopbackUrl(input.deliveryPort))! } : { setup: '运行 npm run delivery:serve；启动后点「刷新状态」即可出现入口，无需重载页面。' }),
    source: '本机 /health 实时探测 + 服务身份校验',
  });

  const chainOn = input.acceptanceMode === 'independent';
  const visionOk = isOk(probes.vision);
  services.push({
    id: 'vision', name: '本机视觉评审端点', category: 'local',
    state: visionOk ? (chainOn ? 'connected' : 'degraded') : 'unavailable',
    detail: !visionOk ? '端点未启动' : chainOn
      ? `端点在线；独立评审链已启用（${input.visualReviewerMode === 'model' ? '本机视觉模型' : '结构式核对，不判断图像内容'}）`
      : '端点在线，但当前是 legacy 验收链，视觉评审未挂接',
    setup: !visionOk ? '运行 npm run vision:start；是否启用取决于 acceptance.mode=independent。' : undefined,
    source: '本机 /health 实时探测 + 验收链配置',
  });

  const reportOk = isOk(probes.report);
  services.push({
    id: 'report', name: '本机验收报告与总览', category: 'local',
    state: reportOk ? 'connected' : 'unavailable',
    detail: reportOk ? '只读报告服务运行中' : '报告服务未启动',
    ...(reportOk ? { url: safeLoopbackUrl(loopbackUrl(input.reportPort, '/overview'))! } : { setup: '运行 npm run acceptance:serve 4192；启动后点「刷新状态」。' }),
    source: '本机 /health 实时探测',
  });

  const feishuReady = input.feishuState === 'ready';
  services.push({
    id: 'feishu', name: '飞书消息与组织', category: 'domestic',
    state: feishuReady ? 'connected' : 'unavailable',
    detail: feishuReady ? '监听器已就绪 · 仅 allowlist 本人单聊；工作台不代发' : `监听器状态：${input.feishuState || '未配置'}`,
    ...(feishuReady ? {} : { setup: '确认 lark-cli 已登录且 feishu.enabled=true，再运行 npm run up 重启监听器。' }),
    source: '监听器事件推断（非实时链路探测）',
  });

  for (const entry of NOT_CONNECTED) {
    services.push({ ...entry, state: 'unavailable',
      detail: '本机没有授权凭据，也未实测接通；不提供入口' });
  }

  const connected = services.filter(s => s.state === 'connected').length;
  return {
    ok: true,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    loopbackOnly: true,
    connected,
    unavailable: services.length - connected,
    services,
    note: '只有实时探测成功且通过服务身份校验的条目才带 url；未接通条目只给状态与接通步骤，没有任何可点入口。',
  };
}

/** 组装真实探测：各端点并发，互不阻塞；某个端点失败不影响其他条目。 */
export async function collectServiceStatus(
  input: Omit<ServiceStatusInput, 'probes' | 'checkedAt'>,
  probe: Probe = loopbackProbe,
): Promise<ServiceStatusReport> {
  const keys = ['paperclip', 'delivery', 'vision', 'report'] as const;
  const ports: Record<typeof keys[number], number> = {
    paperclip: input.paperclipPort, delivery: input.deliveryPort,
    vision: input.visionPort, report: input.reportPort,
  };
  const results = await Promise.all(keys.map(key => probe(ports[key]).catch(() => null)));
  const probes: Record<string, ProbeResult | null> = {};
  keys.forEach((key, index) => { probes[key] = results[index] ?? null; });
  return buildServiceStatus({ ...input, probes });
}
