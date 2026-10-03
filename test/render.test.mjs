/**
 * Rendering tests over a synthetic session log.
 *
 * These build their own fixture, so they run anywhere — no DSH installation, no
 * personal session data. The critical case is `LAST-FRAME-MARKER`: it lives in
 * the final zstd frame, so seeing it proves every frame was decompressed rather
 * than just the first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSessionLog } from '../src/session.js';
import { renderMarkdown } from '../src/render.js';
import { writeSession, TITLE, MODEL } from './fixtures.mjs';

const home = mkdtempSync(path.join(tmpdir(), 'dsh-md-export-render-'));
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

const { file } = writeSession(home);
const log = readSessionLog(file);

const render = (opts = {}) => renderMarkdown(log, opts, { origin: 'http://127.0.0.1:19387' });

test('reads every zstd frame, not just the first', () => {
  const { markdown } = render();
  assert.match(markdown, /LAST-FRAME-MARKER/, 'content from the final frame is missing');
  assert.match(markdown, /第一轮回答/, 'content from a middle frame is missing');
  assert.ok(log.events.length > 5, `expected many events, got ${log.events.length}`);
});

test('unknown event types are ignored without failing', () => {
  const { markdown } = render({ injected: true, system: true, tools: true, reasoning: true });
  assert.doesNotMatch(markdown, /UNKNOWN-EVENT-MARKER/);
});

test('metadata block reports model, time, session and workspace', () => {
  const { markdown } = render();
  assert.match(markdown, /^## Metadata$/m);
  assert.ok(markdown.includes(`- **Model:** \`${MODEL}\``));
  assert.match(markdown, /- \*\*Time:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/);
  assert.match(markdown, /- \*\*Session:\*\* `session-fixture-0001/);
  assert.match(markdown, /- \*\*Workspace:\*\* `\/tmp\/fixture-workspace`/);
  assert.ok(markdown.includes('- **URL:** http://127.0.0.1:19387'));
});

test('document starts at ## Metadata and has no H1 by default', () => {
  const { markdown } = render();
  assert.equal(markdown.split('\n')[0], '## Metadata');
  // a leading `#` may legitimately appear inside fenced code — that is not an H1
  assert.doesNotMatch(markdown.split('\n')[0], /^# /);
});

test('h1 opt-in prepends the conversation title', () => {
  const { markdown } = render({ h1: true });
  assert.ok(markdown.startsWith(`# ${TITLE}`));
});

test('role headings carry the conversation, with no turn numbers or rules', () => {
  const { markdown, turnCount } = render();
  assert.equal(turnCount, 2);
  assert.equal((markdown.match(/^### 🧑‍💻 User$/gm) ?? []).length, 2);
  assert.match(markdown, /^### 🤖 Assistant$/m);
  assert.doesNotMatch(markdown, /^---$/m);
  assert.doesNotMatch(markdown, /第 1 轮/);
});

test('injected user-side messages stay out unless requested', () => {
  assert.doesNotMatch(render().markdown, /INJECTED-CONTEXT-MARKER/);
  const withInjected = render({ injected: true }).markdown;
  assert.match(withInjected, /INJECTED-CONTEXT-MARKER/);
  assert.match(withInjected, /注入消息 · runtime-context/);
});

test('thinking and tool calls are opt-in and fold into the assistant message', () => {
  const plain = render().markdown;
  assert.doesNotMatch(plain, /REASONING-MARKER/);
  assert.doesNotMatch(plain, /web_search/);

  const full = render({ reasoning: true, tools: true }).markdown;
  assert.match(full, /^#### 🤔 Thought Process$/m);
  assert.match(full, /^#### 💡 Response$/m);
  assert.match(full, /REASONING-MARKER/);
  assert.match(full, /web_search/);
});

test('headings inside message bodies are demoted, fenced text is untouched', () => {
  const { markdown } = render();
  assert.match(markdown, /^\*\*一级标题\*\*$/m);
  assert.doesNotMatch(markdown, /^# 一级标题$/m);
  assert.match(markdown, /^# 这是 shell 注释，必须逐字节保留$/m);
  assert.match(markdown, /^echo "# 也不是标题"$/m);
});

test('references are normalized, deduplicated, and numbered by first appearance', () => {
  const { markdown, referenceCount } = render();
  assert.equal(referenceCount, 3);

  const block = markdown.slice(markdown.indexOf('### References'));
  assert.match(block, /^- \[1\] \[https:\/\/example\.com\/alpha\]\(https:\/\/example\.com\/alpha\)$/m);
  assert.match(block, /^- \[2\] \[Search Source\]\(https:\/\/example\.com\/from-search\)$/m);
  assert.match(block, /^- \[3\] \[Beta\]\(https:\/\/example\.com\/beta\)$/m);

  // tracking parameters and fragments are stripped
  assert.doesNotMatch(block, /utm_source|utm_medium|fbclid|#frag/);
  // the same URL twice collapses to one entry
  assert.equal((block.match(/example\.com\/alpha/g) ?? []).length, 2); // once as text, once as target
});

test('loopback URLs and user-side links are not references', () => {
  const { markdown } = render();
  const block = markdown.slice(markdown.indexOf('### References'));
  assert.doesNotMatch(block, /127\.0\.0\.1:9999/);
  assert.doesNotMatch(block, /user-side\.example\.com/);
  // …but the user's own text is still reproduced verbatim in the transcript
  assert.match(markdown, /user-side\.example\.com\/should-not-appear/);
});
