/**
 * The session that the README's output sample is generated from.
 *
 * This exists so the sample is not a hand-written illustration that can drift
 * away from what the renderer actually emits. `test/readme.test.mjs` renders
 * this session and compares the result to the block in both READMEs, so an
 * intentional change to the output is forced to update the documentation, and an
 * unintentional one fails the build.
 *
 * The content is invented. It is shaped to exercise the behaviours the README
 * goes on to point at: a heading in the user's message, a user-side URL, a
 * tracking parameter, a tool call, and thinking.
 */

import { renderMarkdown } from '../src/render.js';

export const SAMPLE_TITLE = 'Deploy notes';
export const SAMPLE_SESSION_ID = 'session-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
export const SAMPLE_ORIGIN = 'http://127.0.0.1:8080';

const text = (value) => [{ type: 'text', text: value }];

export function sampleEvents() {
  return [
    {
      type: 'request/header',
      seq: 1,
      time: 1790000000000,
      data: { header: { config: { model: 'deepseek-flash' } } },
    },
    {
      type: 'session/title',
      seq: 2,
      time: 1790000000000,
      data: { title: SAMPLE_TITLE, source: { kind: 'fallback' } },
    },

    // ---- turn 1: a markdown heading, a user-side URL, a tool call ----------
    {
      type: 'user/message',
      seq: 3,
      time: 1790000001000,
      data: {
        role: 'user',
        id: 'u1',
        source: { kind: 'user' },
        content: text(
          '# Deploy notes\n\n'
          + '- build: `make release`\n'
          + '- target: `s3://notes-prod`\n\n'
          + 'See https://user-side.example.com/internal for context.',
        ),
      },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: 1790000002000,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'The user wants the deploy steps captured. I should confirm the build passes before writing them down.',
            },
            {
              type: 'tool-call',
              id: 'call-build-1',
              name: 'bash',
              arguments: '{"command":"make release","description":"Build the release"}',
            },
            { type: 'text', text: 'Build passes. Recorded the steps above.' },
          ],
        },
      },
    },
    {
      type: 'tool/result',
      seq: 5,
      time: 1790000002100,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call-build-1',
          isError: false,
          content: text('built 42 files in 6.1s'),
        },
      },
    },

    // ---- turn 2: a tracking parameter on a link that becomes a reference ---
    {
      type: 'user/message',
      seq: 6,
      time: 1790000003000,
      data: { role: 'user', id: 'u2', source: { kind: 'user' }, content: text('What about rollback?') },
    },
    {
      type: 'assistant/message',
      seq: 7,
      time: 1790000004000,
      data: {
        turn: 2,
        step: 1,
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Roll back with `make rollback TAG=<previous>`. The checklist is at https://example.com/release-checklist?utm_source=chat.',
          }],
        },
      },
    },
  ];
}

/** The README sample, exactly as the shipped renderer produces it. */
export function sampleMarkdown() {
  return renderMarkdown(
    {
      header: { id: SAMPLE_SESSION_ID, createdAt: 1790000000000, cwd: '/home/you/notes' },
      events: sampleEvents(),
    },
    { tools: true, reasoning: true },
    { origin: SAMPLE_ORIGIN },
  ).markdown;
}
