/**
 * 会话日志的定位与读取。
 *
 * DSH 往会话日志里按帧追加 zstd 数据，所以一个 `.zstd` 文件往往是几百个
 * **拼接的 zstd 帧**。Node 的 `zstdDecompressSync` 只解第一帧，流式 API 遇到
 * 第二帧会报 "Unknown frame descriptor"，因此这里自行扫帧边界逐帧解压。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

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
 * 解压一串拼接的 zstd 帧。
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function decompressZstdAll(buf) {
  const offsets = [];
  for (let i = buf.indexOf(MAGIC); i !== -1; i = buf.indexOf(MAGIC, i + 4)) offsets.push(i);
  if (offsets.length === 0 || offsets[0] !== 0) return zstdDecompressSync(buf);

  const parts = [];
  let start = 0;
  let cursor = 1;
  while (start < buf.length) {
    let advanced = false;
    for (let j = Math.max(cursor, 1); j <= offsets.length; j++) {
      const end = j < offsets.length ? offsets[j] : buf.length;
      if (end <= start) continue;
      try {
        parts.push(zstdDecompressSync(buf.subarray(start, end)));
        start = end;
        cursor = j + 1;
        advanced = true;
        break;
      } catch {
        // 边界不对（帧内出现了伪造 magic），向后扩展重试
      }
    }
    if (!advanced) throw new Error('zstd 帧边界解析失败（日志可能正在写入，请重试）');
  }
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
