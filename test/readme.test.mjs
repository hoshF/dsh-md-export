/**
 * Keeps the README honest.
 *
 * The output sample is the README's main claim, and it is the kind of thing that
 * rots silently: the renderer changes, nobody re-reads the documentation, and the
 * published example becomes a description of a version that no longer exists.
 * The sample was in fact hand-wrapped when it was first written, which is exactly
 * the drift this catches.
 *
 * Both READMEs carry the same block, so both are checked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleMarkdown } from './sample.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Rows of the four-backtick markdown block, with trailing whitespace normalised. */
function sampleBlock(file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const match = text.match(/^````markdown\n([\s\S]*?)^````/m);
  assert.ok(match, `${file} has no fenced sample block`);
  const rows = match[1].split('\n').map((line) => line.replace(/\s+$/, ''));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

const rendered = sampleMarkdown().split('\n').map((line) => line.replace(/\s+$/, ''));
while (rendered.length > 0 && rendered[rendered.length - 1] === '') rendered.pop();

for (const file of ['README.md', 'README.zh.md']) {
  test(`${file}: the published output sample is byte-for-byte what the renderer emits`, () => {
    const published = sampleBlock(file);
    const firstDiff = published.findIndex((line, i) => line !== rendered[i]);

    // Report the first divergence rather than a 56-line wall of diff.
    assert.equal(
      published.length === rendered.length && firstDiff === -1,
      true,
      firstDiff === -1
        ? `line count differs: README has ${published.length}, renderer produces ${rendered.length}`
        : `line ${firstDiff + 1} differs:\n  README:   ${JSON.stringify(published[firstDiff])}\n  renderer: ${JSON.stringify(rendered[firstDiff])}`,
    );
  });
}
