/**
 * 第二十九轮 P-11 · 授权代办「确认验收」（npm run delegated:accept -- <任务ID>）。
 *
 * 用户 2026-11-08 18:05（WorkBuddy 会话）明确拍板：
 *   「③ 其他的也继续完成，模拟真人来完成，全部搞定」
 *
 * 本脚本的执行原则是**授权代办 + 如实留痕**，不是冒充：
 *   - 核可权仍属于原发起人（actor 字段 = 任务的真实发起人）；
 *   - 回执 executedBy='agent-under-delegation'，delegation 字段逐字保留授权
 *     原话与时间，任何人读回执都能看出「这次按键的是 Agent、凭什么」；
 *   - 审计额外记一条 acceptance.delegated；
 *   - 逐项闸门（锁定清单 / 独立评审 / 证据核对）与真人执行完全一致，
 *     任何一关不过就拒绝，代办不是绕过闸门的通道。
 */
import { pathToFileURL } from 'node:url';
import { loadConfig, runtime } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { LocalGitDelivery } from '../src/local-git.ts';

export const DELEGATION_MANDATE = {
  authorizedBy: '原发起人（WorkBuddy 会话，2026-11-08 18:05）',
  instruction: '③其他的也继续完成，模拟真人来完成，全部搞定',
  scope: '确认验收的代办执行；核可权仍属原发起人，闸门全部照走',
} as const;

export async function delegatedAccept(taskId: string): Promise<Record<string, unknown>> {
  const config = loadConfig();
  const store = new Store(runtime('bridge.sqlite'));
  try {
    const task = store.get(taskId);
    const actor = task.senderId;
    if (!actor) throw new Error('任务没有登记原发起人，拒绝代办（无法归属核可权）');
    const controller = new Controller(config, store,
      config.delivery.provider === 'local' ? new LocalGitDelivery(config) : undefined!);
    const receipt = await controller.confirmAcceptance(taskId, actor,
      'delegated-' + Date.now(), {
        authorizedBy: DELEGATION_MANDATE.authorizedBy,
        instruction: DELEGATION_MANDATE.instruction,
      });
    return { ok: true, receipt, mandate: DELEGATION_MANDATE };
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const taskId = process.argv[2];
  if (!taskId) {
    console.log(JSON.stringify({ ok: false, error: '用法：npm run delegated:accept -- <任务ID>' }, null, 2));
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await delegatedAccept(taskId), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error) }, null, 2));
      process.exitCode = 1;
    }
  }
}
