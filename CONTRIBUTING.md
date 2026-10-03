# Contributing

Thanks for looking. This is a small plugin, so this document is short and mostly
about two hard constraints that are easy to break by accident.

## Setup

There is nothing to install. The package has **zero dependencies** and no build
step:

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

Host-side changes require **restarting DSH**; client-side changes only need a
page refresh. The app hot-loads a newly installed bundle, but does not re-import
changed file contents for a module it has already loaded.

## Hard constraint 1: no build step

Keep the package installable straight from a git checkout.

DSH's plugin dialog accepts a GitHub repository address, and pnpm **blocks
`prepare` / build scripts for git-hosted dependencies** until the user
explicitly allows them. A package that needs building therefore cannot be
installed from a repository URL without extra ceremony. Shipping readable
sources as-is is a feature.

Concretely: no bundler, no TypeScript, no transpile step, no `prepare` script.
`lib/client.js` is written in the client loader's closure-factory format by hand
for exactly this reason.

## Hard constraint 2: clean-room

Do not copy implementation code from other chat exporters.

This matters more than it sounds. `AfterChat — LLM Chat Exporter` is the
best-known reference for this document format and is licensed **AGPL-3.0**;
earlier revisions of this repository reimplemented several helpers with that
source open, and that had to be rewritten. Other DSH export plugins are in the
same neighbourhood.

What is fine:

- Using the **document format** — heading structure, section names, metadata
  fields, naming conventions. Formats and ideas are not copyrightable, and the
  README credits the convention.
- Reading another project *to learn what the output should look like* and then
  writing your own implementation against that specification.

What is not fine:

- Copying function bodies, parameter lists, or curated constant tables.
- Rewriting a copyleft implementation line by line with renamed variables.

If you are porting logic from somewhere, say so in the pull request so the
licence can be checked before merge.

## Changing behaviour

- **Add a test.** `npm test` must pass. Behaviour changes without a test will be
  asked for one.
- **Update both READMEs.** `README.md` (English) and `README.zh.md` (Chinese)
  are kept in sync; a change to one is a change to both.
- **Update `CHANGELOG.md`** under `[Unreleased]`, and read the versioning policy
  at the top of that file — a change to the rendered Markdown shape is at least
  a minor bump.
- **Do not add an event-shape dependency without documenting it** in
  `docs/FORMAT.md`. That document is the contract; undocumented coupling is how
  this kind of plugin dies.

## Adding support for a new session format

See the recipe at the end of [`docs/FORMAT.md`](docs/FORMAT.md#adding-support-for-a-new-format).

The short version: add synthetic events to `test/fixtures.mjs`, assert both the
old and new shapes in `test/render.test.mjs`, and keep both branches in
`buildTurns()`. Support for two formats at once is the normal state here.

Never commit real session logs — they contain your conversations.

## Reporting a bug

Use the issue template. The three fields that actually decide the diagnosis are
the DSH version, the session format version (the `session.vN` filename), and
*how* it failed — a silently truncated file, an HTTP 500, or a missing button
are three different bugs.
