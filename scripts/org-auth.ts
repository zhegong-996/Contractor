// 生成「补齐飞书通讯录/部门 scope」的登录命令。
//
//   npm run org:auth              只打印命令（默认，不改动任何登录状态）
//   npm run org:auth -- --execute 发起登录；仍需本人在飞书确认，脚本不代替授权
//
// 关键：飞书重新登录会把已授予的 scope 整体替换成这次传入的值，
// 所以命令必须携带当前全部 scope + 缺失的两个，否则会清空现有 100+ 权限。
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { normaliseScopes, missingOrgScopes, orgAuthCommand, ORG_SCOPE_ADDITIONS } from '../src/feishu-org.ts';

const execute = promisify(execFile);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' };
let scopes = '';
try {
  const { stdout } = await execute('lark-cli', ['auth', 'status', '--json', '--verify'],
    { timeout: 25000, maxBuffer: 4 * 1024 * 1024, env });
  const status = JSON.parse(stdout);
  scopes = String(status?.identities?.user?.scope ?? status?.scope ?? '');
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String((error as Error).message ?? error),
    hint: '无法读取当前授权范围；请先在飞书完成用户身份登录，不要盲目重登以免丢失 scope' }, null, 2));
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const granted = normaliseScopes(scopes);
  const missing = missingOrgScopes(scopes);
  const command = orgAuthCommand(scopes);
  console.log(JSON.stringify({
    ok: true, grantedScopes: granted.length, missingScopes: missing,
    additions: ORG_SCOPE_ADDITIONS, command,
    note: '命令携带现有全部 scope + 缺失 scope；登录必须由本人在飞书确认，脚本不代替授权。',
    next: '本人在飞书确认后，重新运行 npm run org:preview 读取部门字段。',
  }, null, 2));
  if (process.argv.includes('--execute') && missing.length) {
    const login = spawnSync('lark-cli', ['auth', 'login', '--scope', [...granted, ...missing].join(' '), '--no-wait', '--json'],
      { stdio: 'inherit', env: { ...env, ...process.env } });
    if (login.status !== 0) process.exitCode = login.status ?? 1;
  }
}
