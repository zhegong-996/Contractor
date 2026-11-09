// 一条命令装起来（第四十一轮）：
//   npm run bootstrap              按计划执行（幂等，失败即停）
//   npm run bootstrap -- --dry-run 只打印计划，不执行任何命令
//   npm run bootstrap -- --no-start 不起本机服务（只准备配置与依赖）
//
// 自动化边界写在 src/bootstrap.ts：建管理员、飞书授权、真实业务单仍需人做。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { root, runtime, configPath } from '../src/config.ts';
import { buildBootstrapPlan, runBootstrap, type BootstrapEnv, type ExecResult } from '../src/bootstrap.ts';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noStart = argv.includes('--no-start');

const exec = (command: string, args: string[]): Promise<ExecResult> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
  child.once('error', reject);
  child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
});

async function servicesRunning(): Promise<boolean> {
  try {
    const { loadConfig } = await import('../src/config.ts');
    const config = loadConfig();
    const response = await fetch(`http://127.0.0.1:${config.bridgePort}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}

const env: BootstrapEnv = {
  nodeVersion: process.version,
  hasNodeModules: existsSync(root + '/node_modules'),
  hasConfig: existsSync(configPath),
  hasSecrets: existsSync(runtime('secrets.json')),
  hasRuntime: existsSync(runtime()),
  servicesRunning: noStart ? true : await servicesRunning(),
  strictNode: argv.includes('--strict-node'),
};

const plan = buildBootstrapPlan(env);
console.log('本机协作系统 · 一条命令安装');
console.log(`计划 ${plan.steps.length} 步${dryRun ? '（dry-run：只打印，不执行）' : ''}：`);
plan.steps.forEach((step, index) => {
  const skip = step.skip?.when ? `（跳过：${step.skip.reason}）` : '';
  console.log(`  ${index + 1}. ${step.title}${skip} —— ${step.detail}`);
});
if (plan.blocked) { console.error('\n无法继续：' + plan.blocked); process.exit(1); }
for (const warning of plan.warnings) console.warn('注意：' + warning);
if (dryRun) {
  console.log('\n下一步（装完之后需要人做的）：');
  for (const step of plan.nextSteps) console.log('  · ' + step);
  process.exit(0);
}

const outcome = await runBootstrap(plan, { exec, log: line => console.log('· ' + line), dryRun: false });
if (!outcome.ok) {
  console.error('\n安装中止：' + outcome.message);
  if (outcome.stoppedAt) console.error('停在第 ' + (plan.steps.findIndex(step => step.id === outcome.stoppedAt) + 1) + ' 步（' + outcome.stoppedAt + '）。修好这一项后重跑同一条命令即可，已完成的步骤会自动跳过。');
  process.exit(1);
}
console.log('\n装好了。还需要你亲自做这几步：');
for (const step of plan.nextSteps) console.log('  · ' + step);
console.log('\n边界：' + plan.notes.join('；'));
