# 第四十八轮：视觉评审接入 DeepSeek 多模态模型 + 模型网关开门

## 起因（一次诚实的口径更正）

用户质疑：「评审、模型网关，这些都不需要用到模型吗？SuperAgent、LobeHub Acceptance、
Agent AutoLoop 的中间过程（包括评审）应该都是有模型的吧，甚至需要多模态。」

结论：**用户是对的。** 此前交付说明里「评审默认程序判定、不用 LLM」的说法，把
「模型网关被写死关闭、还没做模型化评审」包装成了「评审本来就不需要模型」，不诚实。

上游真相（查证）：
- **DeepSeek SuperAgent**：`assessor` 用模型判断 inferred 候选；`router`/`worker` 全是 LLM。
- **LobeHub Acceptance**：独立 `Acceptance Model` 槽位（评审模型 ≠ 写作模型），
  「选择器只会列出支持视觉输入的模型」——评审**强制视觉模型**。
- **Agent AutoLoop（AegisFlow）**：`reviewer` 是更强的独立模型（`claude --model opus`）做只读对抗评审。

## 本轮做了什么

### 1. 模型网关开门（`src/model-settings.ts`）
`externalRequestsEnabled` 从 `z.literal(false)`（写死关闭）改为 `z.boolean()`（默认 false、可显式开）。
默认值仍是 false，不改变任何既有行为。

### 2. 外部视觉模型适配器（`src/visual-review.ts`）
新增 `ExternalVisionAdapter`，与既有的 `LocalModelVisionAdapter` 并列：
- 复用抽出的 `buildVisionBody` / `parseVisionResponse` 两个纯函数（本地/外部同一套消息与解析）。
- **安全红线不破坏**：外部端点必须 `https`；host 必须在授权白名单（`config.acceptance.visualReviewer.external.allowedHosts`）；
  key 从 `apiKeyEnv` 读，回退 `COGNEE_LLM_API_KEY`；无 key 时**诚实报错**，不假装判了视觉内容。
- 保持「评审模型 ≠ 写作模型」：DeepSeek 视觉做评审，codex/claude 做执行，天然不同 principal。

### 3. 配置 schema（`src/config.ts`）
`acceptance.visualReviewer` 新增 `external` 块：`enabled / allowedHosts / apiKeyEnv`，默认关闭。

### 4. 真实链路验证（非模拟）
- DeepSeek `/models` 返回两个模型：`deepseek-flash`（V4.1-Flash，`input_modalities: ["text","image"]`）
  与 `deepseek-v4-pro`（仅文本）。**`deepseek-flash` 就是支持多模态的那个**——用户「key 支持多模态」的判断正确。
- 用 1×1 像素图实测：图像被接受（`prompt_tokens: 224`），`content` 正常吐出 JSON、`finish: stop`。
- **踩到的坑**：`deepseek-flash` 是 reasoning 模型，`max_tokens` 太小会让 `content` 为空（推理被截断）。
  解法：外部适配器固定 `max_tokens: 4000` + `effort: 'low'`（视觉判定不需要深度推理，省 token）。

### 5. 运行时配置切换
`.runtime/config.json` 的视觉评审从 `apple-vision-local`（本地 OCR 确定性）切到
`external-vision:deepseek-flash`（DeepSeek 视觉语义判定）。重启后评审器 capabilities：
`{ vision: true, independent: true, externalModelEnabled: true, semanticJudgement: true }`。

## 验证

- `npm test` **723/723**（+4 外部视觉评审契约）
- `npx tsc --noEmit` 0 错
- `npm run audit:layers` **56 条：ok 56 / partial 0 / gap 0**（新增 `acceptance.vision-review-external-gated`）
- 真实 DeepSeek API：视觉输入被接受、JSON 输出可解析
- bridge 重启后 `/health` → `feishu: ready`，评审器 id 正确为 `external-vision:deepseek-flash`

## 诚实边界（还没到 LobeHub 的水平）

- DeepSeek 视觉是「通用视觉理解」，能判「截图里有没有、像不像」；
  **不是** LobeHub Acceptance 那套「录屏章节标记 + 前后对比 + 修复只改一行」的完整证据链。
- 录屏（video）仍是 `LocalModelVisionAdapter`/`ExternalVisionAdapter` 未真正解码的输入类型之一，
  本轮验证的是静态截图（screenshot）这一路。
- 视觉评审按量计费：目前没有 per-run 图片数上限 / 成本闸，需要在真实使用前补（LobeHub 明确提到这一点）。
