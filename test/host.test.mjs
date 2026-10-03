import http from 'node:http';
import { createMdExportHandler } from '/Users/hoshf/Project/dsh-md-export/src/index.js';

const sessionId = process.argv[2];
const handler = createMdExportHandler({
  trustedHosts: [],
  onError: (e) => console.log('  [host onError]', e?.message ?? e),
});
const server = http.createServer((req, res) => {
  handler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- 1) 正常导出
const url = `http://127.0.0.1:${port}/api/md-export?sessionId=${sessionId}`;
const res = await fetch(url);
console.log('1) 正常导出');
console.log('   status          :', res.status);
console.log('   content-type    :', res.headers.get('content-type'));
console.log('   content-disp    :', res.headers.get('content-disposition'));
console.log('   X-Dsh-Filename  :', decodeURIComponent(res.headers.get('x-dsh-filename') ?? '(none)'));
const text = await res.text();
console.log('   bytes           :', Buffer.byteLength(text));
console.log('   前 3 行         :', text.split('\n').slice(0, 3).join(' \\n '));

// ---- 2) 不存在的会话
const missing = await fetch(`http://127.0.0.1:${port}/api/md-export?sessionId=session-does-not-exist`);
console.log('2) 不存在的会话  : HTTP', missing.status, '|', (await missing.text()).slice(0, 60));

// ---- 3) 缺 sessionId
const noId = await fetch(`http://127.0.0.1:${port}/api/md-export`);
console.log('3) 缺 sessionId  : HTTP', noId.status, '|', (await noId.text()).slice(0, 60));

// ---- 4) 不可信 Host（应 403）
const forged = await new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: `/api/md-export?sessionId=${sessionId}`, headers: { Host: 'evil.example.com' } }, (r) => {
    let body = '';
    r.on('data', (c) => { body += c; });
    r.on('end', () => resolve({ status: r.statusCode, body }));
  });
  req.end();
});
console.log('4) 伪造 Host     : HTTP', forged.status, '|', forged.body.slice(0, 40));

// ---- 5) 跨站 sec-fetch-site（应 403）
const cross = await new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: `/api/md-export?sessionId=${sessionId}`, headers: { 'sec-fetch-site': 'cross-site' } }, (r) => {
    let body = '';
    r.on('data', (c) => { body += c; });
    r.on('end', () => resolve({ status: r.statusCode, body }));
  });
  req.end();
});
console.log('5) 跨站请求      : HTTP', cross.status, '|', cross.body.slice(0, 40));

// ---- 6) 带工具调用
const withTools = await fetch(`${url}&tools=1&reasoning=1`);
const toolText = await withTools.text();
console.log('6) 含工具调用    : HTTP', withTools.status, '|', Buffer.byteLength(toolText), 'bytes |',
  `工具段 ${(toolText.match(/<summary>工具调用/g) ?? []).length} 个`);

server.close();
