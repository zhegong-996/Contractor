/**
 * 面向用户的语言层（v0.6 产品化）。
 *
 * 以前用户要输入 `/accept` 才能验收，没人能猜到 accept 是什么意思。
 * 现在协议标识符（accept / reject / status ...）只存在于内部 API 与代码，
 * 用户在 IM 会话、工作台和验收报告里看到的一律是中文说法。
 *
 * 旧英文斜杠命令仍然可解析（保护已验证的链路与脚本），但不再出现在
 * 帮助文案、回复、报告或界面上。
 */

export type UserAction = 'task' | 'status' | 'reply' | 'accept' | 'reject' | 'handoff';

/** 最终人工核可的统一说法：报告、界面、通知都用这一句。 */
export const CONFIRM_ACCEPT = '确认验收';

export const USER_HELP = [
  '发起协作：任务 要办的事（也可写「发起任务」「派单」；闲聊不会自动建单）',
  '查看进度：查看进度 任务编号',
  '补充要求：补充说明 任务编号 内容',
  '按清单确认验收：确认验收 任务编号（只由原发起人在原会话操作）',
  '代码交付类任务：确认验收 任务编号 交付提交号（系统要核对 CI 与部署版本）',
  '验收不通过：验收不通过 任务编号 原因',
  '换人接手：转交 任务编号 负责人',
].join('\n');

/** 中文指令 → 内部动作。长词在前，避免「补充」抢走「补充说明」。 */
const ALIASES: Record<UserAction, string[]> = {
  task: ['发起任务', '新建任务', '派单', '任务'],
  status: ['查看进度', '查进度', '任务进度', '进度'],
  reply: ['补充说明', '追加说明', '继续说明', '补充'],
  accept: ['确认验收', '验收通过', '通过验收', '确认通过', '同意验收'],
  reject: ['验收不通过', '退回修改', '打回', '不通过'],
  handoff: ['转交', '移交', '换人'],
};

/** 旧英文命令只作内部兼容，不对外展示。 */
const LEGACY: Record<string, UserAction> = {
  task: 'task', status: 'status', reply: 'reply',
  accept: 'accept', reject: 'reject', handoff: 'handoff',
};

export interface ParsedUserCommand {
  action: UserAction;
  taskId?: string;
  detail: string;
  agent?: string;
  /** true 表示走的是旧英文斜杠语法，用于审计「用户是否还在用旧命令」。 */
  fromLegacySyntax: boolean;
}

/**
 * 解析会话里的一句话。返回 null 表示不是指令（闲聊、通知、@ 等不建任务），
 * 保持原有的「只有明确指令才触发」行为，避免误建任务。
 */
export function parseUserCommand(raw: string): ParsedUserCommand | null {
  const text = String(raw ?? '').replace(/@[^\s]+\s*/g, '').trim();
  if (!text) return null;

  // 1) 建任务：/task [agent] 内容 或「任务 [agent] 内容」。
  // 「任务进度」是查看进度的别名，不能被「任务」抢走当成建单内容。
  const create = /^(?:\/task|发起任务|新建任务|派单|任务(?!进度))\s+(?:\[([a-z][a-z0-9-]*)\]\s*)?([\s\S]+)$/.exec(text);
  if (create) {
    return { action: 'task', ...(create[1] ? { agent: create[1] } : {}), detail: create[2]!.trim(),
      fromLegacySyntax: text.startsWith('/task') };
  }

  // 2) 旧英文斜杠命令：/accept SUI-1 sha ...（兼容，不展示）
  const legacy = /^\/(status|reply|accept|reject|handoff)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
  if (legacy) {
    return { action: LEGACY[legacy[1]!]!, taskId: legacy[2], detail: legacy[3] ?? '',
      fromLegacySyntax: true };
  }

  // 3) 中文指令：确认验收 SUI-129 [补充说明]。建任务已在第 1 步处理，
  // 这里跳过 task 别名，否则「任务进度」会被「任务」误解析成建单。
  for (const action of (Object.keys(ALIASES) as UserAction[]).filter(item => item !== 'task')) {
    const names = [...ALIASES[action]].sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (!text.startsWith(name)) continue;
      const rest = text.slice(name.length).trim();
      const found = /^(\S+)(?:\s+([\s\S]+))?$/.exec(rest);
      if (!found) return null;
      return { action, taskId: found[1], detail: found[2] ?? '', fromLegacySyntax: false };
    }
  }
  return null;
}

/** 给通知、报告、界面复用的中文动作名。 */
export function userActionLabel(action: UserAction): string {
  return ({ task: '发起协作', status: '查看进度', reply: '补充说明',
    accept: CONFIRM_ACCEPT, reject: '验收不通过', handoff: '转交' } as Record<UserAction, string>)[action];
}
