# dsh-md-export

<p align="center">
  <strong>把 DeepSeek Harness 的对话导出为干净的 Markdown。</strong><br>
  会话标题栏上的一颗按钮、系统原生保存窗口，以及共用同一渲染核心的命令行。
</p>

<p align="center">
  <a href="https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml"><img src="https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/hoshF/dsh-md-export/releases"><img src="https://img.shields.io/github/v/release/hoshF/dsh-md-export?color=319e8c" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="许可：MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.15-informational" alt="Node 22.15+">
  <img src="https://img.shields.io/badge/DSH-0.2.x-informational" alt="DSH 0.2.x">
  <img src="https://img.shields.io/badge/session%20formats-v0%2Fv3%2Fv4-informational" alt="已验证的会话格式 v0/v3/v4">
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#产出">产出</a> ·
  <a href="#特性">特性</a> ·
  <a href="#用法">用法</a> ·
  <a href="#兼容性">兼容性</a> ·
  <a href="#实现要点">实现要点</a> ·
  <a href="#开发">开发</a><br>
  <a href="README.md">English</a> · 中文 ·
  <a href="docs/FORMAT.md">格式契约</a> ·
  <a href="docs/ARCHITECTURE.md">架构指南</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="CHANGELOG.md">变更日志</a>
</p>

![点按钮，弹保存框，得到 Markdown](docs/demo.gif)

## 安装

### 从 App 安装

1. 在侧边栏打开 **Plugins** → **Add plugin**。
2. 粘贴仓库地址：`https://github.com/hoshF/dsh-md-export`。
3. 重启 DSH，并硬刷新页面（⌘⇧R / Ctrl+Shift+R）。

<details>
<summary>从克隆安装与环境变量</summary>

```sh
git clone https://github.com/hoshF/dsh-md-export.git && cd dsh-md-export
./install.sh
```

`install.sh` 会打包、移除本插件的旧依赖，再用 `pnpm add --force` 安装新 tarball。它保留 profile 的锁文件与其他插件，注册本插件的 bundle，并报告结果。它自动探测 `node` 与 `pnpm`，可用以下变量覆盖：

| 变量 | 默认值 |
|---|---|
| `DSH_HOME` | `~/.dsh` |
| `DSH_PROFILE` | `desktop` |
| `DSH_PROFILE_DIR` | `$DSH_HOME/profiles/$DSH_PROFILE` |
| `DSH_NODE` | 首个找到的 `node`（先 PATH，再 DSH 运行时） |
| `DSH_PNPM` | 首个找到的 `pnpm`（先 PATH，再内置的 `pnpm.mjs`） |

装完需要**重启 DSH**（宿主侧）并**硬刷新**页面（⌘⇧R / Ctrl+Shift+R，客户端侧）。

</details>

<details>
<summary>更新与卸载</summary>

本项目不发布 npm 包。App 安装的是默认分支的内容并解析到具体 commit，所以**更新就是再装一次**：把仓库地址重新粘进 **Plugins → Add plugin**，或再跑一次 `./install.sh`。要固定版本，请从 tag 而不是分支安装。

卸载则是在 **Plugins** 页面移除 `dsh-md-export`，依赖声明与 bundle 注册会一并清除。

</details>

## 产出

点击按钮默认保存对话正文，不含思考与工具记录。下面是默认输出的第一轮问答节选：

<!-- sample:preview:start -->
> **🧑‍💻 User**
>
> **Deploy notes**
>
> - build: `make release`
> - target: `s3://notes-prod`
>
> See https://user-side.example.com/internal for context.
>
> **🤖 Assistant**
>
> Build passes. Recorded the steps above.
<!-- sample:preview:end -->

<details>
<summary>完整默认 Markdown 源码</summary>

<!-- sample:default:start -->
````markdown
## Metadata

- **Model:** `deepseek-flash`
- **Time:** 2026-09-21 07:13:20 -07:00
- **Session:** `session-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d`
- **Workspace:** `/home/you/notes`
- **URL:** http://127.0.0.1:8080

## Conversation

### 🧑‍💻 User

**Deploy notes**

- build: `make release`
- target: `s3://notes-prod`

See https://user-side.example.com/internal for context.

### 🤖 Assistant

Build passes. Recorded the steps above.

### 🧑‍💻 User

What about rollback?

### 🤖 Assistant

Roll back with `make rollback TAG=<previous>`. The checklist is at https://example.com/release-checklist?utm_source=chat.

### References

- [1] [https://example.com/release-checklist](https://example.com/release-checklist)
````
<!-- sample:default:end -->

</details>

<details>
<summary>包含思考与工具调用的样例</summary>

命令行传入 `--tools --reasoning`，或在 HTTP 请求中设置 `tools=1&reasoning=1`，即可包含这些记录。按钮使用默认选项。

```sh
node bin/dsh-md-export.mjs <sessionId> --tools --reasoning --stdout
```

<!-- sample:detailed:start -->
````markdown
## Metadata

- **Model:** `deepseek-flash`
- **Time:** 2026-09-21 07:13:20 -07:00
- **Session:** `session-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d`
- **Workspace:** `/home/you/notes`
- **URL:** http://127.0.0.1:8080

## Conversation

### 🧑‍💻 User

**Deploy notes**

- build: `make release`
- target: `s3://notes-prod`

See https://user-side.example.com/internal for context.

### 🤖 Assistant

#### 🤔 Thought Process

The user wants the deploy steps captured. I should confirm the build passes before writing them down.

#### 💡 Response

Build passes. Recorded the steps above.

<details><summary>Tool calls (1)</summary>

##### 1. `bash`

```json
{"command":"make release","description":"Build the release"}
```

**Result**

```
built 42 files in 6.1s
```

</details>

### 🧑‍💻 User

What about rollback?

### 🤖 Assistant

Roll back with `make rollback TAG=<previous>`. The checklist is at https://example.com/release-checklist?utm_source=chat.

### References

- [1] [https://example.com/release-checklist](https://example.com/release-checklist)
````
<!-- sample:detailed:end -->

</details>

## 特性

- **一次点击，一个文件。** 点击会话标题栏的 **导出 MD**，选择保存位置，就能得到以对话标题命名的 Markdown 文件，例如 `重构解析器.md`。
- **符合约定的 Markdown。** `## Metadata` → `## Conversation` → `### References`，emoji 角色标题、没有 H1，沿用 AfterChat / ChatFormat 的对话导出约定。详见[输出格式](#输出格式)。
- **已验证的会话格式——v0、v3 和 v4**，包括多帧 zstd 日志。
- **命令行与 HTTP 接口。** `bin/dsh-md-export.mjs` 与 `GET /api/md-export` 使用同一个渲染器，便于脚本化。
- **零依赖、无构建步骤。** 只用 Node 内置模块与相对路径文件，App 可以直接从 git 地址安装。
- **本地化反馈。** 文案跟随 App 的语言设置（中/英）；横幅报告保存的文件名或错误。
- **本地日志与文件。** 读取 DSH 宿主的会话日志，将 Markdown 保存到你选定的位置。路由访问规则详见[安全](#安全)。

## 用法

### 界面内

点击会话标题栏的 **导出 MD**，在系统保存窗口中选择位置并保存。按钮文案跟随 App 的语言设置：英文为 `Export MD`，中文为 `导出 MD`。

建议文件名就是对话标题，你可以在保存框里改名；保存完成后的横幅会报告实际写入的文件名。同一时间只运行一次导出。

### 命令行

```sh
node bin/dsh-md-export.mjs                        # 最新的会话
node bin/dsh-md-export.mjs <file|sessionId>       # 指定会话
node bin/dsh-md-export.mjs --list                 # 列出会话
node bin/dsh-md-export.mjs --all -o out.md        # 含工具调用、思考、注入、系统提示词
```

默认写到 `~/dsh-transcripts/<标题>.md`；`--stdout` 则直接打印。
`--list` 列出全部会话。`-o` / `--out` 必须跟输出路径；文件名以 `-` 开头时写成 `./-name.md`。参数无效时会在写文件前报错。

保存为独立笔记时，使用 `--h1` 将会话标题写入正文：

```sh
node bin/dsh-md-export.mjs <sessionId> --h1 -o notes.md
```

### HTTP

```
GET  /api/md-export?sessionId=<id>[&tools=1][&reasoning=1][&injected=1][&system=1][&h1=1]
GET  /api/md-export?meta=1&sessionId=<id>          # 轻量 JSON 元信息
POST /api/md-export   {"sessionId":"…","tools":true,…}
```

响应为 `text/markdown; charset=utf-8`，带 `Content-Disposition` 头（ASCII 回退 + RFC 5987 的 `filename*`），以及一个 `X-Dsh-Filename` 头，供客户端读取真实文件名。

### 输出格式

沿用 AfterChat / ChatFormat 的对话导出约定：

| 规则 | 理由 |
|---|---|
| 没有 H1，文档从 `## Metadata` 开始 | 标题在文件名里。传 `h1=1` 可加 `# Title`。 |
| 元信息用项目符号列表，键加粗、值加反引号 | 便于浏览模型与会话信息。 |
| `### 🧑‍💻 User` / `### 🤖 Assistant`，无轮次编号、无 `---` | 结构由角色标题承担。 |
| 降级代码围栏外的正文标题 | `# 标题` → `**标题**`，保留文档大纲层级。 |
| 保留正文与工具围栏中的空行 | 导出不会压缩代码或工具输出的空白。 |
| 引用来自助手正文与检索结果，按归一化 URL 去重 | 去掉片段、追踪参数与尾斜杠，排除 loopback 地址，按首次出现编号。 |
| 文档标签使用英文 | 界面文案另行本地化。 |

思考（`reasoning=1`）会折叠进同一条助手消息，标为 `#### 🤔 Thought Process` + `#### 💡 Response`。工具调用（`tools=1`）显示在可折叠详情中。两项默认关闭。
裸链接排除句末标点；显式 Markdown 链接目标保留自身标点。两类链接混用时仍按原文首次出现顺序编号。

## 兼容性

| | 兼容情况 |
|---|---|
| DSH | 已验证 **0.2.0-rc.2**，其他版本未验证。 |
| 会话格式 | **v0、v3、v4**——三者都已用真实日志验证。按事件形状解析。 |
| Node 运行时 | **22.15+**。日志格式所需的 `node:zlib` zstd API 在 20 与 21 上不存在。已在 22.15、24、26 上验证。 |
| 宿主 | 桌面 App 与 `web` profile。路由就是普通的 `ctx.webServer` 注册。 |
| 平台 | 核心使用 Node 内置模块；`install.sh` 需要 POSIX `sh`。 |

格式 v1 与 v2 未验证。本插件读取 DSH 内部格式；[`docs/FORMAT.md`](docs/FORMAT.md) 记录预期的事件形状与失败政策。

## 实现要点

宿主查找最新的会话日志，解码 zstd 帧，并将定稿消息渲染为 Markdown。浏览器先刷新建议文件名、打开保存窗口，再请求并写入文档；不支持保存窗口 API 时使用下载。命令行直接调用同一套读取与渲染代码。

模块边界与保存流程见[架构指南](docs/ARCHITECTURE.md)，日志结构与失败政策见[格式契约](docs/FORMAT.md)。

## 安全

路由要求 `Host` 为 loopback 或列在 `trustedHosts` 中；如果请求带有 `Origin`，它必须与请求宿主匹配。带有 `Sec-Fetch-Site: cross-site` 的请求会被拒绝。不符合这些规则的请求返回 403。

## 开发

本包**零依赖、无构建步骤**，所以没有东西需要安装：

```sh
npm test                        # 自足测试——不需要 DSH，不碰会话数据
npm run test:smoke              # 针对最新的真实会话
node test/smoke-real-session.mjs <sessionId>
```

CI 在 Node 22.15、24、26 上运行自足测试，覆盖压缩完整性、Markdown 渲染、HTTP 路由、CLI 子进程和模拟客户端保存交互。先读[架构指南](docs/ARCHITECTURE.md)，了解模块关系、运行边界和修改对应的测试，再看 [CONTRIBUTING.md](CONTRIBUTING.md) 中的开发准备、贡献规则与许可要求。

## 项目结构

| 路径 | 用途 |
|---|---|
| `src/session.js` | 会话枚举与查找（世代号高者胜）、多帧 zstd 解压 |
| `src/render.js` | 事件流 → Markdown（`stripHashes`、引用收集） |
| `src/index.js` | Cordis 宿主插件：注册 `GET/POST /api/md-export` |
| `lib/client.js` | 手写的 DSH loader factory：会话标题栏按钮与保存窗口 |
| `bin/dsh-md-export.mjs` | 共用同一核心的命令行 |
| `cordis.patch.yml` | 把宿主插件行插入 bundle 的补丁 |
| `docs/FORMAT.md` | 我们所依赖的会话日志格式契约 |
| `docs/ARCHITECTURE.md` | 运行边界、导出流程与贡献者修改及测试索引 |
| `test/fixtures.mjs` | 合成会话日志，含刻意构造的多帧布局 |
| `test/*.test.mjs` | 自足测试；修改与测试的对应关系见架构指南 |
| `test/sample.mjs` | 用于验证两份 README 输出样例的合成会话 |
| `test/smoke-real-session.mjs` | 针对真实会话的手工检查 |

## 已知约束

- **宿主侧改动需要重启 DSH，客户端改动需要硬刷新。** 否则已加载的宿主模块与缓存的客户端 bundle 会继续被使用。
- **仅存在于流式分块的内容不会导出。** 定稿消息写入前被中断的步骤，可能缺少部分思考或其他内容。
- **文件是直接读取的，不会先 flush。** 导出正在流式写入的会话，只能拿到最近一次 flush 之前的内容。
- **本项目读的是未公开的内部格式。** 格式变化可能需要更新读取或渲染逻辑。

## 致谢

文档格式——`## Metadata`、emoji 角色标题、`### References`、以标题作文件名——沿用 [AfterChat — LLM Chat Exporter](https://github.com/AfterThink) 及同类对话导出工具推广开来的约定。

## 许可

[MIT](LICENSE)
