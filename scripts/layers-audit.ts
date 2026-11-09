/**
 * 分层契约体检 CLI（第四十轮）。
 *
 *   npm run audit:layers            # 人读表格，有 gap 退出码 1
 *   npm run audit:layers -- --json  # 机器读 JSON（桥 / 控制台 / CI 用）
 *
 * 纯判定部分在 src/layers-audit.ts；本脚本只补三类**运行时**事实：
 *   1. 五个派活点是否真的都接在 Router 上（读源码，不靠开关自述）；
 *   2. casbin 策略文件是否仍包含种子权限、且没有被悄悄放宽；
 *   3. 路由配置与 Agent 编制是否自洽（配了分层主管就必须真的在岗）。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root, loadConfig, defaultRouterConfig } from '../src/config.ts';
import { agentRegistrySchema, defaultAgentRegistry } from '../src/agent-registry.ts';
import { ROLE_PERMISSIONS, RBAC_HUMAN_ROLES, RBAC_AGENT_TIERS, rbacPolicyText } from '../src/rbac.ts';
import { auditLayerContracts, LAYER_LABELS, type LayerCheck, type LayerReport } from '../src/layers-audit.ts';

const DISPATCH_POINTS = [
  ['src/controller.ts', '入口路由 / 建单 / 交接'],
  ['src/coordination.ts', 'Super Agent 策略准入'],
  ['src/assistant.ts', '事务整理 Agent 调度'],
  ['src/service-network.ts', 'A2A 服务委派'],
  ['src/v06.ts', '职能责任转移与派单校验'],
] as const;

const check = (id: string, layer: LayerCheck['layer'], title: string, claim: string,
  status: LayerCheck['status'], evidence: string[], note?: string): LayerCheck =>
  ({ id, layer, title, claim, status, evidence, ...(note ? { note } : {}), modelCalls: 0 });

function wiringCheck(): LayerCheck {
  const rows = DISPATCH_POINTS.map(([file, purpose]) => {
    const source = readFileSync(path.join(root, file), 'utf8');
    const routeCalls = (source.match(/\.route\(/g) ?? []).length;
    const legacyWrites = (source.match(/routingDecision\(/g) ?? []).length;
    return { file, purpose, routeCalls, legacyWrites, wired: routeCalls > 0 && legacyWrites === 0 };
  });
  const bad = rows.filter(row => !row.wired);
  return check('runtime.dispatch-wiring', 'router', '五个派活点都接在 Router 上',
    '源码里存在 route(...) 调用且没有绕过 Router 直写决策；少一个就算未收敛',
    bad.length === 0 ? 'ok' : 'gap',
    rows.map(row => `${row.file} route=${row.routeCalls} 直写=${row.legacyWrites}`),
    bad.length ? `未接线：${bad.map(row => row.file).join('、')}` : undefined);
}

function policyCheck(): LayerCheck {
  const text = rbacPolicyText();
  const lines = new Set(text.split('\n').map(line => line.trim()).filter(Boolean));
  const missing: string[] = [];
  for (const role of [...RBAC_HUMAN_ROLES, ...RBAC_AGENT_TIERS])
    for (const permission of ROLE_PERMISSIONS[role] ?? [])
      if (!lines.has(`p, ${role}, ${permission}, use`)) missing.push(`${role}/${permission}`);

  // 反向红线：这些组合一旦出现在策略文件里，就是越权放宽。
  const forbidden = [
    'p, viewer, task-control, use',
    'p, viewer, knowledge-write-team, use',
    'p, agent-personal, knowledge-write-team, use',
    'p, agent-worker, knowledge-write-org, use',
  ].filter(line => lines.has(line));

  const status = missing.length || forbidden.length ? 'gap' : 'ok';
  return check('runtime.rbac-policy', 'permission', '策略文件没有悄悄放宽',
    '生效的 casbin 策略仍包含全部种子权限，且不存在 viewer / personal 的越权授予',
    status,
    [`策略行数=${lines.size}`, `缺失种子=${missing.length}`, `越权组合=${forbidden.length}`],
    missing.length ? `缺失：${missing.slice(0, 6).join('、')}` : forbidden.length ? `越权：${forbidden.join('；')}` : undefined);
}

function configCheck(): LayerCheck {
  let router = defaultRouterConfig();
  let registry = defaultAgentRegistry();
  const notes: string[] = [];
  try {
    const config = loadConfig();
    router = config.router;
    registry = agentRegistrySchema.parse(config.agentRegistry);
    notes.push(`scheduler.enabled=${config.scheduler?.enabled ?? false}`,
      `routines=${config.scheduler?.routines?.length ?? 0}`,
      `eventInbox.enabled=${config.eventInbox?.enabled ?? false}`,
      `sources=${config.eventInbox?.sources?.length ?? 0}`);
  } catch (error) {
    notes.push(`读取配置失败，按默认值判定：${String(error instanceof Error ? error.message : error).slice(0, 120)}`);
  }
  const onDuty = new Set(registry.agents.filter(agent => agent.enabled).map(agent => agent.key));
  const problems: string[] = [];
  if (router.mode === 'layered') {
    for (const [domain, entry] of Object.entries(router.domains)) {
      if (!onDuty.has(entry.supervisorAgentKey)) problems.push(`${domain} 的主管 ${entry.supervisorAgentKey} 不在岗`);
    }
  }
  if (router.mode === 'legacy') problems.push('路由处于 legacy 直写模式，未走统一 Trace');
  const evidence = [`mode=${router.mode}`, `domains=${Object.keys(router.domains).length}`, `在岗 Agent=${onDuty.size}`, ...notes];
  return check('runtime.router-config', 'router', '配置与编制自洽',
    '分层模式下每个业务域的主管都真实在岗；legacy 直写模式视为未收敛',
    problems.length ? 'gap' : 'ok', evidence, problems.length ? problems.join('；') : undefined);
}

function merge(base: LayerReport, extras: LayerCheck[]): LayerReport {
  const checks = [...base.checks, ...extras];
  const counts = { total: checks.length, ok: 0, partial: 0, gap: 0 };
  const byLayer = { ...base.byLayer };
  for (const key of Object.keys(byLayer) as (keyof typeof byLayer)[]) byLayer[key] = { ok: 0, partial: 0, gap: 0, verdict: 'ok' };
  for (const item of checks) {
    counts[item.status]++;
    byLayer[item.layer][item.status]++;
  }
  for (const key of Object.keys(byLayer) as (keyof typeof byLayer)[]) {
    const entry = byLayer[key];
    entry.verdict = entry.gap > 0 ? 'gap' : entry.partial > 0 ? 'partial' : 'ok';
  }
  return { ...base, ok: counts.gap === 0, counts, byLayer, checks };
}

const ICON = { ok: '✓', partial: '◐', gap: '✗' } as const;

function printTable(report: LayerReport) {
  console.log(`\n分层契约体检 · 共 ${report.counts.total} 条（ok ${report.counts.ok} / partial ${report.counts.partial} / gap ${report.counts.gap}）\n`);
  for (const layer of Object.keys(report.byLayer) as (keyof typeof report.byLayer)[]) {
    const verdict = report.byLayer[layer];
    console.log(`【${LAYER_LABELS[layer]}】${ICON[verdict.verdict]}  ok ${verdict.ok} · partial ${verdict.partial} · gap ${verdict.gap}`);
    for (const item of report.checks.filter(entry => entry.layer === layer)) {
      console.log(`  ${ICON[item.status]} ${item.title}`);
      console.log(`     ${item.claim}`);
      console.log(`     证据：${item.evidence.join(' / ')}`);
      if (item.note) console.log(`     说明：${item.note}`);
    }
    console.log('');
  }
  console.log(report.ok ? '结论：无 gap。partial 项已在说明里写明边界，不当成通过。' : '结论：存在 gap，按上表逐条修。');
}

async function main() {
  const json = process.argv.includes('--json');
  const base = auditLayerContracts();
  const report = merge(base, [wiringCheck(), policyCheck(), configCheck()]);
  if (json) {
    console.log(JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
  } else {
    printTable(report);
  }
  if (!report.ok) process.exitCode = 1;
}

if (!existsSync(path.join(root, 'src/config.ts'))) {
  console.error('请在仓库根目录运行：npm run audit:layers');
  process.exitCode = 2;
} else {
  await main();
}
