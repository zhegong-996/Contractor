// 只读查看统一路由 Trace、三层判断与平台切换清单。
// 用法：npm run routing:status
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { readRoutingEvents, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import { platformSwitchChecklist } from '../src/platform-port.ts';

const WIRING = [
  ['src/controller.ts', '入口路由 / 建单 / 交接'],
  ['src/coordination.ts', 'Super Agent 策略准入'],
  ['src/assistant.ts', '事务整理 Agent 调度'],
  ['src/service-network.ts', 'A2A 服务委派'],
  ['src/v06.ts', '职能责任转移与派单校验'],
] as const;

const wiring = WIRING.map(([file, purpose]) => {
  const source = readFileSync(path.join(root, file), 'utf8');
  // 协调器用可注入的 trace?.record(...)，其余四处用单例 getRoutingTrace().record(...)。
  const calls = (source.match(/\.record\(/g) ?? []).length;
  return { file, purpose, recordCalls: calls,
    wired: source.includes("from './routing-decision.ts'") && source.includes("from './routing-trace.ts'") && calls > 0 };
});

const { events, errors } = readRoutingEvents();
const projection = replayRouting(events);
const threeTier = assessThreeTier(events, projection, errors);

console.log(JSON.stringify({
  ok: true,
  log: '.runtime/routing/events.jsonl',
  wiring,
  allWired: wiring.every(w => w.wired),
  eventCount: events.length,
  logErrors: errors,
  projection,
  threeTier,
  platformSwitch: platformSwitchChecklist(),
}, null, 2));
