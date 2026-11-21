import { FeishuSources } from '../feishu-sources.ts';
import { connectCapabilities, type PluginProfile } from './capabilities.ts';
import { inspectBranch, inspectCommitChecks, inspectIssue, inspectPull } from './github-delivery.ts';
import { inspectProductVerification } from './github-product-verification.ts';
import { readKnowledgeSource } from './knowledge-sources.ts';
import { memoryProviders } from './memory-providers.ts';
import { FigmaSources } from './figma-source.ts';
import { octopCall, octopReportedModel, prepareOctop } from './octop-bridge.ts';
import { readSkillManifest } from './skill-manifest.ts';
import { textAssistant } from './platform-assistant.ts';
import type { Settings } from './config.ts';

export function platformPlugins({ octop, plugins }: Settings, profile: PluginProfile = {}) {
  const feishu = new FeishuSources();
  const figma = new FigmaSources();
  const memory = memoryProviders[plugins?.memory ?? (octop ? 'octop' : 'native')](octop);
  return connectCapabilities({
    assistant: { id: 'text-completions', api: 1, service: textAssistant() },
    delivery: { id: 'github-actions', api: 1,
      service: { inspectPull, inspectBranch, inspectIssue, inspectCommitChecks, inspectProductVerification } },
    sources: { id: 'project-sources', api: 1,
      service: { feishu, figma, read: connection => readKnowledgeSource(connection, feishu, undefined, figma) } },
    memory,
    expert: { id: 'deepseek-readonly', api: 1,
      service: { prepare: prepareOctop, modelReceipt: octopReportedModel, readSkill: readSkillManifest } },
    gateway: { id: octop?.feishuGateway ? 'octop-feishu' : 'native-feishu', api: 1,
      service: { normalizeFeishu: octop?.feishuGateway ? data => octopCall(octop, 'gateway', data) : undefined } },
  }, profile);
}
