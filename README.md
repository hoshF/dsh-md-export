# dsh-md-export

English | [中文](README.zh.md) · [Format contract](docs/FORMAT.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

[![CI](https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml/badge.svg)](https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml)

An **"导出 MD" button in the DSH Web session header** that exports the current
conversation as clean Markdown through a **native save dialog**. It ships as a
self-contained dual-face DSH plugin (host route + client module) plus a CLI that
shares the exact same rendering core.

<!-- Demo assets belong here — they are the single most useful thing in this
     file. Record ~5 seconds of: click the button → OS save dialog → file
     appears. Save it as docs/demo.gif and uncomment:

![Click the button, get a save dialog, get the Markdown](docs/demo.gif)

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

- DSH 0.2.x (desktop app or a `web` profile).
- Node.js **22.15+** — that is where `node:zlib` gained zstd, and DSH session
  logs are zstd-compressed. Node 20 and 21 have no zstd support at all, so the
  plugin cannot read a log there. DSH's bundled runtime qualifies.
- A profile the CLI may manage. Note that the Electron-owned `desktop` profile is
  rejected by `dsh plugin`, which is why `install.sh` drives pnpm directly.

### Support matrix

| | supported |
|---|---|
| DSH | **0.2.0-rc.2** — built and verified against it. Earlier 0.2 prereleases should work; 0.1.x will not (the plugin gate rejects the peer range this would imply, and the session format differs). |
| Session format | **v3 and v4**. v0–v2 use a chunk-row layout with no equivalent of today's message bodies: the export runs, warns, and comes out incomplete. |
| Platforms | Anywhere DSH runs. `install.sh` is POSIX `sh`; nothing is macOS-specific. |
| Node runtime | **22.15+**. The `node:zlib` zstd API the log format needs does not exist in 20 or 21. Verified on 22.15, 24 and 26. |
| Host | Desktop app and `web` profile. The route is a normal `ctx.webServer` registration. |

Compatibility is a moving target: DSH is on a prerelease train and this plugin
reads an internal format. [`docs/FORMAT.md`](docs/FORMAT.md) states exactly what
is depended on, so a break can be diagnosed rather than guessed at.

## Install

Two ways in — the first needs no terminal.

**From the app.** Open **Plugins** in the sidebar → **Add plugin** → paste this
repository's URL → restart DSH. The plugin manager accepts a GitHub address
directly. This works because the package has **no build step**: pnpm blocks
`prepare` scripts for git-hosted dependencies, so a package that needed building
could not be installed this way.

**From a checkout.**

```sh
git clone https://github.com/hoshF/dsh-md-export.git && cd dsh-md-export
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
the client half. See [Known constraints](#known-constraints) for why. Forgetting
the restart is the most common way to end up with a plugin that looks installed
and silently does nothing.

### Updating and uninstalling

There are no npm releases. The app installs whatever the default branch holds,
resolved to a specific commit, so **updating means installing again**: paste the
repository URL into **Plugins → Add plugin** a second time, or re-run
`./install.sh` — it is idempotent and reconciles the profile itself. To pin a
version, install from a tag rather than from the branch.

To remove it, uninstall `dsh-md-export` from the **Plugins** page; that drops
both the dependency and its bundle registration.

## Usage

**In the app.** The button sits in the session header's utilities slot. Clicking
it opens the OS save dialog immediately, then writes the Markdown. The suggested
filename is the conversation title — e.g. `Refactoring the parser.md`.

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
| `src/render.js` | Event stream → Markdown (`stripHashes`, reference collector) |
| `src/index.js` | Cordis host plugin: registers `GET /api/md-export` |
| `lib/client.js` | Client module: session-header button and save dialog |
| `bin/dsh-md-export.mjs` | CLI over the same core |
| `cordis.patch.yml` | Bundle patch that inserts the host plugin row |
| `docs/FORMAT.md` | The session-log format contract we depend on |
| `test/fixtures.mjs` | Synthetic session logs, including a deliberate multi-frame layout |
| `test/render.test.mjs` | Event stream → Markdown behaviour |
| `test/host.test.mjs` | Route tests, including trust-fence cases |
| `test/format.test.mjs` | Pure formatting helpers |
| `test/smoke-real-session.mjs` | Manual check against a real session |

## Development

The package has **zero dependencies and no build step**, so there is nothing to
install:

```sh
npm test                        # hermetic suite — no DSH, no session data
npm run test:smoke              # against the newest real session
node test/smoke-real-session.mjs <sessionId>
```

CI runs `npm test` on Node 20, 22 and 24. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the two hard constraints (no build step, clean-room implementation) before
sending a patch.

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
- **This reads an undocumented internal format.** [`docs/FORMAT.md`](docs/FORMAT.md)
  is the contract, and it is the thing most likely to break.

## Status and scope

This is a **gap-filler**. It exists because DSH has no built-in Markdown export —
the official `@deepseek-ai/dsh-session-log-export` produces a ZIP of JSONL events
for debugging, which is a different product, not a missing feature.

If DSH ships a native readable export, this project should be retired, or
reduced to the CLI. That is not a hypothetical to be defensive about; it is the
intended outcome, and it is why the interface is documented rather than clever.

## Acknowledgements

The document format — `## Metadata`, emoji role headings, `### References`,
title-based filenames — follows the convention popularised by
[AfterChat — LLM Chat Exporter](https://github.com/AfterThink) and comparable
chat exporters. Formats are shared freely; this repository's implementation is
its own (see [CONTRIBUTING.md](CONTRIBUTING.md#hard-constraint-2-clean-room),
which explains why that distinction is load-bearing here).

Thanks also to the DSH plugin authors whose failures and successes made the
compatibility landscape legible: the error messages in
`dsh-session-export`, `dsh-conversation-exporter` and
`@240xu/dsh-message-ops` are what identified the version gate, the format
rewrite, and the multi-frame zstd layout respectively.

## License

[MIT](LICENSE)
