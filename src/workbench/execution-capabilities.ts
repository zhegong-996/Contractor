import type { RunnerAgent } from './runner-profile.ts';

/** Capabilities of the installed isolation adapters, not user-written skill claims.
 * Availability of credentials, devices and budgets is checked again when claiming work.
 */
export function executionCapabilities(agent: RunnerAgent) {
  const config = agent.execution;
  const test = config?.kind === 'test' && !!process.env.NODE_TEST_CONTEXT;
  const codex = agent.engine === 'codex' && config?.provider === 'openai'
    && !!config.credential && !!agent.model?.trim();
  const local = test || config?.kind === 'sandbox' && codex;
  const remote = config?.kind === 'remote' && !!agent.model?.trim()
    && (codex || agent.engine === 'claude' && ['ollama', 'deepseek'].includes(config.provider) && !config.credential);
  const harness = config?.kind === 'harness' && agent.engine === 'octop' && !!agent.model;
  const available = local || remote || harness;
  const reason = available ? undefined : !config ? '尚未配置隔离执行方式'
    : config.kind === 'test' ? '测试执行器不能在生产环境使用'
    : !agent.model?.trim() ? '尚未配置模型'
    : agent.engine === 'codex' && config.provider === 'openai' && !config.credential ? '尚未配置成员独立凭据'
    : '此引擎和模型服务尚未完成隔离适配';
  return { available, read: available, code: (local || remote) && (test || agent.engine === 'codex'),
    local, remote, registerDevice: local || remote, platformDigest: local,
    boundary: test ? 'test' : remote ? 'remote' : local ? 'os-sandbox' : harness ? 'octop' : 'unavailable', reason };
}
