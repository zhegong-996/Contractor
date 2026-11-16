# Third-party notices

The pinned submodules contain their original source and license files. Adapter locations are listed in [Implementation sources](docs/SOURCES.md).

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

## DeepSeek Harness

Pinned commit: fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159. Original source retained unmodified under upstream/deepseek-harness.

The Super-agent Store uses the pinned `vendor/schemastery` (3.19.0) and `vendor/cosmokit` (1.9.0) sources. These vendored modules remain MIT, Copyright (c) 2021-present Shigma. Their original licenses and `licenses/harness-vendor-MIT.txt` carry the full notices.

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

## Casbin (Apache-2.0)

The workbench uses the published `casbin@5.51.1` package for role-based authorization. The version and integrity are recorded in `package-lock.json`. The license is retained in `licenses/casbin-APACHE-2.0.txt`.

## Paperclip (MIT)

`workbench/src/paperclip/` contains the resizable sidebar, pane-width hook, button, badge, breadcrumb, input, tabs, and the `cn` utility from [Paperclip commit 8cd2d6a](https://github.com/paperclipai/paperclip/tree/8cd2d6a73d2097253dd329f55b637e12b20361c6/ui/src). The files adapt local imports, Radix package imports, and the sidebar resize label. The complete notice is in `licenses/paperclip-MIT.txt` and ships with the workbench bundle.

## Backstage catalog model (Apache-2.0)

The workbench imports `parseEntityRef` and `stringifyEntityRef` from the published `@backstage/catalog-model@1.10.2` package. The package version and integrity are recorded in `package-lock.json`. The source reference is [Backstage `catalog-model/src/entity/ref.ts`](https://github.com/backstage/backstage/blob/40525466a0f70119579cbfc4a60b9d2aa6c8a52d/packages/catalog-model/src/entity/ref.ts). Copyright 2020 The Backstage Authors. The upstream materials are retained in `licenses/backstage-APACHE-2.0.txt` and `licenses/backstage-NOTICE.txt`.

## Figma REST API specification (MIT)

The backend uses generated response types from [`@figma/rest-api-spec@0.47.0`](https://www.npmjs.com/package/@figma/rest-api-spec/v/0.47.0) as a development dependency. The package includes the upstream MIT license, and the locked artifact is recorded in `package-lock.json`. [Upstream license](https://github.com/figma/rest-api-spec/blob/main/LICENSE)

## Entire CLI (MIT)

The workbench invokes an operator-configured Entire CLI for local hooks and its commit-specific JSON metadata exporter. The exercised release was [Entire CLI v0.13.4](https://github.com/entireio/cli/releases/tag/v0.13.4), upstream commit `95eabf579d7aa6e5dbe994a6956c8e3fb44d4465`. Copyright (c) 2026 Entire Inc. The license is retained in `licenses/entire-MIT.txt`. The executable and session data are local runtime files. No Entire binary is committed here.

## LobeHub inbox digest (design reference)

Reviewed the [LobeHub inbox digest service](https://github.com/lobehub/lobehub/blob/a8424d204a7ed1eb36985ebdfa6eac8041615392/apps/server/src/services/agentIdentity/wake/digest.ts) and its delayed flush at commit `a8424d204a7ed1eb36985ebdfa6eac8041615392`, under the LobeHub Community License. SuitMe applied the batching, replay and owner-triage ideas using the existing Super-agent source policy, native AutoLoop scheduler and local project data. No LobeHub source or service is shipped for this feature.

## Acceptance (design reference)

[Acceptance v0.10.0](https://github.com/lobehub/acceptance/tree/f720feb862bdbe3acc653bdedc297e20e08be1ae) informed the local per-case acceptance and version-evidence design. The workbench stores its own acceptance records.

Other npm dependencies retain the license files supplied by their packages.

## Anthropic Sandbox Runtime (Apache-2.0)

The AutoLoop adapter invokes the unmodified CLI from `@anthropic-ai/sandbox-runtime@0.0.83`, maintained at [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime). Version and integrity are pinned in `package-lock.json`; the upstream license is retained in `licenses/sandbox-runtime-APACHE-2.0.txt`. SuitMe supplies the per-execution filesystem and network policy. Its `zod/v3` import is resolved through Zod 4.6.7's compatibility export using a package override; the published runtime source is not patched. See `docs/MEMBER-EXECUTION-ISOLATION.md` for the integration and tested limits.
