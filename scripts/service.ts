/**
 * 第三十七轮 · 常驻服务（macOS LaunchAgent）。
 *
 * 复盘发现：定时调度器与 GitHub 监听都挂在 bridge 的 tick 循环上，而 bridge
 * 此前只能靠 `npm run up` 从终端拉起；终端一关（或本机重启）就没了，调度器
 * 自然也不会到点触发 —— 「定时」在代码层成立，在运行层不成立。
 *
 * 本脚本把两个进程注册成用户级 LaunchAgent（RunAtLoad + KeepAlive），登录即
 * 拉起、异常退出自动重启：
 *   - cn.suitme.collab.paperclip → scripts/paperclip.ts（3100，任务真源与工作台）
 *   - cn.suitme.collab.bridge    → src/server.ts（4180，调度器 / GitHub 监听 / 飞书入口）
 *
 * 只动用户目录下的 ~/Library/LaunchAgents 与本项目 .runtime/logs，
 * 卸载一条命令还原：npm run service -- uninstall
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';

const action = process.argv[2] ?? 'status';
const only = process.argv[3];
const uid = process.getuid?.() ?? 501;
const agentsDir = path.join(process.env.HOME ?? '', 'Library', 'LaunchAgents');

type Service = { name: string; label: string; script: string; port: number; url: string };

const services: Service[] = [
  { name: 'paperclip', label: 'cn.suitme.collab.paperclip', script: 'scripts/paperclip.ts', port: 3100, url: 'http://127.0.0.1:3100/api/health' },
  { name: 'bridge', label: 'cn.suitme.collab.bridge', script: 'src/server.ts', port: 4180, url: 'http://127.0.0.1:4180/health' },
];

const selected = () => (only ? services.filter(s => s.name === only) : services);

/**
 * 常驻进程用的 node：必须走系统安装的 Node ≥ 24（项目 engines 要求，且依赖
 * node:sqlite）。WorkBuddy 内置的 node 版本较旧，不能写进 plist。
 */
function nodeBinary(): string {
  for (const candidate of ['/usr/local/bin/node', '/opt/homebrew/bin/node']) {
    if (existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

function plist(service: Service): string {
  const log = runtime('logs', `${service.name}.launchd.log`);
  const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs');
  const nodePath = nodeBinary();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${service.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>--import</string>
    <string>${loader}</string>
    <string>${path.join(root, service.script)}</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>${process.env.HOME ?? ''}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): { ok: boolean; out: string } {
  try { return { ok: true, out: execFileSync('launchctl', args, { encoding: 'utf8' }) }; }
  catch (error) { return { ok: false, out: String((error as { stderr?: string }).stderr ?? error).trim() }; }
}

async function waitReady(service: Service, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetch(service.url).then(r => r.ok).catch(() => false)) return true;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return false;
}

async function install(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('当前只实现了 macOS LaunchAgent；Linux 请用 systemd（见 docs/product/system-architecture.md 的运行形态说明）');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(runtime('logs'), { recursive: true });
  for (const service of selected()) {
    const file = path.join(agentsDir, `${service.label}.plist`);
    writeFileSync(file, plist(service), { mode: 0o644 });
    launchctl(['bootout', `gui/${uid}/${service.label}`]);
    const boot = launchctl(['bootstrap', `gui/${uid}`, file]);
    if (!boot.ok) {
      if (/Input\/output error|5:/.test(boot.out)) {
        throw new Error(`${service.name} 注册失败：launchd 拒绝创建任务（${boot.out.split('\n')[0]}）。` +
          `当前会话可能被沙箱/远程会话限制，请在「本机普通终端」重跑：npm run service -- install ${service.name}` +
          `（plist 已写入 ${file}，可先 plutil -lint 校验）`);
      }
      throw new Error(`${service.name} 注册失败：${boot.out}`);
    }
    launchctl(['enable', `gui/${uid}/${service.label}`]);
    const ready = await waitReady(service);
    console.log(`${service.name}: ${ready ? `已常驻（${service.url}）` : '已注册，但健康检查未在 60s 内就绪，见 .runtime/logs/' + service.name + '.launchd.log'}`);
  }
}

async function uninstall(): Promise<void> {
  for (const service of selected()) {
    const file = path.join(agentsDir, `${service.label}.plist`);
    launchctl(['bootout', `gui/${uid}/${service.label}`]);
    if (existsSync(file)) rmSync(file);
    console.log(`${service.name}: 已取消常驻${existsSync(file) ? '（plist 未删除，请手动检查）' : ''}`);
  }
}

async function status(): Promise<void> {
  for (const service of services) {
    const online = await fetch(service.url).then(r => r.ok).catch(() => false);
    const listed = launchctl(['print', `gui/${uid}/${service.label}`]);
    const managed = listed.ok;
    const state = /state = (\w+)/.exec(listed.out)?.[1] ?? (managed ? 'registered' : 'not-registered');
    console.log(`${service.name}: ${online ? 'running' : 'stopped'} · launchd=${managed ? state : '未注册'}`);
  }
}

if (action === 'install') await install();
else if (action === 'uninstall') await uninstall();
else if (action === 'status') await status();
else if (action === 'print') { for (const service of selected()) console.log(plist(service)); }
else throw new Error('用法：npm run service -- install|uninstall|status|print [paperclip|bridge]');
