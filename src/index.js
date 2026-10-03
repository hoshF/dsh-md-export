/**
 * 宿主半边：把「按会话 id 读日志 → 渲染 Markdown」暴露成一条同源 HTTP 路由。
 *
 * 读取走本进程直接读会话日志文件（多帧 zstd），不依赖 sessionQuery 的规范化
 * 事件形状——那是会随会话格式版本漂移的地方，也正是同类插件频繁失效的原因。
 * 本插件不声明任何 @deepseek-ai/* peer 依赖，因此不会被 0.2.x 的兼容性闸门拦下。
 */

import { findSessionFile, readSessionLog, hasZstdSupport } from './session.js';
import { renderMarkdown, markdownFilename, extractModel, fallbackMarkdownFilename } from './render.js';

export const name = 'md-export';
export const inject = ['webServer', 'webRuntime'];

/**
 * 路由路径。客户端 `lib/client.js` 里的 `ENDPOINT` 必须与之一致：浏览器模块
 * 无法 import 宿主 ESM，这个重复是结构性的，改一处就要改两处。
 */
export const MD_EXPORT_PATH = '/api/md-export';
/** 请求体上限：这里只接受一个会话 id 和几个布尔开关。 */
const MAX_BODY_BYTES = 4096;
/** Content-Disposition 的 filename= 只接受 ASCII。 */
const ASCII_ONLY = /^[\x20-\x7e]+$/;

// ------------------------------------------------------------------ 请求边界

function headerValue(headers, key) {
  const value = headers?.[key];
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** 复刻 DSH Web 对 /api 的 Host/Origin 信任围栏。 */
export function isTrustedRequest(request, trustedHosts = []) {
  const host = headerValue(request.headers, 'host');
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  if (!isLoopback(hostUrl.hostname)) {
    const allowed = trustedHosts.some((entry) => {
      const entryUrl = parseAuthority(entry);
      return entryUrl !== undefined && entryUrl.host === hostUrl.host;
    });
    if (!allowed) return false;
  }
  if (headerValue(request.headers, 'sec-fetch-site') === 'cross-site') return false;
  const origin = headerValue(request.headers, 'origin');
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error('request too large');
    chunks.push(buffer);
  }
  if (bytes === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const flag = (value) => TRUTHY.has(String(value ?? '').toLowerCase());

function writeText(response, status, text) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function asciiFallback(filename, sessionId) {
  if (ASCII_ONLY.test(filename)) return filename;
  return fallbackMarkdownFilename(sessionId);
}

// ------------------------------------------------------------------ 处理器

/**
 * 构造 /api/md-export 的请求处理器。
 * @param {{trustedHosts?: readonly string[], onError?: (error: unknown) => void}} options
 */
export function createMdExportHandler({ trustedHosts = [], onError = () => {} } = {}) {
  return async function handle(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      writeText(response, 405, 'method not allowed');
      return;
    }
    if (!isTrustedRequest(request, trustedHosts)) {
      writeText(response, 403, 'forbidden');
      return;
    }

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      let body = {};
      if (request.method === 'POST') {
        try {
          body = await readJsonBody(request);
        } catch {
          writeText(response, 400, 'invalid JSON body');
          return;
        }
      }
      const sessionId = String(url.searchParams.get('sessionId') ?? body.sessionId ?? '');
      if (!sessionId) {
        writeText(response, 400, 'sessionId is required');
        return;
      }

      const file = findSessionFile(sessionId);
      if (file === null) {
        writeText(response, 404, `session log not found: ${sessionId}`);
        return;
      }

      const opts = {
        tools: flag(url.searchParams.get('tools') ?? body.tools),
        reasoning: flag(url.searchParams.get('reasoning') ?? body.reasoning),
        injected: flag(url.searchParams.get('injected') ?? body.injected),
        system: flag(url.searchParams.get('system') ?? body.system),
        h1: flag(url.searchParams.get('h1') ?? body.h1),
      };

      const log = readSessionLog(file);
      if (log.header === null || log.header.id !== sessionId) {
        writeText(response, 500, 'session log header does not match the requested session');
        return;
      }

      // 对话导出规范里 Metadata 的 URL 字段：这里就是本次请求自己的来源
      const host = headerValue(request.headers, 'host');
      const proto = headerValue(request.headers, 'x-forwarded-proto') ?? 'http';
      const origin = host ? `${proto}://${host}` : null;

      // 轻量元信息：客户端在挂载时预取文件名，才能在用户手势内用对话标题弹出保存框
      if (flag(url.searchParams.get('meta') ?? body.meta)) {
        let metaTitle = null;
        for (const event of log.events) {
          if (event?.type === 'session/title' && event.data?.title) metaTitle = event.data.title;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(JSON.stringify({
          sessionId,
          title: metaTitle,
          filename: markdownFilename(log.header, metaTitle),
          model: extractModel(log.events).model,
          createdAt: log.header.createdAt ?? null,
          version: log.version,
        }));
        return;
      }

      const { markdown, title } = renderMarkdown(log, opts, { origin });
      const filename = markdownFilename(log.header, title);
      const fallback = asciiFallback(filename, sessionId);

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Dsh-Filename': encodeURIComponent(filename),
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(markdown);
    } catch (error) {
      onError(error);
      writeText(response, 500, `markdown export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

/**
 * 注册路由。
 * @param {object} ctx DSH Cordis 上下文。
 */
export function apply(ctx) {
  // 会话日志是 zstd 压缩的，而 node:zlib 的 zstd API 在 22.15 之前不存在。
  // 在这里说清楚，好过让用户点按钮时收到一条 500。
  if (!hasZstdSupport()) {
    ctx.logger?.warn?.(new Error(
      `md-export: this runtime (Node ${process.version}) has no zstd support in node:zlib, `
      + 'so DSH session logs cannot be read. Node 22.15+ is required.',
    ));
  }

  const trustedHosts = ctx.webRuntime?.trustedHosts ?? [];
  const handler = createMdExportHandler({
    trustedHosts,
    onError: (error) => ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error))),
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: MD_EXPORT_PATH, handler }),
    'md-export: Markdown download route',
  );
}
