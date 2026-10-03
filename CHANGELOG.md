# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to the versioning policy below.

## Versioning policy

This project's version numbers mean something specific, because its main risk is
not its own API but DSH's internal session format:

| bump | means |
|---|---|
| **major** | requires a newer DSH, **or** drops support for a session format that previously worked |
| **minor** | new capability: a new flag, metadata field, endpoint, or document section |
| **patch** | fixes that do not change the shape of the output |

A change to the *rendered Markdown structure* is at least a minor bump, since
downstream tooling may parse it.

## [Unreleased]

## [1.3.1]

Housekeeping pass over dead code, hardcoded values, and the repository's own
environment leakage.

### Fixed

- **`collectLinks` used a 400-character proximity window** to guess whether a
  bare URL was already part of a `[label](url)` link. Long labels and several
  links in one paragraph were misjudged, so a URL could be counted twice or
  missed entirely. Link spans are now masked out exactly before scanning for
  bare URLs, and the heuristic is gone.

### Changed

- Magic numbers replaced with named constants: the filename stem cap, the
  short-id length, the markdown label cap, and the client's "saved" state
  duration.
- The fallback filename is built by one shared function
  (`fallbackMarkdownFilename`) instead of being spelled out in `src/render.js`
  and again in `src/index.js`. The client's copy cannot be shared, and now says
  why it mirrors the host.
- Both sides of the duplicated route path point at each other, since a browser
  module cannot import host ESM and a change has to be made in two places.
- Removed the unused `writeSessionHome` fixture helper.

### Removed

- Real session identifiers, workspace paths, port numbers and conversation
  titles that had leaked into the READMEs, the changelog and the tests from the
  machine this was developed on. Every example is synthetic now.

## [1.3.0]

Clean-room rewrite, a real test suite, and the project scaffolding needed to
publish it.

### Changed

- **Rewrote the formatting helpers as an independent implementation.**
  `stripHashes`, `normalizeRefUrl`, `formatRefLine`, `formatLocalTime` and the
  reference collector were previously written with the AfterChat userscript open;
  that project is **AGPL-3.0**, which is incompatible with distributing this one
  under MIT. The document *format* is shared and credited; the code is now our
  own. The attribution parameter list was re-derived from the stated criterion
  ("this parameter exists only to mark a source") rather than copied.
- Fenced-code detection now follows CommonMark more closely: a fence closes only
  on the same character at equal or greater length.

### Fixed

- **Tool call names were only recorded when `tools` was enabled**, so
  `web_search` / `web_fetch` sources were silently missing from References in
  the default export.

### Added

- `test/fixtures.mjs` — synthetic session logs, generated rather than committed
  as opaque binaries, including a deliberate multi-frame layout.
- `test/render.test.mjs` — event stream → Markdown, including the case that
  catches single-frame decoding (`LAST-FRAME-MARKER` lives in the final frame).
- `test/host.test.mjs` — route tests with a temp `DSH_HOME`; hermetic, so it runs
  in CI. Covers trust-fence rejections and generation selection.
- `test/smoke-real-session.mjs` — manual check against a real session.
- `npm test` and a GitHub Actions matrix (Node 20 / 22 / 24).
- `docs/FORMAT.md` — the session-format contract this plugin depends on.
- `CONTRIBUTING.md`.

## [1.2.0]

### Added

- `GET /api/md-export?meta=1` — lightweight JSON metadata (`title`, `filename`,
  `model`, `version`). It exists so the client can know the filename **before**
  the click, because `showSaveFilePicker()` requires transient user activation
  and cannot be awaited behind a network request.

### Changed

- **The suggested filename is now the conversation title** (for example
  `重构解析器.md`) instead of `dsh-<id>-<timestamp>.md`. Falls back to
  `dsh-<short id>.md` when the session has no title.

## [1.1.0]

### Changed

- **Adopted the ChatFormat-style document layout**: `## Metadata` as a bullet
  list, `### 🧑‍💻 User` / `### 🤖 Assistant` role headings with no turn numbers or
  horizontal rules, `#### 🤔 Thought Process` + `#### 💡 Response` when thinking is
  included, and a `### References` section.
- Message bodies are passed through `stripHashes()` so a `# Heading` inside a
  reply cannot outrank the document outline. Fenced code is preserved verbatim.
- References are deduplicated by normalized URL and numbered by first
  appearance. Loopback addresses are excluded.

### Added

- The CLI moved into `bin/`; `~/bin/dsh-md-export.mjs` is now a symlink to it.

## [1.0.0]

### Added

- `导出 MD` action in the DSH Web session header, writing the conversation to a
  file chosen through the native save dialog.
- Host route `GET|POST /api/md-export`, with a Host/Origin trust fence mirroring
  DSH Web's `/api` handling.
- Direct session-log reading, including multi-frame zstd decompression.
- `stripHashes`, `normalizeRefUrl`, and the reference collector.
- Hermetic-free first cut of `install.sh`.
