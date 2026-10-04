# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

| bump | meaning |
|---|---|
| **major** | requires a newer DSH or drops a previously supported session format |
| **minor** | adds a capability, flag, metadata field, endpoint or document section |
| **patch** | fixes behavior without changing the output structure |

Changes to the rendered Markdown structure require at least a minor bump.

## [Unreleased]

### Changed

- Add a contributor architecture guide and simplify documentation and comments
  around current interfaces, runtime boundaries and maintenance requirements.
- Share session title selection, remove the unused single-frame decoder wrapper,
  and extract client request/write helpers without changing export behavior.
- Use the slot's locale namespace and injected translator instead of custom
  language subscriptions and refresh state.
- Preserve the profile lockfile when reinstalling, using `pnpm add --force` after
  removing the previous package.
- Put installation first in both READMEs, show the default output before optional
  records, and document title-bearing notes with `--h1`.

### Added

- Language-switching and installer regressions covering repeated installation
  and preservation of other profile plugins.
- Verify both README output modes and the rendered default excerpt against the
  shared renderer.

## [1.7.2] - 2026-10-03

### Fixed

- Reject corrupt or truncated Zstandard frames and trailing garbage by validating
  complete frame boundaries and decoder input consumption.
- Preserve consecutive blank lines in message code blocks and tool records.
- Preserve Unicode surrogate pairs when truncating title-based filenames.
- Exclude sentence punctuation from bare references and number mixed bare/Markdown
  links by first appearance, retaining labels from duplicate links.
- Prevent overlapping exports, stale saved-state timers and UI updates after
  unmount; cancellation and failures allow retrying.
- Reject missing CLI output paths and list all sessions without a row limit.
- Remove pre-v3 incomplete-export warnings from the CLI and manual smoke script.

### Added

- Compression integrity, content, filename, reference, client lifecycle and CLI
  regression tests; run all `test/*.test.mjs` files in CI.

### Documentation

- Update both READMEs and the format contract for frame integrity, filename
  refresh timing, whitespace preservation and CLI arguments.

## [1.7.1]

### Added

- Compare the published samples in both READMEs against renderer output, with the
  local-time row normalized for timezone differences.

## [1.7.0]

### Changed

- Use English throughout exported documents, including tool records, injected
  messages, system prompts and interrupted-turn notices.

### Fixed

- Correct README compatibility, runtime matrix and filename-refresh descriptions.

### Documentation

- Reorganize both READMEs around generated output samples, features, installation
  and reference material, with matching navigation and explanations.

## [1.6.1]

### Fixed

- Match wrapped tool results in v0 and v3 logs to their calls, preserving bodies,
  error flags and search references.
- Match delayed tool results across human turns by retaining session-wide call
  lookup tables.

### Changed

- Document shape-based parsing without a version gate and the omission of partial
  content that lacks a finalized message.

## [1.6.0]

### Changed

- Replace the native hover tooltip with an accessible description while retaining
  the button's visible label as its accessible name.

### Added

- Display export failures in a toast with an alert glyph and a longer duration.

## [1.5.1]

### Changed

- Use the host's check glyph and semantic success color in completion toasts,
  with an inline glyph fallback when the host icon is unavailable.

## [1.5.0]

### Added

- Show a completion toast containing the saved filename, including renames made
  in the native dialog.

### Changed

- Declare the host UI primitives client dependency; retain button feedback when
  toast primitives are unavailable.

## [1.4.1]

### Fixed

- Refresh the suggested filename on every export click with a bounded metadata
  request, retaining the mount-time value as a fallback.

## [1.4.0]

### Added

- Register English and Chinese UI dictionaries with the host locale service and
  update labels when the app language changes.

### Changed

- Add an inline download glyph and shorten the button label.
- Localize button tooltip and accessible-label text.

## [1.3.2]

### Fixed

- Require Node 22.15 or newer and report unavailable Zstandard support explicitly
  at load time and before decompression.
- Test the minimum supported runtime in the Node 22.15/24/26 CI matrix.

### Changed

- Regenerate the profile lockfile during installation to refresh same-version
  tarball dependencies.

## [1.3.1]

### Fixed

- Register the installed package in `dsh.profile.bundles` idempotently.
- Mask exact Markdown link spans before scanning bare URLs to avoid duplicate or
  missed references.

### Changed

- Replace filename, short-id, link-label and saved-state limits with named constants.
- Share fallback filename generation on the host and document client/host copies
  of shared constants.
- Add repository metadata and project links.

### Added

- Document update and uninstall procedures, including reinstalling git dependencies.

### Removed

- Remove the unused `writeSessionHome` fixture helper.
- Replace personal session identifiers and machine-specific examples with synthetic data.

## [1.3.0]

### Changed

- Reimplement formatting helpers under the project's MIT license while retaining
  document-format attribution.
- Require closing code fences to use the opening character at equal or greater length.

### Fixed

- Collect search and fetch references even when tool records are disabled.

### Added

- Add generated multi-frame fixtures, renderer tests, isolated HTTP route tests
  and a manual real-session smoke script.
- Add `npm test`, an initial Node 20/22/24 CI matrix, the format contract and
  contribution guidelines.

## [1.2.0]

### Added

- Add `GET /api/md-export?meta=1` metadata (`title`, `filename`, `model`, `version`)
  for save-dialog filename selection.

### Changed

- Suggest the conversation title as the filename, falling back to `dsh-<short id>.md`.

## [1.1.0]

### Changed

- Adopt Metadata, Conversation, role headings, optional Thought Process/Response
  sections and References without turn numbers or horizontal rules.
- Demote message headings to bold text while preserving fenced code.
- Deduplicate references by normalized URL, number them by first appearance and
  exclude loopback addresses.

### Added

- Move the CLI into `bin/`, with a user-bin symlink for direct invocation.

## [1.0.0]

### Added

- Add a session-header Markdown export action using the native save dialog.
- Add `GET|POST /api/md-export` with a Host/Origin trust boundary.
- Read session logs directly with multi-frame Zstandard decompression.
- Add heading demotion, URL normalization, reference collection and an install script.
