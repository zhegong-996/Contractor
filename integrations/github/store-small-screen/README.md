# 门店推荐理由小屏 CI

本目录提供专用测试仓的独立检查。使用样例时将 Contractor 工单的写入范围设为 `collab-pilot/index.html`。

部署时把本目录的 `.github/workflows/contractor-store-small-screen.yml` 和 `.github/contractor-store-small-screen/` 原路径放到测试仓的专用基线。试点使用 `codex/store-acceptance-media-base-1121`，基线保留 `collab-pilot` 检查和一份 280px 宽度检查会失败的样本。工单分支 `contractor/**` 的 push 触发独立浏览器检查，按推送的 SHA 检出。新测试 PR 以这条基线为目标，修复仅涉及 280px 正文宽度。

将 [pilot-execution.json](pilot-execution.json) 用作独立测试项目的仓库交付配置。工单冻结 `collab-pilot` 和 `contractor-store-small-screen` 两项 GitHub Actions 检查。原发起人在工作台同时核对三项机器结果和一项人工内容与视觉检查。Contractor 通过交付配置执行这套规则。

检查使用固定的 Playwright 依赖，在禁用页面 JavaScript 和外部请求的浏览器里测量 280px、320px 和 360px。每档须找到包含连续长词的可见正文、实际换行，且正文与页面均无横向溢出。280px 下正文容器至少 244px。失败退出码为 1。工作流在成功和失败时都上传 `contractor-verification.json` 和三个用例各自的截图与录像。产物名称包含提交 SHA 和运行尝试号，报告包含浏览器版本、HTML SHA-256、测量值和逐项结果。修改可信验证文件时同时更新交付模板的版本和对应 `git hash-object` 值。

本地执行可以指定已有 Chrome。录像依赖 Playwright 提供的 FFmpeg。

```sh
npm ci --ignore-scripts --prefix .github/contractor-store-small-screen
.github/contractor-store-small-screen/node_modules/.bin/playwright install ffmpeg
CONTRACTOR_CHROMIUM=/path/to/chrome node .github/contractor-store-small-screen/check.mjs \
  collab-pilot/index.html "$(git rev-parse HEAD)" /tmp/contractor-verification.json
```

第一版需保留 280px 失败的截图与录像，供发起人从失败项发起修改。修复版两项检查均需通过，并按新版提交重新归档。发起人核对新版 CI、用例证据与人工检查结果后验收。测试 PR 保持开放。
