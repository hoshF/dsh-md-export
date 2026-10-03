# dsh-md-export

[English](README.md) | 中文 · [格式契约](docs/FORMAT.md) · [贡献指南](CONTRIBUTING.md) · [变更日志](CHANGELOG.md)

[![CI](https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml/badge.svg)](https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml)

DSH Web 会话标题栏上的一颗 **「导出 MD」按钮**：点击后弹出**系统原生保存窗口**，
把当前会话导出为干净可读的 Markdown。它以自包含的**双面插件**形式交付（宿主路由 +
客户端模块），另附一个与界面按钮**共用同一渲染核心**的命令行工具。

<!-- 演示素材的位置在这里——它是整个 README 里最有说服力的一项。
     录约 5 秒：点按钮 → 弹出系统保存框 → 文件落盘。
     存成 docs/demo.gif 后取消下面的注释：

![点按钮，弹保存框，得到 Markdown](docs/demo.gif)

-->

```markdown
## Metadata

- **Model:** `deepseek-flash`
- **Time:** 2026-10-03 00:08:43 -07:00
- **Session:** `session-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d`
- **Workspace:** `/home/you/notes`
- **URL:** http://127.0.0.1:8080

## Conversation

### 🧑‍💻 User

…

### 🤖 Assistant

…

### References

- [1] [某个信源](https://example.com/source)
```

## 为什么需要自己写一个

现成的 DSH 导出插件在 0.2.x 上各自栽在不同的地方：

| 插件 | 问题 |
|---|---|
| `dsh-session-export` | 每个版本都声明 peer `^0.1.5-rc.3`，被 DSH 0.2.0-rc.2 的兼容性闸门拒绝；而且它导出的是 JSONL 的 ZIP，不是 Markdown。 |
| `dsh-conversation-exporter` | 解析器硬要求会话格式 **v0**（`expected 0`），而当前会话是 **v4**——内容不再以 chunk 行承载。 |
| `@240xu/dsh-message-ops` | 确实能导出，但会把系统提示词和注入上下文一并写进文档，且 `list` 动作是坏的。 |
| 内置 `@deepseek-ai/dsh-session-log-export` | 官方且已挂载——但它产出的是用于调试的 JSONL 事件 ZIP，不是可读的对话记录。 |

本插件在设计上同时绕开这四个坑：**不声明任何 `@deepseek-ai/*` peer 依赖**（因此
没有版本闸门能拒绝它），并且**直接读会话日志文件**，而不是经过一个会随格式版本漂移的
规范化事件形状。

## 环境要求

- DSH 0.2.x（桌面 App 或 `web` profile）。
- Node.js **22.15+** —— `node:zlib` 是在这个版本才有 zstd 的，而 DSH 的会话日志
  是 zstd 压缩的。Node 20 与 21 完全没有 zstd 支持，插件在那上面读不出任何日志。
  DSH 自带的运行时满足要求。
- 一个 CLI 可管理的 profile。注意 Electron 独占的 `desktop` profile 会被
  `dsh plugin` 拒绝，所以 `install.sh` 直接驱动 pnpm。

### 支持矩阵

| | 支持情况 |
|---|---|
| DSH | **0.2.0-rc.2** —— 构建与验证基于它。更早的 0.2 预发布版应该可用；0.1.x 不行（那意味着另一套 peer 范围，会被插件闸门拒绝，且会话格式不同）。 |
| 会话格式 | **v3 与 v4**。v0–v2 是 chunk 行布局，没有今天这种消息体：导出会执行、给出警告，但内容不完整。 |
| 平台 | 任何能跑 DSH 的地方。`install.sh` 是 POSIX `sh`，没有 macOS 专属逻辑。 |
| Node 运行时 | **22.15+**。日志格式需要的 `node:zlib` zstd API 在 20 与 21 上不存在。已在 22.15 / 24 / 26 上验证。 |
| 宿主 | 桌面 App 与 `web` profile 均可。路由就是一次普通的 `ctx.webServer` 注册。 |

兼容性是个移动靶：DSH 在预发布列车上，而本插件读的是内部格式。
[`docs/FORMAT.md`](docs/FORMAT.md) 明确写清了我们依赖什么，因此出问题时是**可诊断**而不是靠猜。

## 安装

两条路，第一条不需要终端。

**在 App 里装。** 侧边栏打开 **插件** → **添加插件** → 粘贴本仓库地址 → 重启 DSH。
插件管理器直接接受 GitHub 地址。这条路能走通，是因为本包**没有构建步骤**：
pnpm 会拦截 git 托管依赖的 `prepare` 脚本，所以任何需要构建的包都无法这样安装。

**从源码装。**

```sh
git clone https://github.com/hoshF/dsh-md-export.git && cd dsh-md-export
./install.sh
```

`install.sh` 会打包、装进 profile，并打印最终的依赖与 bundle 注册状态。它自动探测
`node` 与 `pnpm`，以下环境变量可覆盖：

| 变量 | 默认值 |
|---|---|
| `DSH_HOME` | `~/.dsh` |
| `DSH_PROFILE` | `desktop` |
| `DSH_PROFILE_DIR` | `$DSH_HOME/profiles/$DSH_PROFILE` |
| `DSH_NODE` | 依次在 PATH、DSH 运行时中找第一个 `node` |
| `DSH_PNPM` | 依次在 PATH、DSH 自带 `pnpm.mjs` 中找第一个 `pnpm` |

装完需要**重启 DSH**（宿主侧）并刷新页面（⌘R / Ctrl+R，客户端侧）。原因见
[已知约束](#已知约束)。**忘记重启**是"插件看起来装上了、其实什么也不做"最常见的原因。

### 更新与卸载

本仓库没有发布到 npm。App 安装的是默认分支上的内容，并解析到具体某个 commit，
所以**更新就等于再装一次**：把仓库地址再粘进 **插件 → 添加插件** 一次，或者重跑
`./install.sh`（它是幂等的，并且会自己完成 profile 侧的注册）。想锁定版本，就从 tag
而不是分支安装。

卸载则是在 **插件** 页面里卸载 `dsh-md-export`——它会同时清掉依赖与 bundle 注册。

## 用法

**界面内。** 按钮位于会话标题栏的 utilities 插槽。点击后**立刻弹出系统保存框**，
随后写入 Markdown。建议文件名即对话标题，例如 `重构解析器.md`。

**命令行。**

```sh
node bin/dsh-md-export.mjs                        # 最近一次会话
node bin/dsh-md-export.mjs <文件|会话ID>           # 指定会话
node bin/dsh-md-export.mjs --list                 # 列出会话
node bin/dsh-md-export.mjs --all -o out.md        # 含工具调用、思考、注入、系统提示词
```

默认写入 `~/dsh-transcripts/<标题>.md`；`--stdout` 改为打印到标准输出。

**HTTP。**

```
GET  /api/md-export?sessionId=<id>[&tools=1][&reasoning=1][&injected=1][&system=1][&h1=1]
GET  /api/md-export?meta=1&sessionId=<id>          # 轻量 JSON 元信息
POST /api/md-export   {"sessionId":"…","tools":true,…}
```

响应为 `text/markdown; charset=utf-8`，带 `Content-Disposition`（ASCII 回退名 +
RFC 5987 的 `filename*`）以及供客户端读取真实文件名的 `X-Dsh-Filename`。

## 输出格式

对齐 AfterChat / ChatFormat 的对话导出规范：

| 规则 | 理由 |
|---|---|
| 无 H1，文档从 `## Metadata` 起 | 标题只进文件名。传 `h1=1` 可加一行 `# 标题`。 |
| 元信息用项目符号列表 + 粗体键 + 反引号值 | 不用表格，也就不会错位。 |
| `### 🧑‍💻 User` / `### 🤖 Assistant`，无轮次号、无 `---` | 结构由角色标题承载。 |
| 正文过 `stripHashes()` | `# 标题` → `**标题**`（围栏感知、吸收内部 `**`），正文永远压不过文档大纲。 |
| 引用按归一化 URL 去重、按首次出现编号 | URL 去 hash、去 tracking 参数、去尾斜杠。本机回环地址被排除——那是调试痕迹，不是信源。 |

思考过程（`reasoning=1`）按规范融进同一条助手消息：`#### 🤔 Thought Process` +
`#### 💡 Response`。工具调用（`tools=1`）是本插件对 DSH 的补充，规范里没有对应概念。

## 实现要点

1. **会话日志是多帧拼接的 zstd。** DSH 每次 flush 追加一帧，一个 `.zstd` 文件常有
   数百个独立帧。Node 的 `zstdDecompressSync` 只解第一帧，流式 API 遇到第二帧会抛
   `Unknown frame descriptor`。`src/session.js` 自行扫描帧边界逐帧解压。
2. **先弹保存框、再取内容。** `showSaveFilePicker()` 要求瞬时用户激活，先 `await`
   网络请求可能使其失效，因此客户端第一件事就是取文件句柄。宿主不支持该 API 时回退为
   普通下载。
3. **文件名必须在点击前就已知。** 这正是 `meta=1` 接口存在的唯一理由：组件挂载时
   预取标题，点击路径在预取未命中时再补一次。两者都是本地请求，远在 5 秒激活窗口内。
4. **无 peer 依赖。** 插件的 import 只有 Node 内置模块和相对路径，因此不可能解析到
   版本错配的副本，也没有兼容性闸门可以拒绝它。

## 安全

路由复刻了 DSH Web 对 `/api` 的信任围栏：`Host` 必须是回环地址，或列在
`trustedHosts` 中；带 `Sec-Fetch-Site: cross-site` 的请求一律拒绝。伪造 `Host` 与
跨站请求都返回 403。Markdown 不会离开本机。

## 目录结构

| 路径 | 作用 |
|---|---|
| `src/session.js` | 会话枚举与定位（同目录多代取最高代）、多帧 zstd 解压 |
| `src/render.js` | 事件流 → Markdown（`stripHashes`、引用收集器） |
| `src/index.js` | Cordis 宿主插件：注册 `GET /api/md-export` |
| `lib/client.js` | 客户端模块：会话标题栏按钮与保存框 |
| `bin/dsh-md-export.mjs` | 共用同一核心的命令行工具 |
| `cordis.patch.yml` | 插入宿主插件行的 bundle patch |
| `docs/FORMAT.md` | 我们依赖的会话日志格式契约 |
| `test/fixtures.mjs` | 合成会话日志，含刻意构造的多帧布局 |
| `test/render.test.mjs` | 事件流 → Markdown 的行为测试 |
| `test/host.test.mjs` | 路由测试，含信任围栏用例 |
| `test/format.test.mjs` | 纯格式工具单测 |
| `test/smoke-real-session.mjs` | 针对真实会话的手动冒烟 |

## 开发

本包**零依赖、无构建步骤**，因此没有任何东西需要安装：

```sh
npm test                        # 密闭测试套件——不需要 DSH，不碰任何会话数据
npm run test:smoke              # 针对最近一次真实会话
node test/smoke-real-session.mjs <会话ID>
```

CI 在 Node 20 / 22 / 24 上跑 `npm test`。提 PR 之前请先看
[CONTRIBUTING.md](CONTRIBUTING.md) 里的两条硬约束（无构建步骤、清洁室实现）。

## 已知约束

- **改宿主侧代码必须重启 DSH。** App 会对*新安装的 bundle* 热加载，但不会为已加载
  的模块重新 import 变更后的文件内容。客户端那半边只需刷新页面。
- **支持会话格式 v3 / v4。** 更早的 chunk 行格式（v0–v2）会给出警告，导出不完整。
- **直接读文件，不先 flush。** 导出正在流式写入的会话，得到的是最近一次 flush 之前的
  全部内容。
- **活跃会话的标题可能滞后。** 预取到的文件名反映的是组件挂载时的标题。
- **读的是未公开的内部格式。** [`docs/FORMAT.md`](docs/FORMAT.md) 就是那份契约，也是
  最可能先坏掉的地方。

## 定位与边界

这是一个**补位项目**。它存在，是因为 DSH 没有内置的 Markdown 导出——官方那个
`@deepseek-ai/dsh-session-log-export` 产出的是用于调试的 JSONL 事件 ZIP，
那是另一个产品，不是缺了一半的功能。

如果 DSH 将来提供了原生可读导出，**这个项目就应该退役**，或收缩为命令行工具。
这不是一句需要自我辩护的假设，而是它本来的预期结局——这也是为什么这里把接口写清楚
而不是写得聪明。

## 致谢

文档格式——`## Metadata`、emoji 角色标题、`### References`、以标题作文件名——沿用了
[AfterChat — LLM Chat Exporter](https://github.com/AfterThink) 及同类导出器普及开来的
约定。格式是共享的；本仓库的实现是自己的（原因见
[CONTRIBUTING.md](CONTRIBUTING.md#hard-constraint-2-clean-room)——在这个项目里，这条界线
是承重的）。

同时感谢那些插件作者：正是 `dsh-session-export`、`dsh-conversation-exporter` 和
`@240xu/dsh-message-ops` 各自的报错，才让这里的兼容性地形变得清晰可辨——它们分别暴露了
版本闸门、格式重写和多帧 zstd 布局。

## 许可

[MIT](LICENSE)
