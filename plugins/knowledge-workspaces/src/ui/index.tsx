// 插件 UI 入口：SDK 的 uiEntry 固定指向本文件，业务实现按职责拆到各模块。
// 分层：foundation（原语/契约）→ async（异步）→ forms / domestic-services /
// settings / task-detail / spaces（视图）→ workspace-page（页面壳）。
export { WorkspacePage } from './workspace-page.js';
export { WorkspaceSidebar } from './foundation.js';
