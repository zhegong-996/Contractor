// 本机代码交付链路：默认 provider、可注入适配器、只读白名单、只绑 loopback。
// 真实 push / pull / CI / 审批由 npm run delivery:demo 与交付台页面验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { allowedFile } from '../src/github.ts';
import { orgAuthCommand, missingOrgScopes, ORG_SCOPE_ADDITIONS } from '../src/feishu-org.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

test('国内环境默认走本机 Git 交付，GitHub 适配器仍可显式回退', () => {
  const config = read('src/config.ts');
  assert.match(config, /provider: z\.enum\(\['local', 'github'\]\)\.default\('local'\)/);
  assert.match(config, /feishuNotify: z\.boolean\(\)\.default\(false\)/);
  const server = read('src/server.ts');
  assert.match(server, /config\.delivery\.provider === 'local' \? new LocalGitDelivery\(config\) : new Github\(config\)/);
  assert.match(server, /new Controller\(config, store, deliveryAdapter\)/);
  // 控制器只依赖四个动作，适配器可替换而不改业务验收逻辑。
  assert.match(read('src/github.ts'), /export interface DeliveryAdapter/);
  assert.match(read('src/github.ts'), /export class Github implements DeliveryAdapter/);
  assert.match(read('src/local-git.ts'), /export class LocalGitDelivery implements DeliveryAdapter/);
  assert.match(read('src/controller.ts'), /readonly github: DeliveryAdapter/);
});

test('delivery-status 是只读接口，三处白名单一致', () => {
  const server = read('src/server.ts');
  assert.match(server, /if\(action==='delivery-status'\)return deliveryStatus\(\)/);
  assert.match(server, /'development-view','delivery-status'/);
  assert.match(server, /request as httpRequest/);
  assert.match(read('src/members.ts'), /'development-view', 'delivery-status'/);
  assert.match(server, /hostname: '127\.0\.0\.1'/);
});

test('本机交付台只绑 loopback，审批不等于业务验收', () => {
  const service = read('scripts/delivery-server.ts');
  assert.match(service, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.match(service, /--listen=127\.0\.0\.1/);
  assert.match(service, /--enable=receive-pack/);
  assert.match(service, /不等于业务验收/);
  assert.match(service, /未接通的服务不提供入口/);
  assert.match(read('src/local-git.ts'), /不代替人签字|业务验收仍由原发起人在原会话/);
  for (const script of ['delivery:serve', 'delivery:demo']) assert.ok(pkg.scripts[script], `缺少 ${script}`);
});

test('本机 CI 与路径红线沿用原有约束', () => {
  const local = read('src/local-git.ts');
  assert.match(local, /allowedFile\(file, this\.config\.allowedPaths\)/);
  assert.match(local, /改动超出任务或项目允许的路径范围/);
  assert.match(local, /工作区分支已变化，拒绝交付/);
  assert.match(local, /必须先通过本机 CI 并取得合并审批/);
  assert.match(local, /本机预览版本/);
  assert.equal(allowedFile('collab-pilot/index.html', ['collab-pilot/']), true);
  assert.equal(allowedFile('../secret', ['collab-pilot/']), false);
});

test('组织 owner 决策与 scope 授权链路已落地到脚本', () => {
  assert.ok(pkg.scripts['org:auth']);
  assert.ok(pkg.scripts['org:table']);
  assert.match(read('scripts/org-auth.ts'), /orgAuthCommand\(scopes\)/);
  assert.match(read('scripts/org-table.ts'), /org-owner-decisions\.json/);
  assert.match(read('src/feishu-org.ts'), /readOwnerDecisions/);
  assert.match(read('src/feishu-org.ts'), /excludedByOwner/);
  const granted = 'contact:user.base:readonly im:message';
  assert.deepEqual(missingOrgScopes(granted), [...ORG_SCOPE_ADDITIONS]);
  assert.match(orgAuthCommand(granted), /im:message/);
  assert.match(orgAuthCommand(granted), /contact:department\.organize:readonly/);
});

test('合并与发布已自动化，但业务验收红线不动', () => {
  const cfg = read('src/config.ts');
  assert.match(cfg, /autoMerge: z\.boolean\(\)\.default\(true\)/);
  assert.match(cfg, /autoPublish: z\.boolean\(\)\.default\(true\)/);
  const git = read('src/local-git.ts');
  assert.match(git, /private async mergeNow/);
  assert.match(git, /merge-base', '--is-ancestor/);
  assert.match(git, /update-ref', 'refs\/heads\/main'/);
  assert.match(git, /private async publishNow/);
  assert.match(git, /config\.delivery\.autoMerge && record\.ci === 'passed'/);
  assert.match(git, /自动合并未完成/);
  // 自动合并失败必须留可见记录，不能静默吞掉；验收仍明确由人完成。
  assert.match(git, /业务验收仍需原发起人在原会话确认/);
  assert.match(git, /业务验收仍走 Controller\.accept \/ confirmAcceptance/);
  const page = read('scripts/delivery-server.ts');
  assert.match(page, /已自动发布/);
  assert.doesNotMatch(page, /预览只固定到确切提交，不自动合并、不自动发布/);
  assert.match(page, /业务验收仍须由原发起人在原会话/);
});
