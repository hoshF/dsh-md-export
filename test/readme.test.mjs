/**
 * Keep both source samples and the reading preview in sync with the renderer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleMarkdown } from './sample.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Normalize the local-time row because formatLocalTime uses the runtime timezone.
 */
const PLACEHOLDER_TIME = '- **Time:** <local time+offset>';
const normalize = (rows) => rows.map((line) => (
  /^- \*\*Time:\*\* /.test(line) ? PLACEHOLDER_TIME : line
));

function normalizedRows(text) {
  const rows = normalize(text.split('\n').map((line) => line.replace(/\s+$/, '')));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

function markedSection(text, file, name) {
  const start = `<!-- sample:${name}:start -->`;
  const end = `<!-- sample:${name}:end -->`;
  assert.equal(text.split(start).length - 1, 1, `${file}: ${start} must occur exactly once`);
  assert.equal(text.split(end).length - 1, 1, `${file}: ${end} must occur exactly once`);
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  assert.ok(from < to, `${file}: ${name} markers are out of order`);
  return text.slice(from + start.length, to).replace(/^\n+|\n+$/g, '');
}

function sourceSample(text, file, name) {
  const section = markedSection(text, file, name);
  const match = section.match(/^````markdown\n([\s\S]*)\n````$/);
  assert.ok(match, `${file}: ${name} must contain exactly one four-backtick Markdown block`);
  assert.equal(
    section.split('\n').filter((line) => /^````(?:markdown)?$/.test(line)).length,
    2,
    `${file}: ${name} has extra four-backtick fences`,
  );
  return normalizedRows(match[1]);
}

function firstTurnPreview(markdown) {
  const conversationHeading = '## Conversation\n\n';
  const conversationStart = markdown.indexOf(conversationHeading);
  assert.ok(conversationStart !== -1, 'default sample must have a Conversation section');
  const conversation = markdown.slice(conversationStart + conversationHeading.length);
  assert.ok(conversation.startsWith('### 🧑‍💻 User\n'), 'first turn must start with a user message');
  const secondUser = conversation.indexOf('\n### 🧑‍💻 User\n');
  assert.ok(secondUser !== -1, 'sample must contain a second turn');
  const firstTurn = conversation.slice(0, secondUser).replace(/\n+$/, '');
  assert.ok(firstTurn.includes('\n### 🤖 Assistant\n'), 'first turn must include an assistant answer');
  return firstTurn.split('\n').map((line) => {
    if (line === '### 🧑‍💻 User') line = '**🧑‍💻 User**';
    if (line === '### 🤖 Assistant') line = '**🤖 Assistant**';
    return line ? `> ${line}` : '>';
  }).join('\n');
}

const defaultMarkdown = sampleMarkdown({});
const detailedMarkdown = sampleMarkdown({ tools: true, reasoning: true });

for (const file of ['README.md', 'README.zh.md']) {
  for (const [name, markdown] of [['default', defaultMarkdown], ['detailed', detailedMarkdown]]) {
    test(`${file}: ${name} source sample matches the renderer`, () => {
      const text = readFileSync(path.join(root, file), 'utf8');
      assert.deepEqual(sourceSample(text, file, name), normalizedRows(markdown));
    });
  }

  test(`${file}: preview displays the first default question and answer before the source samples`, () => {
    const text = readFileSync(path.join(root, file), 'utf8');
    const preview = markedSection(text, file, 'preview');
    assert.deepEqual(normalizedRows(preview), normalizedRows(firstTurnPreview(defaultMarkdown)));
    assert.ok(preview.split('\n').every((line) => line === '>' || line.startsWith('> ')));
    assert.ok(!/^> #{1,6} /m.test(preview), 'preview must not add headings to the README outline');
    assert.ok(text.indexOf('<!-- sample:preview:end -->') < text.indexOf('<!-- sample:default:start -->'));
    assert.ok(text.indexOf('<!-- sample:default:end -->') < text.indexOf('<!-- sample:detailed:start -->'));
  });
}
