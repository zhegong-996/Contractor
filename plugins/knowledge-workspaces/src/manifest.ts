import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
const manifest: PaperclipPluginManifestV1 = {
  id: 'suitme.knowledge-workspaces', apiVersion: 1, version: '0.2.0', displayName: '知识协作', author: 'SuitMe',
  description: '在原生私有项目、任务、审批与文档之上接入跨岗位知识协作。',
  categories: ['automation', 'ui'], capabilities: ['ui.sidebar.register', 'ui.page.register'],
  entrypoints: { worker: './dist/worker.js', ui: './dist/ui' },
  ui: { slots: [
    { type: 'sidebar', id: 'workspace-sidebar', displayName: '知识协作', exportName: 'WorkspaceSidebar', order: 34 },
    { type: 'page', id: 'workspace-page', displayName: '知识协作', exportName: 'WorkspacePage', routePath: 'knowledge-workspaces' },
  ] },
};
export default manifest;
