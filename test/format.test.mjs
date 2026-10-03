/**
 * Unit tests for the pure formatting helpers.
 * No filesystem, no DSH — these run anywhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripHashes, normalizeRefUrl, formatRefLine, formatLocalTime, markdownFilename,
} from '../src/render.js';

test('stripHashes demotes headings to bold', () => {
  assert.equal(stripHashes('# Title'), '**Title**');
  assert.equal(stripHashes('###### Six'), '**Six**');
  assert.equal(stripHashes('#### 四级标题'), '**四级标题**');
});

test('stripHashes absorbs existing emphasis into one bold span', () => {
  assert.equal(stripHashes('## **Already bold**'), '**Already bold**');
  assert.equal(stripHashes('## a **b** c'), '**a b c**');
});

test('stripHashes leaves non-headings alone', () => {
  assert.equal(stripHashes('not a # heading'), 'not a # heading');
  assert.equal(stripHashes('正文里的井号 # 不算标题。'), '正文里的井号 # 不算标题。');
  assert.equal(stripHashes('#nospace'), '#nospace');
  assert.equal(stripHashes('#'), '#');
  assert.equal(stripHashes(''), '');
  assert.equal(stripHashes(null), '');
  assert.equal(stripHashes(undefined), '');
});

test('stripHashes preserves fenced code byte for byte', () => {
  const backtick = ['```sh', '# comment', 'echo "# hi"', '```', '# heading after fence'].join('\n');
  assert.equal(
    stripHashes(backtick),
    ['```sh', '# comment', 'echo "# hi"', '```', '**heading after fence**'].join('\n'),
  );

  const tilde = ['~~~python', '# comment', '~~~'].join('\n');
  assert.equal(stripHashes(tilde), tilde);

  // a fence only closes on the same character
  const mixed = ['```', '~~~', '# still inside', '```', '# outside'].join('\n');
  assert.equal(stripHashes(mixed), ['```', '~~~', '# still inside', '```', '**outside**'].join('\n'));
});

test('normalizeRefUrl strips fragments, attribution parameters and trailing slashes', () => {
  assert.equal(
    normalizeRefUrl('https://a.com/x/?utm_source=tw&utm_campaign=c&id=1#frag'),
    'https://a.com/x/?id=1',
  );
  assert.equal(normalizeRefUrl('https://a.com/x/'), 'https://a.com/x');
  assert.equal(normalizeRefUrl('https://a.com/'), 'https://a.com');
  assert.equal(normalizeRefUrl('https://a.com/x?fbclid=abc'), 'https://a.com/x');
  assert.equal(normalizeRefUrl('https://a.com/x?spm=a1.spm&keep=1'), 'https://a.com/x?keep=1');
});

test('normalizeRefUrl degrades gracefully on unusable input', () => {
  assert.equal(normalizeRefUrl(''), '');
  assert.equal(normalizeRefUrl('   '), '');
  assert.equal(normalizeRefUrl(null), '');
  assert.equal(normalizeRefUrl('not a url###'), 'not a url');
});

test('formatRefLine degrades sensibly', () => {
  assert.equal(formatRefLine(1, 'Title', 'https://a.com/x'), '- [1] [Title](https://a.com/x)');
  assert.equal(formatRefLine(2, '', 'https://a.com/y'), '- [2] [https://a.com/y](https://a.com/y)');
  assert.equal(formatRefLine(3, 'https://a.com/z', 'https://a.com/z'), '- [3] [https://a.com/z](https://a.com/z)');
});

test('formatLocalTime is stable and carries a timezone offset', () => {
  assert.equal(formatLocalTime(null), 'unknown');
  assert.equal(formatLocalTime(0), 'unknown');
  assert.equal(formatLocalTime(Number.NaN), 'unknown');
  assert.match(formatLocalTime(1790000000000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
});

test('markdownFilename prefers the conversation title', () => {
  const header = { id: 'session-abc12345' };
  assert.equal(markdownFilename(header, '中文标题示例'), '中文标题示例.md');
  assert.equal(markdownFilename(header, 'Plain title'), 'Plain title.md');
});

test('markdownFilename sanitises illegal characters and length', () => {
  const header = { id: 'session-abc12345' };
  assert.equal(markdownFilename(header, 'a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i.md');
  assert.equal(markdownFilename(header, 'trailing dots...'), 'trailing dots.md');
  assert.equal(markdownFilename(header, 'x'.repeat(120)), `${'x'.repeat(80)}.md`);
});

test('markdownFilename never splits an emoji at its length limit', () => {
  const header = { id: 'session-unicode' };
  const overflow = markdownFilename(header, `${'a'.repeat(79)}😀`);
  assert.doesNotThrow(() => encodeURIComponent(overflow));
  assert.equal(overflow, `${'a'.repeat(79)}.md`);
  assert.equal(markdownFilename(header, `${'a'.repeat(78)}😀`), `${'a'.repeat(78)}😀.md`);
});

test('markdownFilename falls back to a short id', () => {
  const header = { id: 'session-abc12345' };
  assert.equal(markdownFilename(header, null), 'dsh-abc12345.md');
  assert.equal(markdownFilename(header, ''), 'dsh-abc12345.md');
  assert.equal(markdownFilename(header, '   '), 'dsh-abc12345.md');
});
