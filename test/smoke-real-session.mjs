#!/usr/bin/env node
/**
 * Manual smoke test against a real DSH session.
 *
 * Validate storage compatibility after a DSH upgrade.
 *
 *   node test/smoke-real-session.mjs [sessionId]
 *
 * Without an argument it uses the newest session found in $DSH_HOME/sessions.
 */

import http from 'node:http';

import { listSessions, findSessionFile, readSessionLog } from '../src/session.js';
import { renderMarkdown } from '../src/render.js';
import { createMdExportHandler, MD_EXPORT_PATH } from '../src/index.js';

const argument = process.argv[2];
const sessions = listSessions();

if (sessions.length === 0) {
  console.error('no sessions found under $DSH_HOME/sessions');
  process.exit(1);
}

const file = argument ? findSessionFile(argument) : sessions[0].file;
if (!file) {
  console.error(`no session matches: ${argument}`);
  process.exit(1);
}

const log = readSessionLog(file);
const sessionId = log.header?.id;
console.log(`session : ${sessionId}`);
console.log(`file    : ${file.replace(process.env.HOME ?? '~', '~')}`);
console.log(`format  : v${log.version}  ·  ${log.events.length} events`);

const { markdown, turnCount, referenceCount } = renderMarkdown(log, {}, { origin: null });
console.log(`render  : ${turnCount} turns, ${referenceCount} references, ${markdown.length} chars`);
console.log(`starts  : ${JSON.stringify(markdown.split('\n')[0])}`);
console.log(`ends    : ${JSON.stringify(markdown.trimEnd().split('\n').slice(-1)[0])}`);

// Exercise the HTTP handler end to end.
const handler = createMdExportHandler({ trustedHosts: [] });
const server = http.createServer((request, response) => {
  handler(request, response).catch((error) => {
    response.writeHead(500);
    response.end(String(error));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  const response = await fetch(`http://127.0.0.1:${port}${MD_EXPORT_PATH}?sessionId=${sessionId}`);
  console.log(`route   : HTTP ${response.status} ${response.headers.get('content-type')}`);
  console.log(`filename: ${decodeURIComponent(response.headers.get('x-dsh-filename') ?? '(none)')}`);

  const meta = await (await fetch(`http://127.0.0.1:${port}${MD_EXPORT_PATH}?meta=1&sessionId=${sessionId}`)).json();
  console.log(`meta    : ${JSON.stringify(meta)}`);

  const missing = await fetch(`http://127.0.0.1:${port}${MD_EXPORT_PATH}?sessionId=session-nope`);
  console.log(`404 case: HTTP ${missing.status}`);

  process.exit(response.status === 200 && missing.status === 404 ? 0 : 1);
} finally {
  server.closeAllConnections();
  server.close();
}
