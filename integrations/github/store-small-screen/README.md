# 门店推荐理由小屏 CI

本目录提供专用测试仓的独立检查。使用样例时将 Contractor 工单的写入范围设为 `collab-pilot/index.html`。

部署时把本目录的 `.github/workflows/contractor-store-small-screen.yml` 和 `.github/contractor-store-small-screen/` 原路径放到专用基线 `contractor/layout-ci-pilot-base`。在基线放入一个 280px 宽度检查会失败的样本。基线和新工单分支的 push 触发独立检查，按推送的 SHA 检出。新测试 PR 以这条基线为目标，题设仅修复 280px 正文宽度。

将 [pilot-execution.json](pilot-execution.json) 用作独立测试项目的仓库交付配置。工单冻结 `collab-pilot` 和 `contractor-store-small-screen` 两项 GitHub Actions 检查。原发起人在工作台同时核对三项机器结果和一项人工内容与视觉检查。Contractor 通过交付配置执行这套规则。

检查使用固定的 Playwright 依赖，在禁用页面 JavaScript 和外部请求的浏览器里测量 280px、320px 和 360px。每档须找到包含连续长词的可见正文、实际换行，且正文与页面均无横向溢出。280px 下正文容器至少 244px。失败退出码为 1。工作流在成功和失败时都上传 `contractor-verification.json`，产物名称包括提交 SHA 和运行尝试号。报告包含浏览器版本、HTML SHA-256、测量值和逐项结果。修改可信验证文件需同时更新交付模板的版本和对应 `git hash-object` 值。

本地执行可以指定已有 Chrome：

```sh
npm ci --ignore-scripts --prefix .github/contractor-store-small-screen
CONTRACTOR_CHROMIUM=/path/to/chrome node .github/contractor-store-small-screen/check.mjs \
  collab-pilot/index.html "$(git rev-parse HEAD)" /tmp/contractor-verification.json
```

验证顺序：基线 SHA 必须有明确的 280px 失败；新工单同一 PR 的本版 SHA 两项检查必须同时成功；只给原 CI、给错 SHA、给新版失败检查均不得进入验收。由发起人根据本版 CI 和人工检查结果验收。测试 PR 保持开放。
