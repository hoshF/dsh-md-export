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

## [1.4.0]

### Added

- **The UI copy is localised.** The button was hardcoded Chinese, so in an
  English UI it was the only Chinese string in the session header. It now
  registers `zh` and `en` dictionaries with the host's locale service and
  subscribes to `locale/change`, so switching the language in Settings updates it
  without a reload. The plugin does not decide the language itself — that is the
  host's precedence chain (explicit user choice, then browser language, then
  English) — and it deliberately does not read `navigator.language`, which would
  bypass the user's own setting.

### Changed

- A download glyph precedes the label, and the label is shorter. The icon is
  inline SVG rather than an emoji, which renders differently on every platform.
  Icon-only was considered and rejected: the session header already offers the
  official *Download session log*, which produces a ZIP of JSONL rather than a
  readable transcript, and an unlabelled arrow cannot be told apart from it.
- `title` and `aria-label` text follow the language too.

## [1.3.2]

### Fixed

- **The plugin required a newer Node than it claimed.** `engines` said `>=20` and
  the README said the same, but reading a session log needs
  `zstdDecompressSync`, which `node:zlib` only gained in **Node 22.15** (23.8 on
  the 23 line). On Node 20 the named import made the module fail to *link*, so the
  plugin did not even load — it surfaced as `does not provide an export named
  'zstdDecompressSync'`. `engines` now says `>=22.15`, the docs say so, and
  `src/session.js` imports `node:zlib` as a namespace and checks at runtime so an
  unsupported runtime gets a sentence instead of a module error. The plugin also
  warns once at load time in that case.

  CI caught this: the Node 20 matrix leg failed while 22, 24 and 26 passed. The
  matrix is now `22.15.0` (the real floor), `24` and `26` — testing the claimed
  minimum is the point.
- The unsupported-runtime error was being swallowed. `decompressZstdAll()`
  catches failures while probing for frame boundaries, which also caught "this
  runtime has no zstd" and replaced it with a misleading
  `zstd frame boundary parse failed`. The capability check now runs before the
  loop.

### Changed

- `install.sh` deletes the profile lockfile before installing. pnpm reuses the
  previously locked tarball when a rebuilt one keeps the same version, so
  editing the source and re-running the script could report success while
  changing nothing. A profile locks only this one dependency, so there is no
  cost to regenerating it.

## [1.3.1]

An audit pass over the repository rather than a feature change: dead code,
hardcoded values, and traces of the machine it was developed on.

### Fixed

- **`install.sh` installed the dependency but never registered the bundle.** A
  profile only loads a package listed in `dsh.profile.bundles`, so a fresh clone
  produced a plugin that was present and completely inert — the script warned
  about the missing registration instead of performing it. It now reconciles the
  list the way `dsh plugin` and the app's Plugins page do, and is idempotent.
  This went unnoticed because the development profile already carried the
  registration from an earlier manual install; the from-scratch path was never
  exercised.
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
- `package.json` carries the repository metadata, and the READMEs name the
  project's real URL.

### Added

- README: how to update and uninstall, and a note that a git install resolves to
  a commit, so updating means installing again.

### Removed

- The unused `writeSessionHome` fixture helper.
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
