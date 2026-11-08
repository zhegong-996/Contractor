# Third-party notices

SuitMe 保留以下固定版本的来源与许可证。上游子模块内的版权、许可和其他声明继续有效。


## Paperclip

Commit: `0eaabe5c0b37c99d827f78a1a8598e7b3534078a`. Source and modifications: see `docs/SOURCES.md`.


```text
MIT License

Copyright (c) 2025 Paperclip AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```


## Agent Autoloop

Commit: `ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d`. Source and modifications: see `docs/SOURCES.md`.


```text
MIT License

Copyright (c) 2026 数字生命卡兹克

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```


## DSH Super-agent

Commit: `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`. Source and modifications: see `docs/SOURCES.md`.


```text
MIT License

Copyright (c) 2026 DeepSeek Harness Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```


## 用户既有研究实现

`src/evidence.ts` 经用户授权，迁移其本体论产品原型 `ai_bridge.py:validate_output` 和 `knowledge.py:public_snapshot` 的引用校验与失效投影逻辑，适配为 TypeScript；没有复制原型数据库或业务资料。新迁移逻辑在本仓库重新验证。

Alice 研究的架构和失效机制作为设计参考。本次没有复制 Alice 安装包提取、去混淆或反编译的业务代码、资源、商标、账号数据或隐藏服务凭据。包内 manifest 标注 MIT；对应完整许可与源码尚未核实，不将静态恢复视为原厂源代码授权证明。

插件运行时通过 Paperclip Plugin SDK 的公开接口调用宿主 React、Markdown 编辑器和导航；SDK 采用 Paperclip 同一 MIT 许可证。React、Zod、MCP SDK、构建与其他 npm 依赖各自保留其发行包许可证；本清单不是全部传递依赖的法律审计。

## Prime Agent

Pinned commit: 74591cddef28d11249c3171112114fc4755375d7. Original source retained unmodified under upstream/prime-agent.

```text
The MIT License (MIT)

Copyright (c) 2025-2026 Prime Intellect Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

This software is a port of the Prime Agent TypeScript product, originally
Copyright (c) 2025 Mario Zechner, used under the MIT License.

```

## DeepSeek Harness

Pinned commit: fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159. Original source retained unmodified under upstream/deepseek-harness.

Additional reused modules: `vendor/cordis`, `vendor/cosmokit`, `vendor/schemastery`, `packages/core/{scope,system-prompt,tools,tool-executor-native}`, `packages/preset/persona`, preset registry definition validation and the LLM message/error constructors. Original vendored dependencies remain MIT, Copyright (c) 2021-present Shigma; their full notices are retained in the three original `vendor/*/LICENSE` files and `licenses/harness-vendor-MIT.txt`. SuitMe composes a restricted scoped runtime; it does not activate the full Harness AgentLoop or a provider.

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```


## Cognee

Commit: `525b1d1179c550cd5b5661bcbf8f00f57a676928` (1.6.6). Source: https://github.com/topoteretes/cognee .

Reused without upstream source changes: Ladybug graph adapter, DataPoint and source provenance helpers; frontend graph renderer, graph schema reducer and JSON Schema serializer. SuitMe adds host identity/version checks, source-scoped graph storage and a React client-only compatibility boundary. Automatic extraction, embedding and remember/recall pipelines are not enabled.

License: Apache License 2.0; retained verbatim at `upstream/cognee/LICENSE` and `licenses/cognee-APACHE-2.0.txt`. Research comparisons are documented in `docs/KNOWLEDGE-ENGINE.md`.

## Additional direct source integration (2026-11-05)

The existing pinned Super-agent MIT source also supplies `settingsPolicy` and `assessmentOutcome`. The existing pinned Agent Autoloop MIT source also supplies `createWorker` for native process execution and receipt recovery. Both submodule worktrees remain unmodified. SuitMe adds native Paperclip ports and scoped MCP tools; no second hub is started.

## Agent2Agent JavaScript SDK

`@a2a-js/sdk` 1.3.0, package gitHead `29417a5bb4038f804f310ce4fffd267a9375aa90`, from https://github.com/a2aproject/a2a-js. Licensed under Apache-2.0, retained verbatim in `licenses/a2a-js-APACHE-2.0.txt`. The lockfile pins the registry package and integrity. The SDK executes actual native-task delegation, JSON-RPC state retrieval and durable cancellation; no separate business scheduler or unscoped external-agent discovery is introduced.

## Additional Cognee memory integration

The existing pinned Cognee source additionally supplies `BM25ChunksRetriever.initialize`, `_build_corpus_stats`, `_scorer` and content-derived chunk identity. SuitMe binds the corpus to authorized source-version Ladybug files, uses the existing Prime-derived tokenizer, and keeps proposed concepts/relations subject to human review and current GraphSchema. The pinned upstream remains unmodified. LLM/embedding services are not enabled by this integration.

## Acceptance (`lobehub/acceptance`) — Apache-2.0

Pinned submodule commit `f720feb862bdbe3acc653bdedc297e20e08be1ae` (v0.10.0), from https://github.com/lobehub/acceptance. `Copyright © 2026 LobeHub`. This is a **separate repository under Apache-2.0**, NOT the LobeHub Community License that governs the main `lobehub/lobehub` repository. Its LICENSE is retained verbatim in `licenses/acceptance-APACHE-2.0.txt` and the upstream copy is kept unmodified at `upstream/acceptance/LICENSE`; upstream has no NOTICE file to carry over. The fixed commit is recorded in `.gitmodules` and `sources.lock.json`.

Actually reused: the plan/report **contract and file layout** — locked plan items, evidence-source classification, per-item judgement, `result.json` / `report.md` / assets — mapped by our own adapters `src/acceptance-interop.ts` (`toAcceptancePlanItems`, `toAcceptanceReport`, `assertAcceptanceReport`, `writeAcceptanceBundle`) and `scripts/export-acceptance.ts`. The upstream `plugin.json` and `report-schema.md` are read only as format references. No upstream source file is modified, copied into `src/`, or bundled into a build.

Preserved boundaries: its CLI and cloud report service are **not started**; `/accept` still requires the original initiator's identity check and "Agent finished is not acceptance" stays in force; the independent reviewer must differ from the producing model; evidence classified as self-authored is rejected. Exported bundles are local `.runtime` artifacts, not a production release or a business final acceptance.

## 2026-11-06 licence review — reference-only projects (no code imported)

Full review and the actionable checklist: `docs/OPEN-SOURCE-COMPLIANCE.md`. The following projects were studied during the v0.6 architecture work but **no source code, UI component, package or running service from them is included in this repository**. Their licences differ from the MIT/Apache-2.0 upstreams above and must not be treated as interchangeable.

- **LobeHub (`lobehub/lobehub`)** — **LobeHub Community License**: Apache-2.0 *with additional conditions* (GitHub reports `Other`, not OSI open source). It permits commercial use as an unmodified frontend/backend service, but **developing and distributing a derivative work requires a commercial licence from the producer**; contributors also agree the producer may change the licence terms and use contributions commercially. Only its product concepts (role Agents, three-layer reporting, L1–L5 autonomy, attention budget, organisation signals) are studied and re-implemented independently here. No source is copied, forked or bundled.
- **Graphiti (`getzep/graphiti`)** — Apache-2.0. Only the temporal-edge (`valid_at` / `invalid_at`) semantics are borrowed; its graph database and LLM services are not deployed.
- **OpenHands Software Agent SDK** — MIT. Studied for the execution/control-plane boundary only; no second execution service is introduced.
- **Outline** — **BSL 1.1** (source-available, not OSI open source, with production-use restrictions). Permission model studied only; **code import is prohibited** for this integration.
- **Onyx / OpenFGA / LightRAG / KAG** — design references only. The licences of Onyx and OpenFGA have **not been verified in this repository**; they must be verified before any future import.

`src/evidence.ts` ports reference-validation and invalidation-projection logic from the user's own prototypes `ai_bridge.py` / `knowledge.py`, with the user's authorisation; no prototype database, model environment, business data or third-party code was transferred. The Alice research package remains a design reference only (manifest says MIT; the complete licence is unverified, and static recovery is not treated as proof of upstream authorisation).

## node-postgres (`pg`) — MIT（第十六轮 C-1 新增）

Pinned `pg@8.23.1` (runtime) and `@types/pg@8.23.1` (types only), from https://github.com/brianc/node-postgres. Versions are exact in `package.json` and fixed by registry integrity in `package-lock.json`. `Copyright (c) 2010 - 2021 Brian Carlson`; LICENSE retained verbatim in `licenses/pg-MIT.txt`.

Actually reused: the PostgreSQL client driver only, for `src/pg-host.ts` (`PgHostPlatform`) — issues / document revisions / append-only journal, ACL members, cost ledger, heartbeat `checkout / retry / runToken`, and the step queue (`FOR UPDATE SKIP LOCKED`, atomic next-step activation, stale-step recovery) on the dedicated local database `suitme_collab_c1`. No upstream source is copied, modified or bundled.

Preserved boundaries: **no Redis**, **no remote tool sandbox / multi-machine Remote Tool Calling**, and no tool calls sent to AWS or any external host. `assertLocalPgDsn()` accepts loopback addresses only and the DSN is read solely from the `COLLAB_PG_DSN` environment variable (no credentials in `config.json` or the repository). The default host is still `paperclip`; `local-pg` is an explicit opt-in. Production multi-instance scaling and a real remote execution environment have not happened.

This notice is not a legal audit of transitive npm dependencies; each published package retains its own licence.

## Runner (`yicheng47/runner`) — MIT（第二十四轮 P-6 协议语义移植）

Pinned reference commit `a42d133139bbe630e4ca3475426c7653fddd86db`, from https://github.com/yicheng47/runner. `Copyright (c) 2026 Yicheng Wang (Jason Wang)`; LICENSE retained verbatim in `licenses/runner-MIT.txt`. **This is not a submodule**: no gitlink, no upstream worktree and no Rust source file is added to this repository. The fixed commit is recorded in the `protocolReferences` section of `sources.lock.json` (the `sources` map and the seven pinned submodules are unchanged).

Actually reused: two protocol contracts, re-implemented in TypeScript — (1) `ask_human` → `human_question` → `human_response` correlated signals, where the canonical `question_id` is the `human_question` event's own id and causality lives in `payload` (`src/step-hitl.ts`, `src/step-runner.ts`, `scripts/step-answer.ts`); (2) durable-queue cumulative acknowledgement, at-least-once notification and capability-driven delivery readiness (`src/step-delivery.ts`). Four further ideas were borrowed without code: derived mission states, runtime capability declarations, "config store vs append-only coordination log" layering, and no retrospective rewriting of roster snapshots (`src/mission-state.ts`).

Licence history: versions published from 2026-08-22 through 2026-09-22 were released under GPL-3.0-only and remain available under that licence. Only the current MIT `main` commit above is pinned; no release artefact from that window is used.

Preserved boundaries: a `human_response` only returns an answer to the asker — it **never** substitutes for the original initiator's Chinese "确认验收 任务编号" in the originating conversation; the execution process can only raise a question and must never release a `human-gate` step; the HITL ledger is deliberately separate from the B1 memory trunk; no 8th upstream, no PTY/terminal emulator, no external model call and no new web intake entry are introduced.
