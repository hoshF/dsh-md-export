# dsh-md-export

English | [中文](README.zh.md)

An **"导出 MD" button in the DSH Web session header** that exports the current
conversation as clean Markdown through a **native save dialog**. It ships as a
self-contained dual-face DSH plugin (host route + client module) plus a CLI that
shares the exact same rendering core.

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

- [1] [Some source](https://example.com/source)
```

## Why this exists

Every off-the-shelf DSH export plugin fails on DSH 0.2.x for a different reason:

| Plugin | Problem |
|---|---|
| `dsh-session-export` | Every release declares peer `^0.1.5-rc.3`; DSH 0.2.0-rc.2's compatibility gate refuses it. It also exports a ZIP of JSONL, not Markdown. |
| `dsh-conversation-exporter` | Its parser hard-requires session format **v0** (`expected 0`); current sessions are **v4**, where content no longer arrives as chunk rows. |
| `@240xu/dsh-message-ops` | Exports correctly, but dumps the system prompt and injected context into the document, and its `list` action is broken. |
| built-in `@deepseek-ai/dsh-session-log-export` | Official and already mounted — but it produces a ZIP of JSONL events for debugging, not a readable transcript. |

This plugin sidesteps all four by design: it declares **no `@deepseek-ai/*` peer
dependencies** (so no version gate can reject it) and reads session logs
**directly from disk** instead of through a normalized event shape that drifts
between format versions.

## Requirements

- DSH 0.2.x (desktop app or a `web` profile). Built and verified against
  **0.2.0-rc.2**.
- Node.js 20+ — the runtime DSH already bundles is fine.
- A profile the CLI may manage. Note that the Electron-owned `desktop` profile is
  rejected by `dsh plugin`, which is why `install.sh` drives pnpm directly.

## Install

```sh
git clone <this repo> && cd dsh-md-export
./install.sh
```

`install.sh` packs the package, installs it into the profile, and reports the
resulting dependency and bundle registration. It auto-detects `node` and `pnpm`;
override anything with:

| Variable | Default |
|---|---|
| `DSH_HOME` | `~/.dsh` |
| `DSH_PROFILE` | `desktop` |
| `DSH_PROFILE_DIR` | `$DSH_HOME/profiles/$DSH_PROFILE` |
| `DSH_NODE` | first `node` found (PATH, then the DSH runtime) |
| `DSH_PNPM` | first `pnpm` found (PATH, then the bundled `pnpm.mjs`) |

Then **restart DSH** for the host half, and refresh the page (⌘R / Ctrl+R) for
the client half. See [Known constraints](#known-constraints) for why.

## Usage

**In the app.** The button sits in the session header's utilities slot. Clicking
it opens the OS save dialog immediately, then writes the Markdown. The suggested
filename is the conversation title — e.g. `不拆书高质量扫描设备.md`.

**CLI.**

```sh
node bin/dsh-md-export.mjs                        # newest session
node bin/dsh-md-export.mjs <file|sessionId>       # a specific session
node bin/dsh-md-export.mjs --list                 # list sessions
node bin/dsh-md-export.mjs --all -o out.md        # tool calls, thinking, injected, system
```

Defaults to `~/dsh-transcripts/<title>.md`. `--stdout` prints instead.

**HTTP.**

```
GET  /api/md-export?sessionId=<id>[&tools=1][&reasoning=1][&injected=1][&system=1][&h1=1]
GET  /api/md-export?meta=1&sessionId=<id>          # lightweight JSON metadata
POST /api/md-export   {"sessionId":"…","tools":true,…}
```

The response is `text/markdown; charset=utf-8` with a `Content-Disposition`
header (ASCII fallback plus RFC 5987 `filename*`) and an `X-Dsh-Filename` header
carrying the true filename for the client to read.

## Output format

Follows the AfterChat / ChatFormat conversation-export convention:

| Rule | Rationale |
|---|---|
| No H1 — the document starts at `## Metadata` | The title lives in the filename. Pass `h1=1` to add `# Title`. |
| Metadata as a bullet list, bold keys, backticked values | No table to misalign. |
| `### 🧑‍💻 User` / `### 🤖 Assistant`, no turn numbers, no `---` | Role headings carry the structure. |
| `stripHashes()` on message bodies | `# Heading` → `**Heading**` (fence-aware, absorbing inner `**`), so message content can never outrank the document outline. |
| References deduped by normalized URL, numbered by first appearance | URLs lose their hash, tracking parameters, and trailing slash. Loopback addresses are excluded — they are debugging artifacts, not sources. |

Thinking (`reasoning=1`) folds into the same assistant message as
`#### 🤔 Thought Process` + `#### 💡 Response`. Tool calls (`tools=1`) are an
addition of this plugin; the convention has no equivalent concept.

## How it works

1. **Session logs are multi-frame zstd.** DSH appends one frame per flush, so a
   `.zstd` file routinely holds hundreds of independent frames. Node's
   `zstdDecompressSync` decodes only the first one, and the streaming API throws
   `Unknown frame descriptor` on the second. `src/session.js` scans frame
   boundaries itself and decompresses each frame.
2. **Save dialog first, content second.** `showSaveFilePicker()` requires
   transient user activation. Awaiting a network request first can void it, so
   the client requests the file handle before anything else. When the host lacks
   the API, it falls back to an ordinary download.
3. **The filename must be known before the click.** That is the only reason the
   `meta=1` endpoint exists: the component prefetches the title on mount, and the
   click path retries it if the prefetch has not landed. Both are local requests,
   far inside the 5-second activation window.
4. **No peer dependencies.** The plugin's only imports are Node builtins and
   relative files, so nothing can resolve to a mismatched copy and no
   compatibility gate can object.

## Security

The route mirrors the trust fence DSH Web applies to `/api`: the `Host` must be
loopback or listed in `trustedHosts`, and requests carrying
`Sec-Fetch-Site: cross-site` are rejected. Forged `Host` and cross-site requests
both return 403. The Markdown never leaves the machine.

## Layout

| Path | Purpose |
|---|---|
| `src/session.js` | Session enumeration and lookup (highest generation wins), multi-frame zstd decompression |
| `src/render.js` | Event stream → spec-compliant Markdown (`stripHashes`, reference collector) |
| `src/index.js` | Cordis host plugin: registers `GET /api/md-export` |
| `lib/client.js` | Client module: session-header button and save dialog |
| `bin/dsh-md-export.mjs` | CLI over the same core |
| `cordis.patch.yml` | Bundle patch that inserts the host plugin row |
| `test/host.test.mjs` | Route tests, including trust-fence cases |
| `test/format.test.mjs` | Format helpers (`stripHashes`, `normalizeRefUrl`, `formatRefLine`) |

## Testing

```sh
NODE=$(command -v node)
$NODE test/host.test.mjs <sessionId>   # routes + trust fence
$NODE test/format.test.mjs             # format helpers
```

## Known constraints

- **Host-side changes require a DSH restart.** The app hot-loads a *newly
  installed bundle*, but does not re-import changed file contents for a module it
  has already loaded. The client half only needs a page refresh.
- **Session formats v3 and v4 are supported.** Older chunk-row formats (v0–v2)
  produce a warning and an incomplete export.
- **Files are read directly, not flushed first.** Exporting a session that is
  actively streaming yields everything up to the most recent flush.
- **A live session's title may lag.** The prefetched filename reflects the title
  at mount time.

## License

[MIT](LICENSE)
