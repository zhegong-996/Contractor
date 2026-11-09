// P0 主安装切多用户：备份 → 切 authenticated → 建龚哲账号 → 建 board-token → 重启 bridge。
//
//   npm run p0:migrate -- --dry-run   只打印计划，不执行（默认）
//   npm run p0:migrate -- --run       真执行
//
// 数据不丢：只改启动模式（deployment-mode.json）+ 新增账号/密钥，PG 数据不动。
// 飞书绑定（/member-pair）在脚本之外，需要龚哲在飞书单聊发一条消息。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { root, runtime, loadConfig } from '../src/config.ts';

const run = process.argv.includes('--run');
const base = 'http://127.0.0.1:3100';
const say = (step: string) => console.log(`[${run ? '执行' : '预览'}] ${step}`);

async function request(route: string, method = 'GET', body?: unknown, cookie?: string): Promise<{ status: number; value: any; cookie?: string }> {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value: any; try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  return { status: response.status, value, cookie: response.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') || cookie };
}

// 1. 现状
const health = await (await fetch(base + '/api/health')).json() as any;
say(`当前 deploymentMode=${health.deploymentMode} bootstrapStatus=${health.bootstrapStatus}`);
if (health.deploymentMode === 'authenticated') { console.log('已经是 authenticated，无需迁移'); process.exit(0); }

// 2. 备份
const dbDir = runtime('paperclip', 'instances', 'default', 'db');
const backupDir = runtime('backup', `paperclip-db-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (!existsSync(dbDir)) { console.log('未找到 db 目录，跳过备份（可能用别的存储）'); }
else {
  say(`备份 ${dbDir} → ${backupDir}`);
  if (run) { cpSync(dbDir, backupDir, { recursive: true }); console.log('备份完成', backupDir); }
}

// 3. 生成龚哲账号凭据
const secretsFile = runtime('secrets.json');
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
const email = '18744396807@feishu.local';
const password = randomBytes(18).toString('base64url');

if (!run) { say(`将用 ${email} 建龚哲账号（随机密码，存 secrets.json 的 adminPassword）`); }
else {
  // 4. 切模式 + 重启
  writeFileSync(runtime('deployment-mode.json'), JSON.stringify({ deploymentMode: 'authenticated' }, null, 2), { mode: 0o600 });
  say('已写 deployment-mode.json = authenticated');
  spawnSync(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'scripts/up.ts'), 'stop'], { cwd: root, stdio: 'inherit' });
  spawnSync(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'scripts/up.ts'), 'up'], { cwd: root, stdio: 'inherit' });
  const newHealth = await (await fetch(base + '/api/health')).json() as any;
  say(`重启后 deploymentMode=${newHealth.deploymentMode} bootstrapStatus=${newHealth.bootstrapStatus}`);
  if (newHealth.deploymentMode !== 'authenticated') throw new Error('切换失败，请检查 .runtime/logs/paperclip.log');

  // 5. 建龚哲账号
  let cookie = '';
  const signup = await request('/api/auth/sign-up/email', 'POST', { email, password, name: '龚哲' });
  if (signup.status !== 200 && signup.status !== 201) throw new Error(`建账号失败: ${signup.status} ${JSON.stringify(signup.value).slice(0, 200)}`);
  cookie = signup.cookie ?? '';
  const userId = signup.value?.user?.id ?? signup.value?.id;
  say(`龚哲账号已建 userId=${userId}`);

  // 6. claim bootstrap（若需要）
  const afterSignup = await (await fetch(base + '/api/health')).json() as any;
  if (afterSignup.bootstrapStatus === 'bootstrap_pending' || afterSignup.bootstrapInviteActive) {
    const claim = await request('/api/bootstrap/claim', 'POST', {}, cookie);
    say(`claim bootstrap: ${claim.status}`);
  } else say(`bootstrap 已是 ${afterSignup.bootstrapStatus}，跳过 claim`);

  // 7. 建 board-api-key 并写回 secrets
  const key = await request('/api/board-api-keys', 'POST', { name: 'suitme-collab-board' }, cookie);
  const boardToken = key.value?.token;
  if (!boardToken) throw new Error(`board-api-key 失败: ${JSON.stringify(key.value).slice(0, 200)}`);
  secrets.boardToken = boardToken;
  secrets.authSecret = secrets.authSecret || randomBytes(48).toString('hex');
  secrets.adminPassword = password;
  writeFileSync(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  say('boardToken / authSecret / adminPassword 已写回 secrets.json');

  // 8. 设龚哲为 owner（company membership）
  const config = loadConfig();
  const roster = await request(`/api/companies/${config.companyId}/members`, 'GET', undefined, cookie);
  const member = (roster.value?.members ?? []).find((m: any) => m.user?.id === userId || m.principalId === userId);
  if (member) {
    const patch = await request(`/api/companies/${config.companyId}/members/${member.id}/role-and-grants`, 'PATCH', { membershipRole: 'owner', status: 'active', grants: [] }, cookie);
    say(`owner 已设: ${patch.status}`);
  } else say('未找到龚哲的 company membership，稍后手工设 owner');

  // 9. 重启 bridge 让 board-token 生效
  spawnSync(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'scripts/up.ts'), 'restart-bridge'], { cwd: root, stdio: 'inherit' });
  say('bridge 已重启，board-token 生效');

  console.log('\n迁移完成。飞书绑定（最后一步）：');
  console.log('  1. 控制台/命令生成 member-pair 配对码');
  console.log('  2. 龚哲在飞书单聊机器人发 /member-pair <码>');
  console.log('  3. 之后飞书即主入口，无需邮箱密码');
}
