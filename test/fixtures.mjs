/**
 * Synthetic session-log fixtures.
 *
 * Fixtures are generated rather than committed as binaries for two reasons:
 * the event shapes stay readable and reviewable in code, and the multi-frame
 * zstd layout that breaks naive readers is spelled out explicitly.
 *
 * DSH appends one zstd frame per flush. `writeSession` therefore emits three
 * frames on purpose: a reader that decodes only the first (what Node's
 * `zstdDecompressSync` does on its own) will see the header and nothing else.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import path from 'node:path';

export const SESSION_ID = 'session-fixture-0001-4000-8000-000000000001';
export const TITLE = 'Fixture Conversation';
export const MODEL = 'fixture-model';

/** One zstd frame, exactly as DSH writes them. */
const frame = (text) => zstdCompressSync(Buffer.from(text, 'utf8'));
const jsonl = (events) => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

let seq = 0;
const nextSeq = () => ++seq;

/**
 * A v4 event stream covering everything `src/render.js` depends on, plus an
 * event type it has never seen (which must simply be ignored).
 */
export function v4Events() {
  seq = 0;
  const text = (value) => [{ type: 'text', text: value }];

  return [
    {
      type: 'request/header',
      seq: nextSeq(),
      time: 1790000000000,
      data: { header: { config: { provider: 'fixture-provider', model: MODEL, maxTokens: 1024 } } },
    },
    {
      type: 'session/title',
      seq: nextSeq(),
      time: 1790000000000,
      data: { title: TITLE, source: { kind: 'fallback' } },
    },

    // ---- turn 1 -----------------------------------------------------------
    {
      type: 'user/message',
      seq: nextSeq(),
      time: 1790000001000,
      surfaceOp: 'append',
      data: {
        role: 'user',
        id: 'msg-user-1',
        source: { kind: 'user' },
        content: text([
          '# 一级标题',
          '',
          '正文里的井号 # 不算标题。',
          '',
          '这里放一个用户侧的链接，它不该进 References：https://user-side.example.com/should-not-appear',
          '',
          '```sh',
          '# 这是 shell 注释，必须逐字节保留',
          'echo "# 也不是标题"',
          '```',
        ].join('\n')),
      },
    },
    {
      type: 'user/message',
      seq: nextSeq(),
      time: 1790000001100,
      surfaceOp: 'append',
      data: {
        role: 'user',
        id: 'msg-user-injected',
        source: { kind: 'runtime-context' },
        content: text('INJECTED-CONTEXT-MARKER'),
      },
    },
    {
      // 未知事件类型：必须被安静地忽略
      type: 'future/unknown-thing',
      seq: nextSeq(),
      time: 1790000001200,
      data: { something: 'UNKNOWN-EVENT-MARKER' },
    },
    {
      type: 'assistant/message',
      seq: nextSeq(),
      time: 1790000002000,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'REASONING-MARKER' },
            { type: 'tool-call', id: 'call-web', name: 'web_search', arguments: '{"queries":["fixture"]}' },
            {
              type: 'text',
              text: '第一轮回答。带追踪参数的：https://example.com/alpha?utm_source=news#frag',
            },
            {
              type: 'text',
              // 与上一条归一化后同 URL：必须合并为一条引用
              text: '重复引用：https://example.com/alpha',
            },
          ],
        },
      },
    },
    {
      type: 'tool/result',
      seq: nextSeq(),
      time: 1790000002100,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call-web',
          isError: false,
          content: text([
            'Sources:',
            '- [Search Source](https://example.com/from-search?fbclid=tracking)',
            '- [Loopback](http://127.0.0.1:9999/internal)',
          ].join('\n')),
        },
      },
    },

    // ---- turn 2 -----------------------------------------------------------
    {
      type: 'user/message',
      seq: nextSeq(),
      time: 1790000003000,
      surfaceOp: 'append',
      data: { role: 'user', id: 'msg-user-2', source: { kind: 'user' }, content: text('第二个问题') },
    },
    {
      type: 'assistant/message',
      seq: nextSeq(),
      time: 1790000004000,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: '第二轮回答，LAST-FRAME-MARKER。另附 [Beta](https://example.com/beta?utm_medium=email)。',
          }],
        },
      },
    },
    {
      type: 'turn/end',
      seq: nextSeq(),
      time: 1790000005000,
      data: { turn: 2, reason: { kind: 'completed' } },
    },
  ];
}

/**
 * Write a session log under `<root>/sessions/<project>/<sessionId>/`.
 * @param {string} root directory to treat as DSH_HOME
 * @param {{sessionId?: string, generation?: string, events?: object[], version?: number}} [options]
 * @returns {{file: string, sessionId: string, sessionDir: string}}
 */
export function writeSession(root, options = {}) {
  const sessionId = options.sessionId ?? SESSION_ID;
  const generation = options.generation ?? 'session.v4.jsonl.zstd';
  const events = options.events ?? v4Events();
  const sessionDir = path.join(root, 'sessions', '--fixture-project--', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const header = JSON.stringify({
    type: 'session',
    version: options.version ?? 4,
    id: sessionId,
    createdAt: 1790000000000,
    cwd: '/tmp/fixture-workspace',
    agentPreset: 'standard',
  });

  const cut = Math.ceil(events.length / 2);
  const file = path.join(sessionDir, generation);
  writeFileSync(file, Buffer.concat([
    frame(`${header}\n`),
    frame(jsonl(events.slice(0, cut))),
    frame(jsonl(events.slice(cut))),
  ]));

  return { file, sessionId, sessionDir };
}
