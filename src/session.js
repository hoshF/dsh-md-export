/**
 * Locate and read session logs, including concatenated Zstandard frames.
 * A namespace import allows an explicit error on runtimes without Zstandard.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as zlib from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');

/** `node:zlib` 是否提供 zstd。 */
export function hasZstdSupport() {
  return typeof zlib.zstdDecompressSync === 'function';
}

function zstdUnavailable() {
  return new Error(
    `this Node runtime (${process.version}) has no zstd support in node:zlib, `
    + 'and DSH session logs are zstd-compressed. Node 22.15+, 23.8+ or 24+ is required.',
  );
}

/** 一个会话目录里可能并存多代文件（session.jsonl / session.v3 / session.v4），取最高代。 */
function generationOf(filename) {
  const m = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(filename);
  if (!m) return -1;
  return m[1] ? Number(m[1]) : 0;
}

/**
 * 枚举所有会话；同一会话目录若有多代文件，只取最高代。
 * @returns {{id: string, file: string, gen: number, mtime: number, project: string}[]} 按修改时间倒序
 */
export function listSessions() {
  const found = [];
  let projects;
  try {
    projects = fs.readdirSync(SESSIONS_ROOT);
  } catch {
    return found;
  }
  for (const project of projects) {
    const projectDir = path.join(SESSIONS_ROOT, project);
    let dirs;
    try {
      dirs = fs.readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const sessionDir = path.join(projectDir, dir);
      let files;
      try {
        files = fs.readdirSync(sessionDir);
      } catch {
        continue;
      }
      let best = null;
      for (const file of files) {
        const gen = generationOf(file);
        if (gen < 0) continue;
        const full = path.join(sessionDir, file);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (best === null || gen > best.gen || (gen === best.gen && stat.mtimeMs > best.mtime)) {
          best = { gen, file: full, mtime: stat.mtimeMs };
        }
      }
      if (best !== null) found.push({ id: dir, project, ...best });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * 按会话 id 找到当前代的日志文件。
 * @param {string} sessionId
 * @returns {string|null}
 */
export function findSessionFile(sessionId) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;
  const all = listSessions();
  const hit = all.find((s) => s.id === sessionId) ?? all.find((s) => s.id.includes(sessionId));
  return hit ? hit.file : null;
}

/**
 * Find complete frame boundaries from the Zstandard layout, not payload magic.
 * Node 22 and early 24 may accept incomplete input without a decoder error.
 * https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
 */
function zstdFrameEnd(buffer, start) {
  let cursor = start;
  const take = (bytes) => {
    const position = cursor;
    cursor += bytes;
    if (cursor > buffer.length) throw new Error('zstd 帧不完整');
    return position;
  };

  const magic = buffer.readUInt32LE(take(4));
  // 标准里的 skippable 帧只携带元信息；仍须验证声明的负载已经写完。
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    const bytes = buffer.readUInt32LE(take(4));
    take(bytes);
    return cursor;
  }
  if (magic !== 0xfd2fb528) throw new Error('zstd 帧 magic 无效');

  const descriptor = buffer[take(1)];
  if (descriptor & 0x08) throw new Error('zstd 帧头使用了保留位');
  const singleSegment = Boolean(descriptor & 0x20);
  const contentSizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >>> 6];
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
  take(Number(!singleSegment) + dictionaryBytes + contentSizeBytes);

  for (;;) {
    const header = buffer.readUIntLE(take(3), 3);
    const type = (header >>> 1) & 3;
    if (type === 3) throw new Error('zstd 数据块使用了保留类型');
    // RLE 的负载始终只有一个字节；其余类型的大小表示实际负载字节数。
    take(type === 1 ? 1 : header >>> 3);
    if (header & 1) break;
  }
  if (descriptor & 0x04) take(4);
  return cursor;
}

/**
 * 解压一串拼接的 zstd 帧。
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function decompressZstdAll(buf) {
  // 先判运行时支持，避免把缺少 zstd API 误报成日志损坏。
  if (!hasZstdSupport()) throw zstdUnavailable();

  const parts = [];
  let start = 0;
  do {
    let decoded;
    let end;
    try {
      end = zstdFrameEnd(buf, start);
      // 每次只交给解压器一个完整帧；subarray 不复制输入。
      decoded = zlib.zstdDecompressSync(buf.subarray(start, end), { info: true });
    } catch (error) {
      throw new Error(`zstd 帧解压失败（字节偏移 ${start}；日志可能损坏或正在写入，请重试）`, { cause: error });
    }
    const consumed = decoded.engine.bytesWritten;
    if (consumed !== end - start) {
      throw new Error(`zstd 解压器未报告有效帧长度（字节偏移 ${start}）`);
    }
    parts.push(decoded.buffer);
    start = end;
  } while (start < buf.length);
  return Buffer.concat(parts);
}

/**
 * 读取一份会话日志。
 * @param {string} file
 * @returns {{header: object|null, events: object[], version: number}}
 */
export function readSessionLog(file) {
  const raw = fs.readFileSync(file);
  const text = file.endsWith('.zstd') ? decompressZstdAll(raw).toString('utf8') : raw.toString('utf8');
  const events = [];
  let header = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed && parsed.type === 'session' && header === null) {
      header = parsed;
      continue;
    }
    events.push(parsed);
  }
  return { header, events, version: header?.version ?? -1 };
}
