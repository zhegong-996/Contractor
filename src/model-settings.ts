import { z } from 'zod';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';

export const modelSettingsInput = z.object({
  profiles: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), name: z.string().trim().min(1).max(80),
    tier: z.enum(['fast', 'standard', 'code']),
    provider: z.enum(['unconfigured', 'gemini', 'ark', 'codex-cli', 'claude-cli', 'other']),
    model: z.string().trim().max(160), credentialEnv: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$|^$/),
    maxInputChars: z.number().int().min(1000).max(80000), maxOutputTokens: z.number().int().min(128).max(16384),
  }).strict()).min(1).max(12),
  bindings: z.array(z.object({ agent: z.string(), fast: z.string(), standard: z.string(), code: z.string() }).strict()).max(100),
  externalRequestsEnabled: z.literal(false),
}).strict();
export type ModelSettings = z.infer<typeof modelSettingsInput>;
export function validateModelSettings(value: unknown, participants: string[]) {
  const result = modelSettingsInput.parse(value), ids = result.profiles.map(p => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('模型配置标识不能重复');
  if (new Set(result.bindings.map(b => b.agent)).size !== result.bindings.length) throw new Error('执行身份不能重复绑定');
  for (const binding of result.bindings) {
    if (!participants.includes(binding.agent)) throw new Error('执行身份未配置');
    for (const tier of ['fast', 'standard', 'code'] as const) {
      if (binding[tier] && !result.profiles.some(p => p.id === binding[tier] && p.tier === tier)) throw new Error('模型分层与绑定不一致');
    }
  }
  return result;
}

// Configuration only. Existing native CLI execution stays unchanged until an
// explicitly authorized, tested model gateway is enabled in a later change.
export class ModelSettingsService {
  constructor(readonly w: Workspaces) {}
  defaults(): ModelSettings {
    return { profiles: [
      { id: 'fast', name: '轻量事务', tier: 'fast', provider: 'unconfigured', model: '', credentialEnv: '', maxInputChars: 12000, maxOutputTokens: 2048 },
      { id: 'standard', name: '复杂分析', tier: 'standard', provider: 'codex-cli', model: '', credentialEnv: '', maxInputChars: 24000, maxOutputTokens: 4096 },
      { id: 'code', name: '开发执行', tier: 'code', provider: 'codex-cli', model: '', credentialEnv: '', maxInputChars: 24000, maxOutputTokens: 8192 },
    ], bindings: this.w.participantKeys().map(agent => ({ agent, fast: 'fast', standard: 'standard', code: 'code' })), externalRequestsEnabled: false };
  }
  async read(actor: WorkspaceActor) {
    this.w.manager(actor); const catalog = this.w.catalog(); let settings = this.defaults(), revision: string | null = null;
    if (catalog.modelRegistryIssueId) {
      const issue = await this.w.issue(catalog.modelRegistryIssueId);
      if (issue.projectId !== catalog.vaultProject || issue.visibility !== 'private') throw new Error('模型配置存储边界发生变化');
      const doc = await this.w.pc.get('/issues/' + issue.id + '/documents/model-settings');
      const saved = modelSettingsInput.parse(JSON.parse(doc.body)), participants = this.w.participantKeys();
      settings = validateModelSettings({ ...saved, bindings: saved.bindings.filter(b => participants.includes(b.agent)) }, participants);
      for (const agent of participants) if (!settings.bindings.some(b => b.agent === agent)) settings.bindings.push({ agent, fast: '', standard: '', code: '' });
      revision = doc.latestRevisionId;
    }
    return { settings, revision, activeMode: 'existing-cli', externalRequestsEnabled: false,
      currentAssistant: { engine: this.w.config.assistant?.engine ?? 'codex', model: this.w.config.assistant?.model ?? null },
      identities: this.w.participantKeys().map(key => ({ key, name: this.w.config.agents[key]!.name,
        mode: this.w.config.agents[key]!.mode, engine: this.w.config.agents[key]!.use, model: this.w.config.agents[key]!.model ?? null })),
      ownership: 'local-board-only', storage: 'Paperclip 私有文档 / PostgreSQL' };
  }
  async save(input: unknown, expectedRevision: string | null, actor: WorkspaceActor) {
    this.w.manager(actor); const settings = validateModelSettings(input, this.w.participantKeys()), catalog = this.w.catalog();
    const current = await this.read(actor);
    if (current.revision !== expectedRevision) throw new Error('模型配置已变化，请刷新后再保存');
    if (!catalog.modelRegistryIssueId) {
      const issue = await this.w.pc.post('/companies/' + this.w.config.companyId + '/issues', { title: '模型配置与委托策略',
        projectId: catalog.vaultProject, visibility: 'private', status: 'backlog', allowDuplicate: true, idempotencyKey: 'suitme-model-settings-v1' });
      catalog.modelRegistryIssueId = issue.id; this.w.saveCatalog(catalog);
    }
    await this.w.pc.request('PUT', '/issues/' + catalog.modelRegistryIssueId + '/documents/model-settings', {
      title: '模型配置与委托策略', format: 'markdown', body: JSON.stringify(settings, null, 2), baseRevisionId: expectedRevision,
    });
    this.w.store.audit('models.configuration-saved', catalog.modelRegistryIssueId!, { profileCount: settings.profiles.length, externalRequestsEnabled: false });
    return this.read(actor);
  }
}
