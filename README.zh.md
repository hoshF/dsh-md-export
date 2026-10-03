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
  <img src="https://img.shields.io/badge/session%20formats-v0%E2%80%93v4-informational" alt="会话格式 v0–v4">
</p>

<p align="center">
  <a href="#产出">产出</a> ·
  <a href="#特性">特性</a> ·
  <a href="#安装">安装</a> ·
  <a href="#用法">用法</a> ·
  <a href="#兼容性">兼容性</a> ·
  <a href="#实现要点">实现要点</a> ·
  <a href="#开发">开发</a><br>
  <a href="README.md">English</a> · 中文 ·
  <a href="docs/FORMAT.md">格式契约</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="CHANGELOG.md">变更日志</a>
</p>

![点按钮，弹保存框，得到 Markdown](docs/demo.gif)

## 产出

一次对话导出为一个自包含的 Markdown 文件。下面是渲染器输出的**逐字节原样**——没有重打、没有手动折行、没有删减：

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

这段输出里有四处**刻意为之**的细节：

- **`# Deploy notes` 变成了 `**Deploy notes**`。** 正文里的标题会被降级，因此对话内容永远压不过文档大纲。
- **用户自己发的链接没有进 `### References`。** 只有助手正文与检索结果算信源；工具结果里的 loopback 地址同理被排除。
- **`?utm_source=chat` 消失了。** 引用先归一化（去片段、去追踪参数、去尾斜杠）再去重，然后按首次出现编号。
- **思考与工具调用是可选开关**，默认关闭，所以默认导出的就是纯对话本身。

## 特性

- **一次点击，一个文件。** 按钮位于会话标题栏。`showSaveFilePicker()` 在点击的瞬间弹出系统窗口，建议文件名就是对话标题——是 `重构解析器.md`，不是 `export-1738.md`。
- **符合约定的 Markdown。** `## Metadata` → `## Conversation` → `### References`，emoji 角色标题、没有 H1，沿用 AfterChat / ChatFormat 的对话导出约定，既有的导出流水线可以照用。详见[输出格式](#输出格式)。
- **DSH 写过的每一种会话格式——v0 到 v4。** 包括多帧 zstd 容器，而 Node 的一次性解压 API 读不了它。
- **不只是按钮，还有命令行与 HTTP 路由。** `bin/dsh-md-export.mjs` 与 `GET /api/md-export` 跑的是同一个渲染器，便于脚本化。
- **零依赖、无构建步骤。** 只用 Node 内置模块与相对路径文件，因此没有版本闸门能拒绝它，App 也能直接从 git 地址安装。
- **它会告诉你发生了什么。** 文案跟随 App 的语言设置（中/英），保存后弹出横幅写明实际写入的文件名——失败时则显示原因。
- **数据不出本机。** 路由被限制在 loopback，Markdown 只写到本地。详见[安全](#安全)。

## 为什么会有这个项目

现成的 DSH 导出插件在 DSH 0.2.x 上都会因为不同的原因失败：

| 插件 | 问题 |
|---|---|
| `dsh-session-export` | 每个版本都声明 peer `^0.1.5-rc.3`，被 DSH 0.2.0-rc.2 的兼容性闸门拒绝。而且它导出的是 JSONL 的 ZIP，不是 Markdown。 |
| `dsh-conversation-exporter` | 解析器硬性要求会话格式 **v0**（`expected 0`），而当前会话是 **v4**，内容不再以分块行到达。 |
| `@240xu/dsh-message-ops` | 确实能导出，但会把系统提示词和注入上下文一并写进文档，且 `list` 动作是坏的。 |
| 内置的 `@deepseek-ai/dsh-session-log-export` | 官方且已挂载——但它产出的是供调试用的 JSONL 事件 ZIP，不是可读的对话记录。 |

本插件从设计上同时绕开这四点：**不声明任何 `@deepseek-ai/*` peer 依赖**，因此没有兼容性闸门可以拒绝它；并且**直接从磁盘读会话日志**，而不是经由一个会在格式版本间漂移的规范化事件结构。[为什么不用官方接缝？](docs/FORMAT.md#why-sessionquery-is-not-used)

## 安装

两种方式，第一种不需要终端。

### 从 App 安装

侧边栏打开 **Plugins** → **Add plugin** → 粘贴本仓库地址 → 重启 DSH。插件管理器可以直接接受 GitHub 地址。

这条路可行的原因是本包**没有构建步骤**：pnpm 会拦截 git 依赖的 `prepare` 脚本，所以需要构建的包无法用这种方式安装。

### 从克隆安装

```sh
git clone https://github.com/hoshF/dsh-md-export.git && cd dsh-md-export
./install.sh
```

`install.sh` 会打包、装入 profile，并报告最终的依赖声明与 bundle 注册结果。它自动探测 `node` 与 `pnpm`，可用以下变量覆盖：

| 变量 | 默认值 |
|---|---|
| `DSH_HOME` | `~/.dsh` |
| `DSH_PROFILE` | `desktop` |
| `DSH_PROFILE_DIR` | `$DSH_HOME/profiles/$DSH_PROFILE` |
| `DSH_NODE` | 首个找到的 `node`（先 PATH，再 DSH 运行时） |
| `DSH_PNPM` | 首个找到的 `pnpm`（先 PATH，再内置的 `pnpm.mjs`） |

装完需要**重启 DSH**（宿主侧）并**硬刷新**页面（⌘⇧R / Ctrl+Shift+R，客户端侧）。两步都别省，原因见[已知约束](#已知约束)——这是"插件看起来装上了、行为却还是上一版"最常见的两个原因。

### 更新与卸载

本项目不发布 npm 包。App 安装的是默认分支的内容并解析到具体 commit，所以**更新就是再装一次**：把仓库地址重新粘进 **Plugins → Add plugin**，或再跑一次 `./install.sh`（它是幂等的，并会自行校准 profile）。要固定版本，请从 tag 而不是分支安装。

卸载则是在 **Plugins** 页面移除 `dsh-md-export`，依赖声明与 bundle 注册会一并清除。

## 用法

### 界面内

按钮位于会话标题栏的 utilities 插槽。文案跟随 App 的语言设置——英文显示 `Export MD`，中文显示 `导出 MD`；保存完成后弹出横幅，写明实际写入的文件名。点击后**先弹保存框、再取内容**，所以保存框不会等待 I/O。

建议文件名就是对话标题，你可以在保存框里改名；横幅报告的是**真正落盘**的那个名字。

### 命令行

```sh
node bin/dsh-md-export.mjs                        # 最新的会话
node bin/dsh-md-export.mjs <file|sessionId>       # 指定会话
node bin/dsh-md-export.mjs --list                 # 列出会话
node bin/dsh-md-export.mjs --all -o out.md        # 含工具调用、思考、注入、系统提示词
```

默认写到 `~/dsh-transcripts/<标题>.md`；`--stdout` 则直接打印。

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
| 元信息用项目符号列表，键加粗、值加反引号 | 没有表格，就不会错位。 |
| `### 🧑‍💻 User` / `### 🤖 Assistant`，无轮次编号、无 `---` | 结构由角色标题承担。 |
| 正文过 `stripHashes()` | `# 标题` → `**标题**`（围栏感知，并吸收内层 `**`），因此正文永远压不过文档大纲。 |
| 引用按归一化 URL 去重，按首次出现编号 | URL 先去掉片段、追踪参数与尾斜杠。loopback 地址被排除——它们是调试产物，不是信源。 |
| 所有标签都是英文，包括本插件新增的 | 骨架按约定固定为英文，中英混杂是事故而不是特性。界面文案另行本地化。 |

思考（`reasoning=1`）会折叠进同一条助手消息，标为 `#### 🤔 Thought Process` + `#### 💡 Response`。工具调用（`tools=1`）是本插件对 DSH 的补充，该约定里没有对应概念。

## 兼容性

| | 支持情况 |
|---|---|
| DSH | **0.2.0-rc.2**——针对它开发并验证。更早的 0.2 预发布版应当可用；0.1.x 不行（插件闸门会拒绝这对应的 peer 范围，且会话格式不同）。 |
| 会话格式 | **v0、v3、v4**——三者都已用真实日志验证。按行的形状逐个分派，不靠版本号设闸门。 |
| Node 运行时 | **22.15+**。日志格式所需的 `node:zlib` zstd API 在 20 与 21 上不存在。已在 22.15、24、26 上验证。 |
| 宿主 | 桌面 App 与 `web` profile。路由就是普通的 `ctx.webServer` 注册。 |
| 平台 | 任何能跑 DSH 的地方。`install.sh` 是 POSIX `sh`，没有 macOS 专属逻辑。 |

格式 v1 与 v2 存在于 DSH 的编解码链中，但从未出现在开发所用的这台机器上，所以**不宣称**已支持：它们走与 v0 相同的按形状分派路径，而不是经过验证的路径。如果你手上有这类日志且发现异常，欢迎开 issue——那会很有用。

兼容性是个移动靶：DSH 还在预发布列车上，而本插件读的是一个内部格式。[`docs/FORMAT.md`](docs/FORMAT.md) 明确写清依赖了什么，因此一旦损坏可以被诊断，而不是靠猜。

## 实现要点

1. **会话日志是多帧 zstd。** DSH 每次 flush 追加一帧，所以一个 `.zstd` 文件常有数百个独立帧。Node 的 `zstdDecompressSync` 只解第一帧，流式 API 在第二帧抛 `Unknown frame descriptor`。`src/session.js` 自行扫描帧边界并逐帧解压。
2. **定稿行是完整的，所以流式行被忽略。** 老格式另外写了一份逐 token 的细粒度副本（`reasoning-chunks`、`text-chunks`、`tool-call-chunks`）；两套都读会让对话翻倍。实测真实 v0 日志，跳过它们不丢内容。
3. **先弹保存框，再取内容。** `showSaveFilePicker()` 要求瞬时用户激活。先 await 网络请求可能让激活过期，所以客户端先拿到文件句柄，再去取、再写入。宿主没有该 API 时回退为普通下载。
4. **文件名必须在点击前就知道。** 这是 `meta=1` 端点存在的唯一原因。点击时会**重新取一次**（带超时上界），而不是信任挂载时的快照——因为新会话在挂载那一刻还没有标题。
5. **没有 peer 依赖。** 插件的 import 只有 Node 内置模块与相对路径文件，因此不会有任何东西解析到版本不匹配的副本。

## 安全

路由复刻了 DSH Web 对 `/api` 的信任围栏：`Host` 必须是 loopback，或在 `trustedHosts` 中；带有 `Sec-Fetch-Site: cross-site` 的请求会被拒绝。伪造 `Host` 与跨站请求都返回 403。Markdown 从不离开本机。

## 开发

本包**零依赖、无构建步骤**，所以没有东西需要安装：

```sh
npm test                        # 自足测试——不需要 DSH，不碰会话数据
npm run test:smoke              # 针对最新的真实会话
node test/smoke-real-session.mjs <sessionId>
```

CI 在 Node 22.15、24、26 上跑 42 条测试。提交补丁前请先看 [CONTRIBUTING.md](CONTRIBUTING.md) 里的两条硬约束——无构建步骤、净室实现。

## 项目结构

| 路径 | 用途 |
|---|---|
| `src/session.js` | 会话枚举与查找（世代号高者胜）、多帧 zstd 解压 |
| `src/render.js` | 事件流 → Markdown（`stripHashes`、引用收集） |
| `src/index.js` | Cordis 宿主插件：注册 `GET /api/md-export` |
| `lib/client.js` | 客户端模块：会话标题栏按钮与保存窗口 |
| `bin/dsh-md-export.mjs` | 共用同一核心的命令行 |
| `cordis.patch.yml` | 把宿主插件行插入 bundle 的补丁 |
| `docs/FORMAT.md` | 我们所依赖的会话日志格式契约 |
| `test/fixtures.mjs` | 合成会话日志，含刻意构造的多帧布局 |
| `test/render.test.mjs` | 事件流 → Markdown 行为，含 v0 工具结果 |
| `test/host.test.mjs` | 路由测试，含信任围栏用例 |
| `test/format.test.mjs` | 纯格式化辅助函数 |
| `test/sample.mjs` | README 产出样例所依据的那段会话 |
| `test/readme.test.mjs` | 断言已发布的样例与渲染器输出逐字节一致 |
| `test/smoke-real-session.mjs` | 针对真实会话的手工检查 |

## 已知约束

- **宿主侧改动需要重启 DSH。** App 会热加载*新安装的 bundle*，但不会为已经加载过的模块重新 import 变更后的文件内容。客户端那半边需要**硬刷新**（⌘⇧R / Ctrl+Shift+R）——普通刷新可能沿用浏览器缓存的旧 bundle，表现和"改了没生效"一模一样。
- **在定稿前被中断的步骤，会丢失那部分思考。** 内容只存在于流式分块里的步骤——本机实测最大的老格式会话里 178 个中有 2 个——不贡献推理内容。
- **文件是直接读取的，不会先 flush。** 导出正在流式写入的会话，只能拿到最近一次 flush 之前的内容。
- **本项目读的是未公开的内部格式。** [`docs/FORMAT.md`](docs/FORMAT.md) 就是契约，它也是最可能损坏的地方。

## 定位与边界

这是一个**补位项目**。它存在是因为 DSH 没有内置的 Markdown 导出——官方的 `@deepseek-ai/dsh-session-log-export` 产出的是供调试用的 JSONL 事件 ZIP，那是另一类产品，而不是缺失的功能。

如果 DSH 将来提供原生的可读导出，本项目应当退休，或收缩为一个命令行工具。这不是需要防御性声明的假设，而是**预期的结局**；也正因如此，这里把接口写清楚，而不是写得聪明。

## 致谢

文档格式——`## Metadata`、emoji 角色标题、`### References`、以标题作文件名——沿用 [AfterChat — LLM Chat Exporter](https://github.com/AfterThink) 及同类对话导出工具推广开来的约定。格式是自由共享的；本仓库的实现是自己的（见 [CONTRIBUTING.md](CONTRIBUTING.md)，那里解释了为什么这个区分在这里至关重要）。

同样感谢那些插件作者：`dsh-session-export`、`dsh-conversation-exporter` 与 `@240xu/dsh-message-ops` 的报错信息，分别让版本闸门、格式重写与多帧 zstd 布局变得清晰可辨。

## 许可

[MIT](LICENSE)
