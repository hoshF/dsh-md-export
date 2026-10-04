/**
 * Rendering tests using synthetic logs; LAST-FRAME-MARKER verifies that content
 * from the final compressed frame is included.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSessionLog, hasZstdSupport } from '../src/session.js';
import { renderMarkdown, buildTurns } from '../src/render.js';
import { writeSession, v0Events, TITLE, MODEL } from './fixtures.mjs';

const home = mkdtempSync(path.join(tmpdir(), 'dsh-md-export-render-'));
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

const { file } = writeSession(home);
const log = readSessionLog(file);

const render = (opts = {}) => renderMarkdown(log, opts, { origin: 'http://127.0.0.1:8080' });

test('the runtime provides the zstd API the log format needs', () => {
  assert.equal(
    hasZstdSupport(),
    true,
    `node:zlib zstd is required to read session logs (Node 22.15+); running ${process.version}`,
  );
});

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
  assert.ok(markdown.includes('- **URL:** http://127.0.0.1:8080'));
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
  assert.match(withInjected, /\(Injected · runtime-context\)/);
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

test('rendering preserves consecutive blank lines in user and assistant code blocks', () => {
  const code = ['```text', 'first', '', '', '', 'last', '```'].join('\n');
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: code }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: code }] } } },
  ];
  const { markdown } = renderMarkdown({ header: log.header, events });
  assert.equal(markdown.split(code).length - 1, 2, 'code block whitespace was rewritten');
});

test('rendering preserves consecutive blank lines in tool arguments and results', () => {
  const argumentsText = '{\n\n\n"command": "example"\n}';
  const resultText = 'first\n\n\n\nlast';
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'run' }] } },
    { type: 'assistant/message', data: { message: { content: [
      { type: 'tool-call', id: 'whitespace-call', name: 'bash', arguments: argumentsText },
    ] } } },
    { type: 'tool/result', data: { message: { toolCallId: 'whitespace-call', content: [{ type: 'text', text: resultText }] } } },
  ];
  const { markdown } = renderMarkdown({ header: log.header, events }, { tools: true });
  assert.ok(markdown.includes(argumentsText), 'tool arguments whitespace was rewritten');
  assert.ok(markdown.includes(resultText), 'tool result whitespace was rewritten');
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

const referenceExport = (text) => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'sources?' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
  ];
  const { markdown } = renderMarkdown({ header: log.header, events });
  return markdown.slice(markdown.indexOf('### References'));
};

test('mixed bare and Markdown links keep their first appearance order', () => {
  const refs = referenceExport('First https://example.com/first then [Second](https://example.com/second).');
  assert.match(refs, /- \[1\] \[https:\/\/example\.com\/first\]/);
  assert.match(refs, /- \[2\] \[Second\]/);
});

test('a later labelled duplicate adds its title without changing its original position', () => {
  const refs = referenceExport('https://example.com/first https://example.com/second [First](https://example.com/first?utm_source=chat)');
  assert.match(refs, /- \[1\] \[First\]\(https:\/\/example\.com\/first\)/);
  assert.match(refs, /- \[2\] \[https:\/\/example\.com\/second\]/);
});

test('bare references exclude English and Chinese sentence punctuation', () => {
  const refs = referenceExport('See https://example.com/english. 另见 https://example.com/chinese。下一句。还有 https://example.com/query?q=one,two，结束。');
  assert.match(refs, /\(https:\/\/example\.com\/english\)/);
  assert.match(refs, /\(https:\/\/example\.com\/chinese\)/);
  assert.match(refs, /\(https:\/\/example\.com\/query\?q=one%2Ctwo\)/);
  assert.doesNotMatch(refs, /%E3%80%82|%EF%BC%8C|下一句/);
});

test('explicit Markdown destinations and encoded URL punctuation are preserved', () => {
  const refs = referenceExport('[Exact](https://example.com/file.) and https://example.com/path%2E?q=why%3F.');
  assert.match(refs, /\[Exact\]\(https:\/\/example\.com\/file\.\)/);
  assert.match(refs, /\(https:\/\/example\.com\/path%2E\?q=why%3F\)/);
});

// ---------------------------------------------------------------- v0 shape
// Wrapped tool results carry ids, flags and bodies inside a tool-result block.

const legacy = { header: { id: 'session-v0-fixture', createdAt: 1790000000000 }, events: v0Events() };
const renderLegacy = (opts = {}) => renderMarkdown(legacy, opts, {});

test('v0: a tool result matches its call instead of becoming an orphan', () => {
  const { turns } = buildTurns(legacy.events, { tools: true });
  const records = turns.flatMap((turn) => turn.tools);

  assert.equal(records.length, 2, 'expected exactly one record per tool call');
  assert.equal(
    records.filter((record) => record.name === '(unmatched tool result)').length,
    0,
    'a v0 result failed to match its call, which duplicates every tool in the export',
  );
});

test('v0: the nested result body survives', () => {
  const { turns } = buildTurns(legacy.events, { tools: true });
  const search = turns.flatMap((turn) => turn.tools).find((record) => record.name === 'web_search');

  assert.ok(search, 'the web_search record is missing');
  assert.match(search.result, /Legacy Source/, 'the body inside the tool-result block was dropped');
});

test('v0: the error flag inside the wrapper block is honoured', () => {
  const { markdown } = renderLegacy({ tools: true });
  assert.match(markdown, /LEGACY-ERROR-BODY/);

  const { turns } = buildTurns(legacy.events, { tools: true });
  const failed = turns.flatMap((turn) => turn.tools).find((record) => record.name === 'bash');
  assert.equal(failed.isError, true, 'a failed tool was reported as successful');
});

test('v0: search sources reach References', () => {
  const { markdown } = renderLegacy();
  assert.match(markdown, /### References/, 'no References section was emitted');
  assert.match(
    markdown,
    /https:\/\/example\.com\/legacy-search/,
    'a source from a v0 tool result never reached References',
  );
  assert.doesNotMatch(
    markdown,
    /utm_source=tracking/,
    'the tracking parameter survived normalisation',
  );
});

test('v0: the streaming duplicate is not read on top of the finalized rows', () => {
  const { markdown } = renderLegacy({ reasoning: true });
  assert.match(markdown, /LEGACY-REASONING-MARKER/, 'the finalized reasoning block is missing');
  assert.doesNotMatch(
    markdown,
    /STREAM-ONLY-MARKER/,
    'chunk rows were read as well, which double-counts the conversation',
  );
});
