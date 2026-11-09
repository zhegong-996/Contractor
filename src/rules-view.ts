/**
 * 规则视图（第四十一轮 · 对齐 Agent Autoloop 的「一份 JSON 说清全部」）。
 *
 * 我们的配置散在四处：`router`（谁派给谁）、`scheduler`（什么时候跑什么）、
 * `eventInbox`（谁能投事件）、`agentRegistry`（谁在哪个域在岗），再加通道白名单
 * 与验收/交付档位。接手一个实例时，读四份配置才能回答「昨天那单为什么没跑」。
 *
 * 这里做的**不是**新配置层，而是把一个实例的配置读成一份按问题组织的人话视图：
 *   - 每个字段都标来源路径（`config.router.mode`）与「显式配置 / 取默认值」；
 *   - 并发配额、分层降级这类判据直接复用运行时函数（routineParallel 等），
 *     不另写一套解释，避免视图与实际行为漂移；
 *   - 只读：不写盘、不改运行时、不调用模型。
 *
 * 想改行为仍然改原配置——视图不提供第二个写入口，这是刻意设计。
 */
import type { Config } from './config.ts';
import { routineParallel, routineGroup } from './scheduler.ts';

export type RuleOrigin = 'explicit' | 'default';
export type RuleField = {
  /** 人话标签。 */
  label: string;
  value: string;
  /** 配置来源路径，用于「这行从哪来」。 */
  source: string;
  origin: RuleOrigin;
  note?: string;
};

export type RuleSection = {
  id: 'dispatch' | 'routines' | 'events' | 'agents' | 'channels' | 'acceptance' | 'delivery';
  title: string;
  /** 这一节回答的问题。 */
  question: string;
  fields: RuleField[];
  /** 逐条例程 / 来源 / 通道的明细行。 */
  rows?: { id: string; title: string; detail: string; status: string }[];
  notes: string[];
};

export type RulesView = {
  schemaVersion: 1;
  generatedFrom: string;
  modelCalls: 0;
  sections: RuleSection[];
  /** 一眼能看出的「全部取默认值」的配置（接手时最容易被忽略的地方）。 */
  defaulted: string[];
  notes: string[];
};

const field = (label: string, value: string, source: string, origin: RuleOrigin, note?: string): RuleField =>
  ({ label, value, source, origin, ...(note ? { note } : {}) });

const onOff = (value: boolean) => (value ? '开启' : '关闭');

export function buildRulesView(config: Config, options: { generatedAt?: string } = {}): RulesView {
  const router = config.router;
  const registry = config.agentRegistry;
  const scheduler = config.scheduler;
  const inbox = config.eventInbox;
  const acceptance = config.acceptance;
  const delivery = config.delivery;

  const dispatch: RuleSection = {
    id: 'dispatch', title: '派活：谁接这一棒', question: '一个需求进来，经过几层、谁来决定',
    fields: [
      field('派活模式', router.mode === 'flat' ? '扁平（1 跳）' : router.mode === 'layered' ? '分层（最多 2 跳）' : '沿用改造前直写（legacy）',
        'config.router.mode', 'explicit',
        router.mode === 'layered' ? '主管必须真实在岗、职责匹配、范围覆盖，缺一即退回 1 跳' : undefined),
      field('最多跳数', String(router.maxHops), 'config.router.maxHops', 'explicit', '极限保护：即使分层也不超过 2 跳'),
      field('已配置的业务域', Object.keys(router.domains).length ? Object.keys(router.domains).join('、') : '无',
        'config.router.domains', Object.keys(router.domains).length ? 'explicit' : 'default'),
      field('默认业务域', router.defaultDomain ?? '未设置（按调用方给域）', 'config.router.defaultDomain',
        router.defaultDomain ? 'explicit' : 'default'),
      field('直通边界', '同会话补充说明接续原任务；显式指令 / 越界要求回主链路',
        'src/pass-through.ts', 'explicit', '直通只少建一张单，不多给一份权'),
      field('准入强度', '显式准入 / 推断准入（待确认）/ 未准入', 'src/admission.ts', 'explicit',
        '推断准入只回一条配对指引，不建单、不续派'),
    ],
    notes: ['分层是配置不是骨架：没配主管的业务域自动退回扁平，并在决策里写明降级原因'],
  };

  const routines = scheduler.routines ?? [];
  const routineRows = routines.map(routine => {
    const policy = routineParallel(routine);
    const trigger = routine.when
      ? `事件驱动：${routine.when.source} / ${routine.when.types.join(',')}`
      : routine.schedule?.kind === 'interval' ? `每 ${routine.schedule.minutes} 分钟`
        : routine.schedule?.kind === 'daily' ? `每天 ${routine.schedule.at}`
          : routine.schedule?.kind === 'cron' ? `cron ${routine.schedule.expr}` : '未配置触发';
    const parallel = policy.limit === undefined ? '不限并发' : `并发上限 ${policy.limit}（${policy.source === 'density' ? '密度缺省' : '显式'}）`;
    return {
      id: routine.id,
      title: routine.title,
      detail: `${trigger} · 承接 ${routine.agent ?? config.defaultAgent} · 分组 ${routineGroup(routine)} · ${parallel}` +
        (routine.mergeMinutes ? ` · 合并窗口 ${routine.mergeMinutes} 分钟` : ''),
      status: routine.enabled === false ? '已停用' : '启用',
    };
  });
  const routineSection: RuleSection = {
    id: 'routines', title: '例程：什么时候跑什么', question: '到点跑 / 有人动了才跑，分别是谁在跑',
    fields: [
      field('调度总开关', onOff(scheduler.enabled), 'config.scheduler.enabled', 'explicit'),
      field('定时唤醒复查', onOff(scheduler.wake?.enabled ?? true), 'config.scheduler.wake.enabled',
        scheduler.wake?.enabled === undefined ? 'default' : 'explicit'),
      field('例程数量', String(routines.length), 'config.scheduler.routines', routines.length ? 'explicit' : 'default'),
      field('晚启动补跑', '开启（窗口内补跑，并在台账写明补跑原因）', 'src/scheduler.ts 常量', 'explicit'),
      field('跳过留痕', '开启（每次跳过都写 skipped 原因，不静默）', 'src/scheduler.ts', 'explicit'),
    ],
    rows: routineRows,
    notes: routines.length ? [] : ['没有配置例程：这一节没有规则，不是「跑过了但没记录」'],
  };

  const sources = Object.entries(inbox.sources ?? {});
  const eventSection: RuleSection = {
    id: 'events', title: '事件：谁能投进来', question: '外部系统能不能直接把事塞进队列',
    fields: [
      field('入站总开关', onOff(inbox.enabled), 'config.eventInbox.enabled', 'explicit',
        '开关开着但没登记来源 = 仍然没有入口'),
      field('已登记来源', sources.length ? sources.map(([name]) => name).join('、') : '无',
        'config.eventInbox.sources', sources.length ? 'explicit' : 'default'),
      field('入站鉴权', '每来源一把独立密钥（只写环境变量名，值不进仓库）', 'src/event-inbox.ts', 'explicit'),
      field('幂等', '事件指纹 + 来源键，重复投递只算一次', 'src/event-inbox.ts', 'explicit'),
      field('指令与数据分离', '外部正文只作为事实进 goal，不当指令执行', 'src/event-inbox.ts', 'explicit'),
    ],
    rows: sources.map(([name, source]) => ({
      id: name, title: name,
      detail: `密钥环境变量 ${source.secretEnv} · 归一化 ${source.kind} · 允许类型 ${source.allow.length ? source.allow.join(',') : '不限'}`,
      status: '启用',
    })),
    notes: sources.length ? [] : ['没有登记来源：任何 POST 都会回 source-not-configured'],
  };

  const agents = registry.agents ?? [];
  const agentSection: RuleSection = {
    id: 'agents', title: 'Agent：谁在哪个域在岗', question: '编制里的座位与范围，配了谁、谁真的在岗',
    fields: [
      field('注册表 Agent 数', String(agents.length), 'config.agentRegistry.agents',
        agents.length ? 'explicit' : 'default'),
      field('在岗数', String(agents.filter(agent => agent.enabled).length), 'config.agentRegistry.agents[].enabled', 'explicit'),
      field('执行引擎', Object.keys(config.agents).length ? Object.keys(config.agents).join('、') : '未配置',
        'config.agents', Object.keys(config.agents).length ? 'explicit' : 'default'),
      field('默认承接', config.defaultAgent, 'config.defaultAgent', 'explicit'),
    ],
    rows: agents.map(agent => ({
      id: agent.key, title: agent.label,
      detail: `职责 ${agent.responsibilities.join('/')} · 生效范围 ${agent.domains.join('/')}`,
      status: agent.enabled ? '在岗' : '已停用',
    })),
    notes: agents.length ? [] : ['注册表为空：分层派活会如实退回扁平，不硬造中间层'],
  };

  const channelRows = [
    { id: 'feishu', name: '飞书', enabled: config.feishu.enabled,
      senders: config.feishu.allowedSenders.length, chats: config.feishu.allowedChats.length },
    { id: 'dingtalk', name: '钉钉', enabled: Boolean(config.dingtalk?.enabled),
      senders: config.dingtalk?.allowedSenders?.length ?? 0, chats: -1 },
    { id: 'wecom', name: '企业微信', enabled: Boolean(config.wecom?.enabled),
      senders: config.wecom?.allowedSenders?.length ?? 0, chats: -1 },
  ];
  const channelSection: RuleSection = {
    id: 'channels', title: '通道：谁能说话', question: '消息从哪进来，谁能触发',
    fields: [
      field('入站鉴权口径', '发送人白名单 + 会话白名单（钉钉 / 企微只认发送人）', 'src/collaboration-intake.ts', 'explicit'),
      field('准入三档', '显式 / 推断 / 未准入', 'src/admission.ts', 'explicit'),
      field('出站统一护栏', '所有下行先过 outbox 预算；人类必达消息始终放行', 'src/im-outbound.ts', 'explicit'),
    ],
    rows: channelRows.map(channel => ({
      id: channel.id, title: channel.name,
      detail: channel.chats === -1 ? `发送人白名单 ${channel.senders} 人 · 会话不限`
        : `发送人白名单 ${channel.senders} 人 · 会话白名单 ${channel.chats} 个`,
      status: channel.enabled ? '启用' : '关闭',
    })),
    notes: ['白名单为空 = 拒绝所有入站；这不是「没配就都能进」'],
  };

  const acceptanceSection: RuleSection = {
    id: 'acceptance', title: '验收：谁说了算', question: '清单什么时候锁、谁能签',
    fields: [
      field('验收模式', acceptance?.mode === 'independent' ? '独立逐项评审' : '沿用原发起人核可（legacy）',
        'config.acceptance.mode', acceptance?.mode ? 'explicit' : 'default'),
      field('核验等级', acceptance?.level ?? 'L3', 'config.acceptance.level', acceptance?.level ? 'explicit' : 'default'),
      field('独立评审者', acceptance?.reviewerModel ?? '未配置', 'config.acceptance.reviewerModel',
        acceptance?.reviewerModel ? 'explicit' : 'default'),
      field('开工即锁定清单', onOff(acceptance?.sealPlanOnCreate ?? false), 'config.acceptance.sealPlanOnCreate',
        acceptance?.sealPlanOnCreate === undefined ? 'default' : 'explicit'),
      field('人签落点', '只落在原发起人的原会话，任何配置都不可放宽', 'src/controller.ts', 'explicit'),
      field('报告内讨论', '可挂检查项 / 区域 / 整份报告；只供人看，不参与判定', 'src/acceptance-discussion.ts', 'explicit'),
    ],
    notes: ['评审者不得等于产出方；未通过的检查项不会被算作通过'],
  };

  const deliverySection: RuleSection = {
    id: 'delivery', title: '交付：代码怎么上线', question: '合并与发布是谁批准的',
    fields: [
      field('交付形态', delivery.provider === 'local' ? '本机 Git 交付台（不依赖 github.com）' : 'GitHub 适配器',
        'config.delivery.provider', 'explicit'),
      field('自动合并', onOff(delivery.autoMerge), 'config.delivery.autoMerge', 'explicit', '仅在 CI 通过 + 审批齐全后'),
      field('自动发布预览', onOff(delivery.autoPublish), 'config.delivery.autoPublish', 'explicit'),
      field('独立审码闸门', onOff(config.codeReview.enforce), 'config.codeReview.enforce', 'explicit',
        'block 级问题（密钥 / 环境文件）拦住预览部署'),
      field('执行形态', config.execution.mode === 'step' ? '单步执行（状态外置 PG 队列）' : '常驻循环（loop）',
        'config.execution.mode', 'explicit'),
      field('宿主平台', config.host.provider, 'config.host.provider', 'explicit'),
    ],
    notes: ['业务验收仍由原发起人在原会话确认；自动合并 / 自动发布不等于验收'],
  };

  const sections = [dispatch, routineSection, eventSection, agentSection, channelSection, acceptanceSection, deliverySection];
  const defaulted = sections.flatMap(section => section.fields
    .filter(item => item.origin === 'default')
    .map(item => `${section.title} · ${item.label}（${item.source}）`));

  return {
    schemaVersion: 1,
    generatedFrom: 'config.json（只读）',
    modelCalls: 0,
    sections,
    defaulted,
    notes: [
      '本视图只读：改行为请改原配置，这里不提供第二个写入口',
      '并发配额、分层降级等判据直接复用运行时函数，不另写一套解释',
      '标注「取默认值」的行是接手时最容易误判的地方——它没写，就等于按默认跑',
    ],
  };
}

/** 纯文本渲染（CLI 与日志用）：每行都带来源，便于「这行为什么是这样」。 */
export function renderRulesViewText(view: RulesView): string {
  const lines: string[] = [];
  lines.push(`规则视图（${view.generatedFrom}）`);
  lines.push('');
  for (const section of view.sections) {
    lines.push(`【${section.title}】${section.question}`);
    for (const item of section.fields) {
      lines.push(`  ${item.origin === 'default' ? '·' : '✓'} ${item.label}：${item.value}  〔${item.source}${item.origin === 'default' ? ' · 默认值' : ''}〕`);
      if (item.note) lines.push(`      ${item.note}`);
    }
    for (const row of section.rows ?? []) lines.push(`  - [${row.status}] ${row.title}：${row.detail}`);
    for (const note of section.notes) lines.push(`  ! ${note}`);
    lines.push('');
  }
  if (view.defaulted.length) {
    lines.push('取默认值的配置：');
    for (const item of view.defaulted) lines.push(`  · ${item}`);
    lines.push('');
  }
  for (const note of view.notes) lines.push(`# ${note}`);
  return lines.join('\n');
}
