# Third-party notices

[Contractor's MIT license](LICENSE) covers its original code. The following distributed source and assets retain their own copyright and license notices.

| Included material | Notice |
| --- | --- |
| DeepSeek Harness Team's Super-agent at `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` | [MIT license](upstream/superagent/LICENSE) |
| 数字生命卡兹克's Agent AutoLoop at `ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d` | [MIT license](upstream/autoloop/LICENSE). Included in source and the compatibility runner. |
| Octop Gateway and Octop Memory | [Gateway MIT license](upstream/octop-gateway/LICENSE) and [Memory MIT license](upstream/octop-memory/LICENSE). Revisions are fixed in [sources.lock.json](sources.lock.json). |
| Two adapted Octop web components at `bf134dbd379036ce7545c7df1a1da7e381ece9ff` | [Original MIT notice](licenses/octop-MIT.txt). The adapted files identify their origins. |
| DeepSeek Schemastery and Cosmokit packages used by Super-agent | [MIT notices](licenses/harness-vendor-MIT.txt). The packages are installed through npm. |
| Ant Design's 4.6.0 icon assets and is-mobile's 5.0.0 bundled module | [Icon notice](licenses/ant-design-icons-MIT.txt) and [is-mobile notice](licenses/is-mobile-MIT.txt). These supplements accompany the compiled web UI. |

## npm and build output

Installed dependencies carry their package licenses. [The workbench lockfile](package-lock.json) records versions, integrity values and declared licenses. Most are MIT. The workbench includes ISC-licensed icon, YAML and Markdown dependencies. The browser build serves `browser-dependency-licenses.txt` and `component-licenses.txt` under `/licenses/`. Keep both files when redistributing the browser build.

TypeScript and Lightning CSS and their platform builds are build tools. The example acceptance workflow installs Playwright separately for running tests. Package source, this notice and the example lock are included in the source archive. The runner has its own notice in each variant.

## Operator-installed integrations

Anthropic Sandbox Runtime, Codex, Claude Code, Entire, platform CLIs and the Python environments for Octop are installed by the operator. The external sandbox installation fixture has its own lockfile. Its Node Forge dependency is used under the BSD-3-Clause alternative. The optional Octop Gateway installation may add provider-specific dependencies, including LGPL-3.0-only `python-telegram-bot` for Telegram. If packaging a deployment with these tools installed, include the applicable upstream notices and fulfill the terms for that environment.

See [the distribution inventory](docs/SOURCES.md) for artifact boundaries and [the official MIT terms](https://opensource.org/license/mit) and [Apache 2.0 terms](https://www.apache.org/licenses/LICENSE-2.0) for the original grants and conditions.
