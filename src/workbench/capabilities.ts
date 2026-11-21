import type { FeishuSources } from '../feishu-sources.ts';
import type { inspectBranch, inspectCommitChecks, inspectIssue, inspectPull } from './github-delivery.ts';
import type { inspectProductVerification } from './github-product-verification.ts';
import type { readKnowledgeSource } from './knowledge-sources.ts';
import type { knowledgeHealth } from './knowledge-health.ts';
import type { FigmaSources } from './figma-source.ts';
import type { octopReportedModel, prepareOctop } from './octop-bridge.ts';
import type { readSkillManifest } from './skill-manifest.ts';
import type { AssistantService } from './platform-assistant.ts';
import type { AssistantHarnessProvider } from './assistant-harness.ts';

export interface Capabilities {
  assistant: AssistantService;
  assistantHarness: AssistantHarnessProvider;
  delivery: {
    inspectPull: typeof inspectPull;
    inspectBranch: typeof inspectBranch;
    inspectIssue: typeof inspectIssue;
    inspectCommitChecks: typeof inspectCommitChecks;
    inspectProductVerification: typeof inspectProductVerification;
  };
  sources: {
    feishu: FeishuSources;
    figma: FigmaSources;
    read: (connection: Parameters<typeof readKnowledgeSource>[0]) => ReturnType<typeof readKnowledgeSource>;
  };
  memory: {
    search?: (input: { query: string; entries: { id: string; rev: string; text: string }[] }) => unknown | Promise<unknown>;
    health: ReturnType<typeof knowledgeHealth>;
  };
  expert: {
    prepare: typeof prepareOctop;
    modelReceipt: typeof octopReportedModel;
    readSkill: typeof readSkillManifest;
  };
  gateway: {
    normalizeFeishu?: (input: { namespace: string; id: string; sender: string; chat: string; thread: string; text: string }) => unknown | Promise<unknown>;
  };
}

type Name = keyof Capabilities;
type Provider<K extends Name> = { id: string; api: 1; service: Capabilities[K] };
type Providers = { [K in Name]: Provider<K> };
export type PluginProfile = Partial<Providers>;
export type CapabilityProvider = { capability: Name; id: string; api: 1 };

/** Platform startup selects one provider per capability. Provider identity is visible to operators. */
export function connectCapabilities(defaults: Providers, profile: PluginProfile) {
  const selected: Providers = { ...defaults, ...profile };
  const manifest: CapabilityProvider[] = (Object.keys(defaults) as Name[]).map(capability => {
    const { id, api } = selected[capability];
    if (api !== 1 || !/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new Error('插件接口版本或名称无效：' + capability);
    return { capability, id, api };
  });
  return {
    use<K extends Name>(capability: K): Capabilities[K] { return selected[capability].service; },
    manifest: () => manifest.map(row => ({ ...row })),
  };
}

export class PluginHost {
  private readonly active = new Map<string, () => void | Promise<void>>();
  private readonly starting = new Map<string, Promise<unknown>>();
  private stop?: Promise<void>;

  async mount<T>(id: string, activate: () => { value: T; close: () => void | Promise<void> } | Promise<{ value: T; close: () => void | Promise<void> }>) {
    if (this.stop || this.active.has(id) || this.starting.has(id)) throw new Error('插件已启动或正在关闭：' + id);
    const result = Promise.resolve().then(activate).then(async instance => {
      if (this.stop) {
        await instance.close();
        throw new Error('插件启动时工作台正在关闭：' + id);
      }
      this.active.set(id, instance.close);
      return instance.value;
    });
    this.starting.set(id, result);
    try { return await result; } finally { this.starting.delete(id); }
  }

  close() {
    return this.stop ??= Promise.resolve().then(() => this.dispose());
  }

  private async dispose() {
    const errors: unknown[] = [];
    await Promise.allSettled([...this.starting.values()]);
    for (const close of [...this.active.values()].reverse()) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    this.active.clear();
    if (errors.length) throw new AggregateError(errors, '插件关闭未完成');
  }
}
