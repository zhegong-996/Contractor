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
