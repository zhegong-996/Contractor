// 只读查看统一路由 Trace、单一 Router 配置、三层判断与平台切换清单。
// 用法：npm run routing:status
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, loadConfig, defaultRouterConfig } from '../src/config.ts';
import { readRoutingEvents, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import { platformSwitchChecklist } from '../src/platform-port.ts';
import { getRouter, configureRouter, planCoverage } from '../src/router.ts';

const WIRING = [
  ['src/controller.ts', '入口路由 / 建单 / 交接'],
  ['src/coordination.ts', 'Super Agent 策略准入'],
  ['src/assistant.ts', '事务整理 Agent 调度'],
  ['src/service-network.ts', 'A2A 服务委派'],
  ['src/v06.ts', '职能责任转移与派单校验'],
] as const;

// C-3 口径：五点都必须经 Router，且不得再直接写 Trace。
const wiring = WIRING.map(([file, purpose]) => {
  const source = readFileSync(path.join(root, file), 'utf8');
  const routeCalls = (source.match(/getRouter\(\)\.route\(/g) ?? []).length;
  const legacyWrites = (source.match(/\.record\(routingDecision\(/g) ?? []).length;
  return { file, purpose, routeCalls, legacyWrites,
    wired: source.includes("from './router.ts'") && routeCalls > 0 && legacyWrites === 0 };
});

let configSource = 'default(flat)';
try { configureRouter(loadConfig().router); configSource = '.runtime/config.json'; }
catch { configureRouter(defaultRouterConfig()); }

const { events, errors } = readRoutingEvents();
const projection = replayRouting(events);
const routerStatus = getRouter().status();
const threeTier = assessThreeTier(events, projection, errors,
  { routerMode: routerStatus.mode, configuredDomains: routerStatus.domains.length });

console.log(JSON.stringify({
  ok: true,
  log: '.runtime/routing/events.jsonl',
  wiring,
  allWired: wiring.every(w => w.wired),
  router: { ...routerStatus, configSource },
  routerCoverage: planCoverage(events),
  eventCount: events.length,
  logErrors: errors,
  projection,
  threeTier,
  platformSwitch: platformSwitchChecklist(),
}, null, 2));
