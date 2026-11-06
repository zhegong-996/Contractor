// 本机代码交付链路端到端冒烟：创建裸仓库 → 工作区提交 → push → 本机 CI → 审批 → 预览。
// 只写 .runtime，不动业务任务表、不推送到任何外部服务。
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadConfig, runtime } from '../src/config.ts';
import { LocalGitDelivery } from '../src/local-git.ts';
import { command } from '../src/commands.ts';
import type { Task } from '../src/store.ts';

const config = loadConfig();
const service = new LocalGitDelivery(config);
const marker = `demo-${randomUUID().slice(0, 8)}`;
const prepared = await service.prepare(marker);
const cloneDir = path.join(tmpdir(), `suitme-git-${marker}`);
let gitProtocolOk = false;

try {
  // 1) 在工作区里做一次真实提交（路径必须在项目 allowedPaths 内）。
  const relative = `${config.allowedPaths.find(p => p.endsWith('/')) ?? 'collab-pilot/'}delivery-${marker}.md`;
  const file = path.join(prepared.workspace, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# 本机交付冒烟 ${marker}\n\n由 npm run delivery:demo 生成，用于验证 push / pull / 审批链路。\n`);
  const task = { id: marker, identifier: `DEMO-${marker}`, workspace: prepared.workspace, branch: prepared.branch,
    phase: 'in_progress', context: JSON.stringify({ allowedPaths: config.allowedPaths }) } as unknown as Task;

  // 2) 交付：commit + push 到本机裸仓库 + 生成本机交付请求。
  const delivery = await service.publish(task);
  const record = service.read(delivery.pr)!;
  task.delivery = delivery;

  // 3) 本机 CI 校验（提交存在 / 路径合规 / 与 main 无冲突）。
  const inspected = await service.inspect(delivery.pr);
  task.delivery = inspected;

  // 4) 通过 git:// 协议真实 clone + pull（验证「能拉代码」）。
  try {
    await command('git', ['clone', '--quiet', service.cloneUrl, cloneDir]);
    await command('git', ['-C', cloneDir, 'fetch', 'origin', prepared.branch]);
    gitProtocolOk = true;
  } catch (error) {
    console.log('git daemon 未启动，跳过 git:// 拉取验证：', String((error as Error).message).slice(0, 120));
  }

  // 5) 合并审批 + 本机预览版本固定。
  const approved = await service.decide(inspected.pr, 'approved', 'organization-owner', '冒烟验证：同意合并');
  const preview = await service.preview({ ...task, delivery: inspected } as Task);

  console.log(JSON.stringify({
    ok: true, repo: service.repoName, cloneUrl: service.cloneUrl,
    mainSha: (await service.repoInfo()).mainSha.slice(0, 12),
    branch: prepared.branch, headSha: inspected.headSha.slice(0, 12),
    pushedFiles: record.changedFiles,
    ci: inspected.ci, ciNote: service.read(inspected.pr)?.ciNote,
    approvalStatus: approved.status, notifications: approved.notifications.length,
    gitProtocolClonePull: gitProtocolOk,
    previewUrl: preview.previewUrl, deployedSha: preview.deployedSha?.slice(0, 12),
    deliveryUrl: service.deliveryUrl(inspected.pr),
    note: '这是本机演示交付，不等于业务验收；业务验收仍由原发起人在原会话确认。',
  }, null, 2));
} finally {
  // 清理演示工作区与临时 clone，不污染主仓库的 worktree 列表。
  try { await command('git', ['-C', config.checkout, 'worktree', 'remove', '--force', prepared.workspace]); } catch { /* best effort */ }
  if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true });
  const demoFile = path.join(runtime('git'), 'demo-workspace-placeholder');
  if (existsSync(demoFile)) rmSync(demoFile, { recursive: true, force: true });
}
