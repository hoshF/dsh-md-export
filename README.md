# dsh-md-export

<p align="center">
  <strong>Export DeepSeek Harness conversations as clean Markdown.</strong><br>
  A button in the session header, a native save dialog, and a CLI over the same renderer.
</p>

<p align="center">
  <a href="https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml"><img src="https://github.com/hoshF/dsh-md-export/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/hoshF/dsh-md-export/releases"><img src="https://img.shields.io/github/v/release/hoshF/dsh-md-export?color=319e8c" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.15-informational" alt="Node 22.15+">
  <img src="https://img.shields.io/badge/DSH-0.2.x-informational" alt="DSH 0.2.x">
  <img src="https://img.shields.io/badge/session%20formats-v0%E2%80%93v4-informational" alt="Session formats v0-v4">
</p>

<p align="center">
  <a href="#output">Output</a> ·
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#compatibility">Compatibility</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a><br>
  English · <a href="README.zh.md">中文</a> ·
  <a href="docs/FORMAT.md">Format contract</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

![Click the button, get a save dialog, get the Markdown](docs/demo.gif)

## Output

A conversation exports as one self-contained Markdown file. This is real output
from the renderer, only shortened:

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

The user wants the deploy steps captured. I should confirm the build passes
before writing them down.

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

Roll back with `make rollback TAG=<previous>`. The checklist is at
https://example.com/release-checklist?utm_source=chat.

### References

- [1] [https://example.com/release-checklist](https://example.com/release-checklist)
````

Four things that sample is quietly demonstrating:

- **`# Deploy notes` became `**Deploy notes**`.** Message bodies are demoted so
  content can never outrank the document outline.
- **The user's own URL never reached `### References`.** Only the assistant's
  prose and search results are sources; the loopback address in a tool result was
  excluded for the same reason.
- **`?utm_source=chat` is gone.** References are deduplicated after normalisation
  — tracking parameters, fragments and trailing slashes are stripped — then
  numbered by first appearance.
- **Thinking and tool calls are opt-in**, off by default, so the plain export is
  just the conversation. Turn them on per export (`--all`, `tools=1`).

## Features

- **One click, one file.** The button lives in the session header. `showSaveFilePicker()`
  opens the OS dialog on the click itself, and the suggested filename is the
  conversation title — `Refactoring the parser.md`, not `export-1738.md`.
- **Conventional Markdown.** `## Metadata` → `## Conversation` → `### References`
  with emoji role headings and no H1, following the AfterChat / ChatFormat
  convention so existing export pipelines keep working. See
  [Output format](#output-format).
- **Every session format DSH has written — v0 through v4.** That includes the
  multi-frame zstd container, which Node's one-shot decompressor cannot read.
- **A CLI and an HTTP route, not just a button.** `bin/dsh-md-export.mjs` and
  `GET /api/md-export` run the same renderer, for scripting and for the UI.
- **Zero dependencies, no build step.** Node builtins and relative files only, so
  no version gate can reject it and the app can install it straight from a git URL.
- **It tells you what happened.** Copy follows the app's language setting (English
  and Chinese), and a toast names the file that was written — or carries the
  reason it failed.
- **Nothing leaves the machine.** The route is fenced to loopback and the
  Markdown is written locally. See [Security](#security).

## Why this exists

Every off-the-shelf DSH export plugin fails on DSH 0.2.x for a different reason:

| Plugin | Problem |
|---|---|
| `dsh-session-export` | Every release declares peer `^0.1.5-rc.3`; DSH 0.2.0-rc.2's compatibility gate refuses it. It also exports a ZIP of JSONL, not Markdown. |
| `dsh-conversation-exporter` | Its parser hard-requires session format **v0** (`expected 0`); current sessions are **v4**, where content no longer arrives as chunk rows. |
| `@240xu/dsh-message-ops` | Exports correctly, but dumps the system prompt and injected context into the document, and its `list` action is broken. |
| built-in `@deepseek-ai/dsh-session-log-export` | Official and already mounted — but it produces a ZIP of JSONL events for debugging, not a readable transcript. |

This plugin sidesteps all four by design: it declares **no `@deepseek-ai/*` peer
dependencies**, so no compatibility gate can object, and it reads session logs
**directly from disk** rather than through a normalised event shape that drifts
between format versions. [Why not use the official seam?](docs/FORMAT.md#why-sessionquery-is-not-used)

## Install

Two ways in. The first needs no terminal.

### From the app

Open **Plugins** in the sidebar → **Add plugin** → paste this repository's URL →
restart DSH. The plugin manager accepts a GitHub address directly.

This works because the package has **no build step**: pnpm blocks `prepare`
scripts for git-hosted dependencies, so a package that needed building could not
be installed this way.

### From a checkout

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

Then **restart DSH** for the host half, and **hard-refresh** the page
(⌘⇧R / Ctrl+Shift+R) for the client half. Do not skip either step — see
[Known constraints](#known-constraints). They are the two most common ways to end
up with a plugin that looks installed and behaves like the previous version.

### Updating and uninstalling

There are no npm releases. The app installs whatever the default branch holds,
resolved to a specific commit, so **updating means installing again**: paste the
repository URL into **Plugins → Add plugin** a second time, or re-run
`./install.sh` — it is idempotent and reconciles the profile itself. To pin a
version, install from a tag rather than from the branch.

To remove it, uninstall `dsh-md-export` from the **Plugins** page; that drops both
the dependency and its bundle registration.

## Usage

### In the app

The button sits in the session header's utilities slot. Its label follows the
app's language setting — `Export MD` in English, `导出 MD` in Chinese — and a toast
afterwards names the file that was written. Clicking opens the save dialog first
and fetches the content second, so the dialog never waits on I/O.

The suggestion is the conversation title. You can rename it in the dialog; the
toast reports the name that actually landed on disk.

### CLI

```sh
node bin/dsh-md-export.mjs                        # newest session
node bin/dsh-md-export.mjs <file|sessionId>       # a specific session
node bin/dsh-md-export.mjs --list                 # list sessions
node bin/dsh-md-export.mjs --all -o out.md        # tool calls, thinking, injected, system
```

Defaults to `~/dsh-transcripts/<title>.md`. `--stdout` prints instead.

### HTTP

```
GET  /api/md-export?sessionId=<id>[&tools=1][&reasoning=1][&injected=1][&system=1][&h1=1]
GET  /api/md-export?meta=1&sessionId=<id>          # lightweight JSON metadata
POST /api/md-export   {"sessionId":"…","tools":true,…}
```

The response is `text/markdown; charset=utf-8` with a `Content-Disposition`
header (ASCII fallback plus RFC 5987 `filename*`) and an `X-Dsh-Filename` header
carrying the true filename for the client to read.

### Output format

Follows the AfterChat / ChatFormat conversation-export convention:

| Rule | Rationale |
|---|---|
| No H1 — the document starts at `## Metadata` | The title lives in the filename. Pass `h1=1` to add `# Title`. |
| Metadata as a bullet list, bold keys, backticked values | No table to misalign. |
| `### 🧑‍💻 User` / `### 🤖 Assistant`, no turn numbers, no `---` | Role headings carry the structure. |
| `stripHashes()` on message bodies | `# Heading` → `**Heading**` (fence-aware, absorbing inner `**`), so message content can never outrank the document outline. |
| References deduped by normalised URL, numbered by first appearance | URLs lose their fragment, tracking parameters and trailing slash. Loopback addresses are excluded — they are debugging artifacts, not sources. |
| Every label is English, including the ones this plugin adds | The skeleton is fixed English by convention, so a mixed-language document would be an accident, not a feature. UI copy is localised separately. |

Thinking (`reasoning=1`) folds into the same assistant message as
`#### 🤔 Thought Process` + `#### 💡 Response`. Tool calls (`tools=1`) are an
addition of this plugin; the convention has no equivalent concept.

## Compatibility

| | Supported |
|---|---|
| DSH | **0.2.0-rc.2** — built and verified against it. Earlier 0.2 prereleases should work; 0.1.x will not (the plugin gate rejects the peer range this would imply, and the session format differs). |
| Session format | **v0, v3 and v4** — every layout DSH has written. Row shapes are dispatched individually rather than gated on a version number. |
| Node runtime | **22.15+**. The `node:zlib` zstd API the log format needs does not exist in 20 or 21. Verified on 22.15, 24 and 26. |
| Host | Desktop app and `web` profile. The route is a normal `ctx.webServer` registration. |
| Platforms | Anywhere DSH runs. `install.sh` is POSIX `sh`; nothing is macOS-specific. |

Compatibility is a moving target: DSH is on a prerelease train and this plugin
reads an internal format. [`docs/FORMAT.md`](docs/FORMAT.md) states exactly what
is depended on, so a break can be diagnosed rather than guessed at.

## How it works

1. **Session logs are multi-frame zstd.** DSH appends one frame per flush, so a
   `.zstd` file routinely holds hundreds of independent frames. Node's
   `zstdDecompressSync` decodes only the first one, and the streaming API throws
   `Unknown frame descriptor` on the second. `src/session.js` scans frame
   boundaries itself and decompresses each frame.
2. **The finalised rows are complete, so the streaming ones are ignored.** Old
   formats also wrote a fine-grained copy of every token (`reasoning-chunks`,
   `text-chunks`, `tool-call-chunks`); reading both would double the transcript.
   Measured against real v0 logs, nothing is lost by skipping them.
3. **Save dialog first, content second.** `showSaveFilePicker()` requires
   transient user activation. Awaiting a network request first can void it, so the
   client takes the file handle before anything else — then fetches, then writes.
   When the host lacks the API it falls back to an ordinary download.
4. **The filename must be known before the click.** That is the only reason the
   `meta=1` endpoint exists. The click refetches it (bounded by a timeout) rather
   than trusting a snapshot taken at mount, because a new conversation has no
   title yet at that point.
5. **No peer dependencies.** The plugin's only imports are Node builtins and
   relative files, so nothing can resolve to a mismatched copy.

## Security

The route mirrors the trust fence DSH Web applies to `/api`: the `Host` must be
loopback or listed in `trustedHosts`, and requests carrying
`Sec-Fetch-Site: cross-site` are rejected. Forged `Host` and cross-site requests
both return 403. The Markdown never leaves the machine.

## Development

The package has **zero dependencies and no build step**, so there is nothing to
install:

```sh
npm test                        # hermetic suite — no DSH, no session data
npm run test:smoke              # against the newest real session
node test/smoke-real-session.mjs <sessionId>
```

40 tests run on Node 22.15, 24 and 26 in CI. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the two hard constraints — no build step,
clean-room implementation — before sending a patch.

## Project layout

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
| `test/render.test.mjs` | Event stream → Markdown behaviour, including v0 tool results |
| `test/host.test.mjs` | Route tests, including trust-fence cases |
| `test/format.test.mjs` | Pure formatting helpers |
| `test/smoke-real-session.mjs` | Manual check against a real session |

## Known constraints

- **Host-side changes require a DSH restart.** The app hot-loads a *newly
  installed bundle*, but does not re-import changed file contents for a module it
  has already loaded. The client half needs a **hard** refresh (⌘⇧R /
  Ctrl+Shift+R) — an ordinary reload can serve the bundle the browser cached from
  the previous version, which looks exactly like "my change did nothing".
- **Steps interrupted before they finalise lose their partial thinking.** A step
  whose content exists only as streaming chunks — 2 out of 178 in the largest
  old-format session measured here — contributes no reasoning.
- **Files are read directly, not flushed first.** Exporting a session that is
  actively streaming yields everything up to the most recent flush.
- **This reads an undocumented internal format.**
  [`docs/FORMAT.md`](docs/FORMAT.md) is the contract, and it is the thing most
  likely to break.

## Status and scope

This is a **gap-filler**. It exists because DSH has no built-in Markdown export —
the official `@deepseek-ai/dsh-session-log-export` produces a ZIP of JSONL events
for debugging, which is a different product, not a missing feature.

If DSH ships a native readable export, this project should be retired, or reduced
to the CLI. That is not a hypothetical to be defensive about; it is the intended
outcome, and it is why the interface is documented rather than clever.

## Acknowledgements

The document format — `## Metadata`, emoji role headings, `### References`,
title-based filenames — follows the convention popularised by
[AfterChat — LLM Chat Exporter](https://github.com/AfterThink) and comparable chat
exporters. Formats are shared freely; this repository's implementation is its own
(see [CONTRIBUTING.md](CONTRIBUTING.md), which explains why that distinction is
load-bearing here).

Thanks also to the DSH plugin authors whose failures and successes made the
compatibility landscape legible: the error messages in `dsh-session-export`,
`dsh-conversation-exporter` and `@240xu/dsh-message-ops` are what identified the
version gate, the format rewrite, and the multi-frame zstd layout respectively.

## License

[MIT](LICENSE)
