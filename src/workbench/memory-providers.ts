import type { Capabilities } from './capabilities.ts';
import type { OctopSettings } from './config.ts';
import { knowledgeHealth } from './knowledge-health.ts';
import { octopCall } from './octop-bridge.ts';
import { weightedMemory } from './plugins/weighted-memory.ts';

type MemoryProvider = { id: string; api: 1; service: Capabilities['memory'] };
type Factory = (config?: OctopSettings) => MemoryProvider;

// Settings select a capability implementation without loading arbitrary paths.
export const memoryProviders = {
  native: () => ({ id: 'native-search', api: 1, service: { async health() { return { state: 'ready', mode: 'local', checkedAt: Date.now() }; } } }),
  octop(config) {
    if (!config) throw new Error('Octop 索引插件需要配置 octop 服务。');
    return { id: 'octop-index', api: 1, service: { search: input => octopCall(config, 'memory', input), health: knowledgeHealth(config) } };
  },
  'weighted-terms': () => ({ id: 'weighted-terms', api: 1, service: weightedMemory() }),
} satisfies Record<string, Factory>;

export const memoryProviderIds = Object.keys(memoryProviders) as (keyof typeof memoryProviders)[];
