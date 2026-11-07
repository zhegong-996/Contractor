# 08 · 需要用户拍板的事项（接手者不要擅自决定）

> 这些是**产品/隐私层面的选择**，不是代码缺口。每一项都写清冲突与可选方案，问过用户再动。

## 1. 移除 Plugin SDK 与「5 tab 插件式单页」冲突 ⚠️ 最重要

- **用户说过**：「Paperclip 的平台底座和 plugin sdk 不要了」。
- **但** PRD §10A 与既有实现要求前端必须是 Paperclip 插件式 5 tab 单页；当前任务真源、ACL、文档修订、宿主 actor 全由 Paperclip 提供。一次删掉会让系统不可运行。
- **当前做法**（已落地）：`HostPlatformPort` 端口抽象 + `LocalHostPlatform` 可运行最小实现，`config.host.provider` 默认仍是 `paperclip`，**未切换**。
- **需要用户选**：
  - (a) 保持 5 tab 插件单页 → 换一个兼容插件机制的宿主（候选 Octop MIT / CoPaw Apache-2.0），不移除「插件式」这一形态；
  - (b) 改成独立前端应用 → 明确废弃 PRD §10A，需同步改写红线文档与前端分层；
  - (c) 暂不切换，先做 B2 / C，底座切换排到 C 之后。
- 无论选哪个，切换前都要补齐 `platform-port.ts capabilities().missing` 的 5 项（ACL、cost-ledger、Plugin UI、heartbeat 真实执行、PG 事务）。

## 2. 外部模型端点与凭据（Cognee 原生 `cognify` 真跑）

- 已按用户决策允许外部 OpenAI-compatible API 并实现链路，但**真实调用从未发生**。
- 需要用户提供 `COGNEE_LLM_BASE_URL` / `COGNEE_LLM_API_KEY` / `COGNEE_EMBEDDING_BASE_URL` / `COGNEE_EMBEDDING_API_KEY` 的环境变量名与值（只放进程环境，不入库）。
- 用户需再次确认：业务材料发往该外部服务是可接受的。

## 3. 真人业务验收（SUI-129）

- 只能由**原发起人在原会话**执行「确认验收 任务编号」。Agent 不得代做、不得用报告/CI/合并审批替代。
- 若用户希望推进试点结案，需要他本人操作；Agent 只能准备材料与核对闸门。

## 4. 飞书部门 scope 授权

- `npm run org:auth` 已生成携带现有全部 scope + 缺失 scope 的安全登录命令（不会清空已有 162 个权限），默认只打印。
- `--execute` 仍需**本人在飞书确认**，脚本不代替授权。

## 5. B2 范围与优先级

- 用户已定 A → B → C 不并行，但「B 阶段」内部 B1/B2 的划分是本轮做出的。请确认是否按 `06` 第 2 节的 4 项顺序推进，或调整优先级。
- 若要跳过 B2 直接做 C，需要用户明确改口（当前口径是「B2 验收通过后才开始 C」）。

## 6. 国内 / 海外外部服务是否接通

- 企业微信、腾讯文档、钉钉、Gitee/CNB/工蜂、公有云 CI、Slack/GitHub/Linear/Notion/Vercel/Zapier 均未接通，按「没连接不放空入口」只有灰字说明。
- 若要加入口，必须先配置凭据并**实测接通**，再由 `service-status` 探测为 `ok:true` 才渲染链接。不要先放入口再补实现。

## 7. 已取消服务的长期状态

- 4190 / 4192 / 4194 / 9418 目前按「用户主动取消、不得重启」处理。
- 若后续要恢复本机交付台 / 视觉端点 / 报告服务，需要用户明确说「可以重启」，并重新跑相关端到端冒烟。

## 8. 「pi」的指代

- 文档按 **Pi Coding Agent**（原 `badlogic/pi-mono`，现 `earendil-works/pi`，MIT core，与本项目已移植的 prime-agent 同作者 Mario Zechner）理解，列为 worker 执行层候选。
- 若用户指的是其它项目，需要指出对应仓库，再重新核对许可证与接入方式。
