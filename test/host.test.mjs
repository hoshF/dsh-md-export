/**
 * Route tests for the host half.
 *
 * Everything runs against a synthetic DSH home, so the suite is hermetic: no DSH
 * installation, no personal session data. `DSH_HOME` is pointed at a temp
 * directory *before* `src/session.js` is imported, because that module resolves
 * the sessions root once at load time.
 *
 * To check against a real session instead, run `test/smoke-real-session.mjs`.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeSession, SESSION_ID, TITLE } from './fixtures.mjs';

const home = mkdtempSync(path.join(tmpdir(), 'dsh-md-export-host-'));

writeSession(home);

// A directory holding two generations: the reader must pick the highest one.
const GENERATION_ID = 'session-fixture-gen-0001';
writeSession(home, { sessionId: GENERATION_ID, generation: 'session.v4.jsonl.zstd' });
writeSession(home, {
  sessionId: GENERATION_ID,
  generation: 'session.jsonl.zstd',
  version: 0,
  events: [{ type: 'session/title', seq: 1, time: 1790000000000, data: { title: 'STALE-GENERATION' } }],
});

// A non-ASCII title, to exercise the ASCII fallback in Content-Disposition.
const CJK_ID = 'session-fixture-cjk-0001';
const CJK_TITLE = '不拆书高质量扫描设备';
writeSession(home, {
  sessionId: CJK_ID,
  events: [{ type: 'session/title', seq: 1, time: 1790000000000, data: { title: CJK_TITLE } }],
});

process.env.DSH_HOME = home;
const { createMdExportHandler, MD_EXPORT_PATH } = await import('../src/index.js');

const handler = createMdExportHandler({ trustedHosts: [] });
const server = http.createServer((request, response) => {
  handler(request, response).catch((error) => {
    response.writeHead(500);
    response.end(String(error));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// Close the listener explicitly: an open handle would keep the test runner
// alive forever, and `process.on('exit')` cannot fire until the loop drains.
after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(home, { recursive: true, force: true });
});

/** Raw request, so tests can forge the Host header that fetch() refuses to set. */
function raw(pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('exports the conversation as Markdown', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}?sessionId=${SESSION_ID}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const markdown = await response.text();
  assert.match(markdown, /^## Metadata$/m);
  assert.match(markdown, /LAST-FRAME-MARKER/, 'content from the final zstd frame is missing');

  assert.match(response.headers.get('content-disposition'), /^attachment; filename="[^"]+\.md"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(response.headers.get('x-dsh-filename')), `${TITLE}.md`);
});

test('a non-ASCII title keeps a usable ASCII fallback filename', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}?sessionId=${CJK_ID}`);
  const disposition = response.headers.get('content-disposition');

  assert.equal(decodeURIComponent(response.headers.get('x-dsh-filename')), `${CJK_TITLE}.md`);
  assert.match(disposition, /filename="[a-z0-9-]+\.md"/, `no ASCII fallback in: ${disposition}`);
  assert.ok(
    disposition.includes(`filename*=UTF-8''${encodeURIComponent(`${CJK_TITLE}.md`)}`),
    `missing RFC 5987 filename*: ${disposition}`,
  );
});

test('meta=1 returns a lightweight JSON payload carrying the filename', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}?meta=1&sessionId=${SESSION_ID}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

  const meta = await response.json();
  assert.equal(meta.sessionId, SESSION_ID);
  assert.equal(meta.title, TITLE);
  assert.equal(meta.filename, `${TITLE}.md`);
  assert.equal(meta.model, 'fixture-model');
  assert.equal(meta.version, 4);
});

test('POST accepts the same options as JSON', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, reasoning: true }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /REASONING-MARKER/);
});

test('picks the highest session-log generation', async () => {
  const meta = await (await fetch(`${base}${MD_EXPORT_PATH}?meta=1&sessionId=${GENERATION_ID}`)).json();
  assert.equal(meta.version, 4, 'the v0 generation was selected instead of the v4 one');
  assert.notEqual(meta.title, 'STALE-GENERATION');
});

test('an unknown session yields 404', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}?sessionId=session-nope`);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /session log not found/);
});

test('a missing sessionId yields 400', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /sessionId is required/);
});

test('a malformed JSON body yields 400', async () => {
  const response = await fetch(`${base}${MD_EXPORT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(response.status, 400);
});

test('a forged Host header is rejected', async () => {
  const response = await raw(`${MD_EXPORT_PATH}?sessionId=${SESSION_ID}`, { headers: { Host: 'evil.example.com' } });
  assert.equal(response.status, 403);
  assert.equal(response.body, 'forbidden');
});

test('a cross-site request is rejected', async () => {
  const response = await raw(`${MD_EXPORT_PATH}?sessionId=${SESSION_ID}`, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(response.status, 403);
});

test('an unsupported method yields 405', async () => {
  const response = await raw(`${MD_EXPORT_PATH}?sessionId=${SESSION_ID}`, { method: 'PUT' });
  assert.equal(response.status, 405);
});
