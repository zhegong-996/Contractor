/**
 * 准入强度（第四十一轮 · 对齐 DeepSeek Super-agent 的 admission strength）。
 *
 * 之前的行为只有两档：白名单放行 / 直接抛 Unauthorized。中间那一档缺了——
 * 「通道说这人可能是我们的人，但还没有实名落点」的消息，既不处理，也不解释，
 * 发消息的人在和机器人单聊里发完就没了下文。
 *
 * 三档的定义（判定只看证据，不看猜测）：
 *   - explicit（显式准入）：有实名落点。要么已经配对出在职成员身份；要么是
 *     单负责人安装里通道白名单唯一登记的那个人（配置里写死的具体人）。
 *     处理方式：process——按成员身份走完整链路（建单 / 续跑 / 知识 / 验收
 *     仍各自过自己的闸）。
 *   - inferred（推断准入）：通道认，但实名身份不成立。两种来源：① 配对过但
 *     成员身份当前失效（离职 / 权限被撤）；② 白名单里登记了多人、此人命中
 *     但没配对——通道级允许，成员级未登记。处理方式：acknowledge——只回一条
 *     说明 + 留一条待确认记录，不建单、不续跑、不读知识、不写任何业务状态。
 *   - not-admitted（未准入）：通道也不认。处理方式：reject——拒绝且只留审计，
 *     不回话（不向未准入方描述系统内部细节）。
 *
 * 结构化保证（和直通同一套思路）：`memberContext` 只有在 explicit 且配对成立时
 * 才为 true；inferred 的返回值里 `memberContext` 恒为 false，且不存在任何可
 * 传递给下游的权限字段。想放宽只能改这一个文件，改完单测先红。
 */

export const ADMISSION_STRENGTHS = ['explicit', 'inferred', 'not-admitted'] as const;
export type AdmissionStrength = (typeof ADMISSION_STRENGTHS)[number];
export type AdmissionHandling = 'process' | 'acknowledge' | 'reject';

export type AdmissionInput = {
  /** 通道名（feishu / dingtalk / wecom / events），只用于原因文案与审计。 */
  channel: string;
  senderId: string;
  chatId: string;
  /** imMembers 命中且会话一致（配对记录存在）。 */
  paired?: boolean;
  /** 配对记录能解析出在职成员身份；paired=true 但这里 false 表示身份已失效。 */
  pairingValid?: boolean;
  /** 通道白名单（发送人 + 会话）命中。 */
  allowlisted?: boolean;
  /** 该通道显式登记的人数；1 表示单负责人安装。 */
  allowlistSize?: number;
};

export type AdmissionDecision = {
  strength: AdmissionStrength;
  handling: AdmissionHandling;
  /** 是否可以带着成员身份继续（个人 Agent、知识分区、验收身份都依赖它）。 */
  memberContext: boolean;
  reason: string;
  evidence: string[];
  modelCalls: 0;
};

const decide = (strength: AdmissionStrength, handling: AdmissionHandling,
  memberContext: boolean, reason: string, evidence: string[]): AdmissionDecision =>
  ({ strength, handling, memberContext, reason, evidence, modelCalls: 0 });

export function assessAdmission(input: AdmissionInput): AdmissionDecision {
  const channel = input.channel || 'unknown';
  const paired = input.paired === true;
  const pairingValid = input.pairingValid === true;
  const allowlisted = input.allowlisted === true;
  const allowlistSize = Number.isFinite(input.allowlistSize) ? Number(input.allowlistSize) : 0;
  const evidence = [
    `${channel}: sender 命中=${allowlisted}`,
    `${channel}: 白名单人数=${allowlistSize}`,
    `配对记录=${paired ? '有' : '无'}`,
    `配对身份可解析=${pairingValid ? '是' : '否'}`,
  ];

  if (paired && pairingValid)
    return decide('explicit', 'process', true,
      '已配对出在职成员身份，按成员处理（建单 / 续跑 / 知识 / 验收仍各自过各自的闸）', evidence);

  // 单负责人安装：白名单里只登记了一个具体人，配置本身就是显式准入证据。
  // 这一档没有成员身份（memberContext=false），只是可以正常发起与续跑。
  if (!paired && allowlisted && allowlistSize === 1)
    return decide('explicit', 'process', false,
      '单负责人安装：通道白名单只登记了这一位发起人，按显式准入处理（无成员身份，不授予个人区与验收身份）', evidence);

  if (paired && !pairingValid)
    return decide('inferred', 'acknowledge', false,
      '配对记录还在，但成员身份已失效（离职或权限被撤）；只回说明并要求重新配对，不处理业务', evidence);

  if (allowlisted && allowlistSize > 1)
    return decide('inferred', 'acknowledge', false,
      '通道白名单允许，但没有实名配对，无法确认是哪位成员；只回说明并留待确认，不处理业务', evidence);

  return decide('not-admitted', 'reject', false,
    '发送人既不在通道白名单，也没有配对记录；拒绝且不回话', evidence);
}

/** 给控制台 / 文档用的一句人话，避免各处重写映射表。 */
export function admissionLabel(strength: AdmissionStrength): string {
  return strength === 'explicit' ? '显式准入' : strength === 'inferred' ? '推断准入（待确认）' : '未准入';
}

/** 推断准入时发给对方的固定说明：告诉怎么变成显式，不说系统细节。 */
export function inferredAcknowledgement(channel: string): string {
  return `已收到，但还不能替你处理：你的${channel === 'feishu' ? '飞书' : channel}身份还没有和成员账号配对。` +
    '请到工作台「我的配置 → 成员配对」生成配对码，然后在机器人单聊里发送 /member-pair <配对码>。' +
    '配对完成后再发一次即可；在此之前不会创建任务、不会改动任何已有任务。';
}
