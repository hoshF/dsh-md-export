# dsh-md-export

[English](README.md) | 中文

DSH Web 会话标题栏上的一颗 **「导出 MD」按钮**：点击后弹出**系统原生保存窗口**，
把当前会话导出为干净可读的 Markdown。它以自包含的**双面插件**形式交付（宿主路由 +
客户端模块），另附一个与界面按钮**共用同一渲染核心**的命令行工具。

```markdown
## Metadata

- **Model:** `deepseek-flash`
- **Time:** 2026-10-03 00:08:43 -07:00
- **Session:** `session-1357ec0e-f8da-4ac9-9cfa-0df8f24d48f2`
- **Workspace:** `/Users/hoshf`
- **URL:** http://127.0.0.1:19387

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

- DSH 0.2.x（桌面 App 或 `web` profile）。构建与验证基于 **0.2.0-rc.2**。
- Node.js 20+ —— DSH 自带的运行时即可。
- 一个 CLI 可管理的 profile。注意 Electron 独占的 `desktop` profile 会被
  `dsh plugin` 拒绝，所以 `install.sh` 直接驱动 pnpm。

## 安装

```sh
git clone <本仓库> && cd dsh-md-export
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
[已知约束](#已知约束)。

## 用法

**界面内。** 按钮位于会话标题栏的 utilities 插槽。点击后**立刻弹出系统保存框**，
随后写入 Markdown。建议文件名即对话标题，例如 `不拆书高质量扫描设备.md`。

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
| `src/render.js` | 事件流 → 规范格式 Markdown（`stripHashes`、引用收集器） |
| `src/index.js` | Cordis 宿主插件：注册 `GET /api/md-export` |
| `lib/client.js` | 客户端模块：会话标题栏按钮与保存框 |
| `bin/dsh-md-export.mjs` | 共用同一核心的命令行工具 |
| `cordis.patch.yml` | 插入宿主插件行的 bundle patch |
| `test/host.test.mjs` | 路由测试，含信任围栏用例 |
| `test/format.test.mjs` | 格式工具单测（`stripHashes` / `normalizeRefUrl` / `formatRefLine`） |

## 测试

```sh
NODE=$(command -v node)
$NODE test/host.test.mjs <sessionId>   # 路由 + 信任围栏
$NODE test/format.test.mjs             # 格式工具
```

## 已知约束

- **改宿主侧代码必须重启 DSH。** App 会对*新安装的 bundle* 热加载，但不会为已加载
  的模块重新 import 变更后的文件内容。客户端那半边只需刷新页面。
- **支持会话格式 v3 / v4。** 更早的 chunk 行格式（v0–v2）会给出警告，导出不完整。
- **直接读文件，不先 flush。** 导出正在流式写入的会话，得到的是最近一次 flush 之前的
  全部内容。
- **活跃会话的标题可能滞后。** 预取到的文件名反映的是组件挂载时的标题。

## 许可

[MIT](LICENSE)
