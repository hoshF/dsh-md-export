/**
 * Exercise the CLI through real child processes and synthetic session logs.
 * Each process reads a temporary DSH home and runs in a temporary directory;
 * the missing-output-path case uses --stdout to keep the old implementation
 * from writing into the user's default transcript directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeSession, v0Events, SESSION_ID } from './fixtures.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, 'bin', 'dsh-md-export.mjs');

function setup(t, options = {}) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'dsh-md-export-cli-'));
  const home = path.join(temporary, 'home');
  const cwd = path.join(temporary, 'work');
  mkdirSync(cwd);
  writeSession(home, options);
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, DSH_HOME: home, DSH_MD_EXPORT_CORE: path.join(root, 'src') },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  };
  return { home, cwd, run };
}

test('CLI rejects a missing output path before exporting', (t) => {
  const { cwd, run } = setup(t);
  for (const option of ['-o', '--out']) {
    const result = run(SESSION_ID, '--stdout', option);
    assert.equal(result.status, 1, `${option} without a path must fail`);
    assert.equal(result.stdout, '', 'an invalid command must not export Markdown');
    assert.match(result.stderr, /path/i);
    assert.deepEqual(readdirSync(cwd), [], 'an invalid command must not create files');
  }
});

test('CLI rejects an option in place of the output path without creating a file', (t) => {
  const { cwd, run } = setup(t);
  for (const [option, following] of [['-o', '--stdout'], ['--out', '--tools']]) {
    const result = run(SESSION_ID, option, following);
    assert.deepEqual(readdirSync(cwd), [], `${following} must not become a filename`);
    assert.equal(result.status, 1, 'an option cannot satisfy the output path');
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /path/i);
  }
});

test('CLI lists every session when more than 40 are present', (t) => {
  const { home, run } = setup(t, { sessionId: 'session-cli-000' });
  const ids = Array.from({ length: 45 }, (_, i) => `session-cli-${String(i).padStart(3, '0')}`);
  for (const sessionId of ids.slice(1)) writeSession(home, { sessionId });

  const result = run('--list');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^45 session\(s\), newest first:/);
  const listed = [...result.stdout.matchAll(/^\s+.*\s(session-cli-\d+)\s+\(v4\)$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(listed.sort(), ids, 'the list must contain each session exactly once');
});

test('CLI writes Markdown to stdout without creating a file', (t) => {
  const { cwd, run } = setup(t);
  const result = run(SESSION_ID, '--stdout');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^## Metadata\n/);
  assert.match(result.stdout, /LAST-FRAME-MARKER/);
  assert.equal(result.stderr, '');
  assert.deepEqual(readdirSync(cwd), []);
});

test('CLI writes to explicit output paths, including a ./-prefixed filename', (t) => {
  const { cwd, run } = setup(t);
  for (const [option, output] of [['-o', 'export.md'], ['--out', './-export.md']]) {
    const result = run(SESSION_ID, option, output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    const markdown = readFileSync(path.resolve(cwd, output), 'utf8');
    assert.match(markdown, /^## Metadata\n/);
    assert.match(markdown, /LAST-FRAME-MARKER/);
    assert.match(result.stderr, /Exported 2 turn\(s\)/);
  }
  assert.deepEqual(readdirSync(cwd).sort(), ['-export.md', 'export.md']);
});

test('CLI exports a complete v0 log without an incomplete-format warning', (t) => {
  const { cwd, run } = setup(t, {
    version: 0,
    generation: 'session.jsonl.zstd',
    events: v0Events(),
  });
  const result = run(SESSION_ID, '--stdout', '--all');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /LEGACY-USER-MARKER/);
  assert.match(result.stdout, /LEGACY-ANSWER-MARKER/);
  assert.match(result.stdout, /LEGACY-ERROR-BODY/);
  assert.doesNotMatch(result.stdout, /STREAM-ONLY-MARKER/);
  assert.equal(result.stderr, '', 'a supported version alone must not imply an incomplete export');
  assert.deepEqual(readdirSync(cwd), []);
});
