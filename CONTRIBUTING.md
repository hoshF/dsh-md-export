# Contributing

Start with the [architecture guide](docs/ARCHITECTURE.md) for runtime boundaries,
the export lifecycle and the change-to-test map.

## Setup

The package has **zero dependencies** and no build step:

```sh
git clone <your fork>
cd dsh-md-export
npm test
```

`npm test` runs the hermetic suite (`node --test`). It needs no DSH installation
and no session data.

To try your change against a real session:

```sh
npm run test:smoke              # newest session in $DSH_HOME/sessions
node test/smoke-real-session.mjs <sessionId>
```

To install your working copy into a DSH profile:

```sh
./install.sh                    # packs, installs, reports profile state
```

Host-side changes require **restarting DSH**; client-side changes need a **hard
refresh** (⌘⇧R / Ctrl+Shift+R) to replace loaded modules and cached bundles.

## Runtime and packaging constraints

Keep the package zero-dependency and directly installable from a git checkout:
no bundler, transpilation or `prepare` script. `lib/client.js` is source in DSH's
closure-factory format; browser code uses host-provided React and services.
Node code uses builtins and relative imports. See the architecture guide for
the runtime boundary.

## Licensing and sources

Contributions must be compatible with this package's MIT distribution. When
introducing third-party code, document its source and licence in the pull
request and retain any required licence notices.

## Changing behaviour

- **Cover behaviour changes with tests.** Run `npm test` before submitting.
- **Update both READMEs.** `README.md` (English) and `README.zh.md` (Chinese)
  are kept in sync; a change to one is a change to both.
- **Update `CHANGELOG.md`** under `[Unreleased]`, and read the versioning policy
  at the top of that file — a change to the rendered Markdown shape is at least
  a minor bump.
- **Document event-shape dependencies** in `docs/FORMAT.md`.

For a refactor that preserves behaviour, use the existing tests to check the
affected path and run the full suite before submitting. `test/readme.test.mjs`
also verifies that both READMEs' output samples match the renderer byte for byte.
Add coverage when a change exposes a gap rather than tests that merely repeat
the implementation. Keep the architecture guide current when responsibilities
or runtime boundaries change.

Source comments should explain non-obvious constraints, such as why metadata
precedes the save picker. Update them with the code. See the guide's
[cross-runtime conventions](docs/ARCHITECTURE.md#conventions-across-the-boundary)
for the intentional duplication that must remain synchronized.

## Adding support for a new session format

See [Extending the contract](docs/FORMAT.md#extending-the-contract).

Add synthetic events to `test/fixtures.mjs`, assert both existing and new shapes
in `test/render.test.mjs`, and retain existing shape support in `buildTurns()`.

Never commit real session logs — they contain your conversations.

## Reporting a bug

Use the issue template. Include the DSH version, session format version (from
the `session.vN` filename), and observed behaviour or error message.
