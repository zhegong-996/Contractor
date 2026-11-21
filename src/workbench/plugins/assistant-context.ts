import type { AssistantHarnessProvider } from '../assistant-harness.ts';

export const assistantContext: AssistantHarnessProvider = {
  context: [
    { id: 'project-topic', version: '1', title: '主题归属', description: '将已确认的项目主题标识带入路由建议。', purposes: ['router'],
      defaultEnabled: true, contribute: ({ topic }) => topic ? { topic } : {} },
    { id: 'confirmed-experience', version: '1', title: '本人确认的经验', description: '将个人设置中保存的经验带入回答。', purposes: ['personal'],
      defaultEnabled: true, contribute: ({ experience }) => ({ experience: experience ?? '' }) },
    { id: 'conversation-history', version: '1', title: '最近会话', description: '续聊时带入本人的最近 8 轮已回答消息。', purposes: ['personal'],
      defaultEnabled: true, contribute: ({ history }) => history?.length ? { history } : {} },
  ],
  skills: [
    { id: 'clarify-scope', slug: 'clarify-scope', title: '澄清委托范围', purposes: ['router', 'personal'],
      instructions: '遇到多模块或多责任人的反馈，区分当前问题、拟改变的范围和必须澄清的条件。优先列出一个会改变下一步安排的问题。' },
    { id: 'review-acceptance', slug: 'review-acceptance', title: '整理验收清单', purposes: ['personal'],
      instructions: '把可检查的要求写为场景、操作和预期。标明适用版本、有效样例和待补证据，便于使用同一套清单复验。' },
    { id: 'capture-reusable-rule', slug: 'capture-reusable-rule', title: '提炼可复用的规则', purposes: ['memory'],
      instructions: '按触发条件、操作、验证方法提炼经验。将只对某一实现成立的数值或版本要求保留在适用条件内。' },
  ],
};
