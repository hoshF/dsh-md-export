/**
 * Session events to English Markdown: Metadata, Conversation and References.
 * Demote message headings outside code fences; deduplicate normalized references
 * in first-appearance order. UI localization belongs to lib/client.js.
 */

const ROLE_USER = '### 🧑‍💻 User';
const ROLE_ASSISTANT = '### 🤖 Assistant';

// ------------------------------------------------------------------ 文本工具

const textOf = (blocks) =>
  (blocks ?? [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地时间 + 时区偏移，如 2026-10-02 13:29:56 -07:00。 */
export function formatLocalTime(ms) {
  if (!ms) return 'unknown';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return 'unknown';

  const totalOffsetMinutes = -date.getTimezoneOffset();
  const sign = totalOffsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalOffsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;

  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return `${day} ${clock} ${offset}`;
}

/** 去掉 `**` 强调，使降级后的标题落在同一层加粗里。行内代码段原样保留。 */
function withoutEmphasis(content) {
  const strip = (chunk) => chunk.split('**').join('');
  let result = '';
  let cursor = 0;
  for (;;) {
    const open = content.indexOf('`', cursor);
    if (open === -1) return result + strip(content.slice(cursor));
    const close = content.indexOf('`', open + 1);
    if (close === -1) return result + strip(content.slice(cursor));
    result += strip(content.slice(cursor, open)) + content.slice(open, close + 1);
    cursor = close + 1;
  }
}

/**
 * `# 标题` 行 → `**标题**` 行；其余行原样返回。
 * 缩进、制表符与围栏外的普通文本都不受影响。
 */
function demoteHeadingLine(line) {
  const match = /^#{1,6}[ \t]+(.*)$/.exec(line);
  if (match === null) return line;
  const title = withoutEmphasis(match[1]).trim();
  return title === '' ? line : `**${title}**`;
}

/**
 * 把正文里的标题标记降级为加粗，使其无法与本文件生成的 `##` / `###` 大纲竞争。
 *
 * 围栏（``` 与 ~~~）内部逐字节保留——Shell 与 Python 的 `# 注释` 不是标题。
 * 按 CommonMark 的规则，闭合围栏必须使用同一字符且长度不短于开启围栏。
 */
export function stripHashes(text) {
  if (text === null || text === undefined) return '';
  const lines = String(text).split('\n');
  const output = [];
  let openFence = null;

  for (const line of lines) {
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (openFence === null) {
      if (fence !== null) {
        openFence = { char: fence[1][0], length: fence[1].length };
        output.push(line);
      } else {
        output.push(demoteHeadingLine(line));
      }
      continue;
    }
    output.push(line);
    if (fence !== null && fence[1][0] === openFence.char && fence[1].length >= openFence.length) {
      openFence = null;
    }
  }
  return output.join('\n');
}

/**
 * Source-attribution parameters removed when normalizing reference URLs.
 * Only include attribution parameters whose removal preserves the resource identity.
 */
const ATTRIBUTION_PARAMS = [
  // 通用营销归因（Urchin Tracking Module 家族及其常见扩展）
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  // 各广告平台的点击标识
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid', 'yclid', 'ttclid', 'li_fat_id',
  // 邮件与联盟营销
  'mc_cid', 'mc_eid', 'mkt_tok', '_openstat', 'wickedid',
  // 站内来源标记
  'spm', 'scm', 'ref', 'ref_src', 'referrer', 'source', 'from', 'feature',
];

/** URL 归一化：去 hash、去归因参数、去多余的尾斜杠。无法解析时退化为文本清洗。 */
export function normalizeRefUrl(rawUrl) {
  if (!rawUrl) return '';
  const text = String(rawUrl).trim();
  if (text === '') return '';
  try {
    const url = new URL(text);
    url.hash = '';
    for (const param of ATTRIBUTION_PARAMS) url.searchParams.delete(param);
    const rendered = url.toString();
    return rendered.endsWith('/') && !rendered.endsWith('://') ? rendered.slice(0, -1) : rendered;
  } catch {
    return text.split('#')[0].trim().replace(/\/+$/, '');
  }
}

/** 一行引用：`- [n] [标题](url)`；标题缺失或与 URL 相同时退化为自链接。 */
export function formatRefLine(num, title, url) {
  const link = normalizeRefUrl(url);
  const label = String(title ?? '').trim();
  const labelled = label !== '' && label !== link && label !== url;

  if (labelled && link !== '') return `- [${num}] [${label}](${link})`;
  if (link !== '') return `- [${num}] [${link}](${link})`;
  return `- [${num}] ${labelled ? label : 'unknown'}`;
}

/** 本机地址不是「信源」：正文里调试用的 127.0.0.1 / localhost 链接不进 References。 */
function isInternalUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '::1' || host === '[::1]' || host === '0.0.0.0'
      || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * 按归一化 URL 去重的引用集合。
 * 编号不预先存储，而是在渲染时按 Map 的插入顺序推导——插入顺序即首次出现顺序。
 */
class ReferenceCollector {
  constructor() {
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  add(title, url) {
    const key = normalizeRefUrl(url);
    if (key === '' || isInternalUrl(key)) return;

    const label = String(title ?? '').trim();
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      // 先出现的可能没有标题，后来的可以补上
      if (existing === '' && label !== '') this.entries.set(key, label);
      return;
    }
    this.entries.set(key, label);
  }

  render() {
    if (this.entries.size === 0) return [];
    const lines = ['### References', ''];
    let num = 1;
    for (const [url, title] of this.entries) lines.push(formatRefLine(num++, title, url));
    lines.push('');
    return lines;
  }
}

/** 引号内联链接：[标签](url)。标签长度设上限，避免把整段文本当标签回溯。 */
const MARKDOWN_LINK = /\[([^\]]{0,300})\]\((https?:\/\/[^)\s]+)\)/g;
/** 裸 URL，前面不能紧跟 ( < 或词字符（否则它多半是某个标记的一部分）。 */
const BARE_URL = /(?<![(<\w])(https?:\/\/[^\s<>()"'，。；：！？、…“”‘’《》【】]+)/g;

/**
 * Mask Markdown link spans before scanning bare URLs to avoid double-counting.
 * Register both match types in their original text order.
 */
function collectLinks(text, refs) {
  if (!text) return;

  const links = [];
  let masked = text;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    links.push({ index: match.index, title: match[1], url: match[2] });
    const start = match.index;
    masked = masked.slice(0, start) + ' '.repeat(match[0].length) + masked.slice(start + match[0].length);
  }

  for (const match of masked.matchAll(BARE_URL)) {
    // 裸链接末尾的句子标点不属于目标地址；显式 Markdown 目标不做这个猜测。
    links.push({ index: match.index, title: '', url: match[1].replace(/[.,;:!?]+$/, '') });
  }
  links.sort((a, b) => a.index - b.index);
  for (const link of links) refs.add(link.title, link.url);
}

// ------------------------------------------------------------------ 事件 → 轮次

/**
 * @param {object[]} events
 * @param {{injected?: boolean, system?: boolean, tools?: boolean, reasoning?: boolean}} opts
 */
export function buildTurns(events, opts = {}) {
  const turns = [];
  const refs = new ReferenceCollector();
  let current = null;
  const toolIndex = new Map();   // callId → 工具记录（仅 tools 开启时填充）
  const toolNames = new Map();   // callId → 调用名（始终填充，References 依赖它）

  const ensure = () => {
    if (current === null) {
      current = { human: null, assistant: [], reasoning: [], tools: [], injected: [], system: [], aborted: false };
      turns.push(current);
    }
    return current;
  };

  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue;
    const data = event.data ?? {};
    switch (event.type) {
      case 'user/message': {
        const kind = data.source?.kind;
        const text = textOf(data.content);
        if (kind === 'user') {
          current = { human: text, assistant: [], reasoning: [], tools: [], injected: [], system: [], aborted: false };
          turns.push(current);
          // Call ids are session-wide; delayed results can arrive in a later turn.
        } else if (opts.injected && text) {
          ensure().injected.push({ kind: kind ?? 'unknown', text });
        }
        break;
      }
      case 'system/message': {
        const text = textOf(data.message?.content);
        if (opts.system && text) ensure().system.push(text);
        break;
      }
      case 'assistant/message': {
        const turn = ensure();
        const textParts = [];
        for (const block of data.message?.content ?? []) {
          if (block?.type === 'text' && block.text?.trim()) {
            turn.assistant.push(block.text.trim());
            textParts.push(block.text);
          } else if (block?.type === 'reasoning' && opts.reasoning && block.text?.trim()) {
            turn.reasoning.push(block.text.trim());
          } else if (block?.type === 'tool-call') {
            // 调用名始终登记（References 要靠它识别 web 检索结果），
            // 但只有开启 tools 时才把调用本身写进文档。
            if (block.id) toolNames.set(block.id, block.name ?? 'tool');
            if (opts.tools) {
              const record = { name: block.name ?? 'tool', arguments: block.arguments ?? '', result: null, isError: false };
              turn.tools.push(record);
              if (block.id) toolIndex.set(block.id, record);
            }
          }
        }
        // 引用收集只看助手正文，且不受 --tools/--reasoning 开关影响
        collectLinks(textParts.join('\n\n'), refs);
        break;
      }
      case 'tool/result': {
        // v4 places ids/flags on the message; v0/v3 wrap the body in tool-result.
        const message = data.message ?? {};
        const blocks = Array.isArray(message.content) ? message.content.filter(Boolean) : [];
        const wrapped = blocks.filter((block) => block.type === 'tool-result');

        const callId = message.toolCallId
          ?? wrapped[0]?.toolCallId
          ?? message.source?.callId
          ?? data.toolCallId;
        const body = wrapped.length
          ? wrapped.map((block) => textOf(block.content)).filter(Boolean).join('\n\n')
          : textOf(blocks);
        const isError = Boolean(message.isError ?? wrapped.some((block) => block.isError));

        const name = callId ? toolNames.get(callId) : undefined;
        if (opts.tools) {
          const record = callId ? toolIndex.get(callId) : null;
          if (record) {
            record.result = body;
            record.isError = isError;
          } else {
            ensure().tools.push({ name: '(unmatched tool result)', arguments: '', result: body, isError });
          }
        }
        // Search/fetch result links also contribute references.
        if (name === 'web_search' || name === 'web_fetch') collectLinks(body, refs);
        break;
      }
      case 'turn/end': {
        if (data.reason?.kind === 'aborted') ensure().aborted = true;
        break;
      }
      default:
        break;
    }
  }
  return { turns, refs };
}

// ------------------------------------------------------------------ 元信息

/** Latest non-empty title; a session may acquire or change its title after creation. */
export function extractTitle(events) {
  let title = null;
  for (const event of events) {
    if (event?.type === 'session/title' && event.data?.title) title = event.data.title;
  }
  return title;
}

/** 从 request/header 事件里取运行用的模型。 */
export function extractModel(events) {
  for (const event of events) {
    if (event?.type !== 'request/header') continue;
    const config = event.data?.header?.config;
    if (config?.model) return { model: config.model, provider: config.provider ?? null };
  }
  return { model: null, provider: null };
}

// ------------------------------------------------------------------ 渲染

/**
 * @param {{header: object|null, events: object[]}} log
 * @param {object} opts
 * @param {{origin?: string|null}} meta
 * @returns {{markdown: string, turnCount: number, referenceCount: number, title: string|null}}
 */
export function renderMarkdown({ header, events }, opts = {}, meta = {}) {
  const title = extractTitle(events);
  const { turns, refs } = buildTurns(events, opts);
  const real = turns.filter((t) => t.human !== null);
  const { model } = extractModel(events);

  const out = [];

  if (opts.h1 && title) {
    out.push(`# ${title}`, '');
  }

  out.push('## Metadata', '');
  out.push(`- **Model:** \`${model ?? 'unknown'}\``);
  out.push(`- **Time:** ${formatLocalTime(header?.createdAt)}`);
  if (header?.id) out.push(`- **Session:** \`${header.id}\``);
  if (header?.cwd) out.push(`- **Workspace:** \`${header.cwd}\``);
  if (meta.origin) out.push(`- **URL:** ${meta.origin}`);
  out.push('');

  out.push('## Conversation', '');

  for (const turn of real) {
    if (turn.human !== null) {
      out.push(ROLE_USER, '', stripHashes(turn.human), '');
    }

    if (opts.injected) {
      for (const item of turn.injected) {
        out.push(`**(Injected · ${item.kind})**`, '', stripHashes(item.text), '');
      }
    }
    if (opts.system) {
      for (const text of turn.system) {
        out.push('**(System prompt)**', '', stripHashes(text), '');
      }
    }

    const hasAssistant = turn.assistant.length > 0
      || (opts.reasoning && turn.reasoning.length > 0)
      || (opts.tools && turn.tools.length > 0);
    if (!hasAssistant) continue;

    out.push(ROLE_ASSISTANT, '');

    if (opts.reasoning && turn.reasoning.length > 0) {
      out.push('#### 🤔 Thought Process', '', stripHashes(turn.reasoning.join('\n\n')), '');
      out.push('#### 💡 Response', '');
    }

    if (turn.assistant.length > 0) {
      out.push(stripHashes(turn.assistant.join('\n\n')), '');
    }

    if (opts.tools && turn.tools.length > 0) {
      out.push(`<details><summary>Tool calls (${turn.tools.length})</summary>`, '');
      turn.tools.forEach((tool, n) => {
        out.push(`##### ${n + 1}. \`${tool.name}\``, '');
        if (tool.arguments) out.push(fence(tool.arguments, 'json'), '');
        if (tool.result !== null) {
          out.push(tool.isError ? '**Result (error)**' : '**Result**', '', fence(tool.result), '');
        }
      });
      out.push('</details>', '');
    }

    if (turn.aborted) out.push('> ⚠️ This turn was interrupted', '');
  }

  out.push(...refs.render());

  return {
    // 结构间距由上面的空行负责；全局压缩会改写正文及工具围栏里的内容。
    markdown: `${out.join('\n').trimEnd()}\n`,
    turnCount: real.length,
    referenceCount: refs.size,
    title,
  };
}

/** 内容里可能出现 ``` ，围栏要足够长才不会被内容截断。 */
function fence(text, lang = '') {
  let f = '```';
  while (text.includes(f)) f += '`';
  return `${f}${lang}\n${text}\n${f}`;
}

/** 文件名主体长度上限：标题可能很长，但文件名不该长到难以阅读。 */
const MAX_FILENAME_STEM = 80;
/** 退回命名里保留的会话 id 字符数（去掉 `session-` 前缀之后）。 */
const SHORT_ID_LENGTH = 8;

/** 从会话 id 造一个稳定的短标识，用于无标题时的退回命名。 */
export function shortSessionId(sessionId) {
  return String(sessionId ?? 'session').replace(/^session-/, '').slice(0, SHORT_ID_LENGTH);
}

/** 无标题时的退回文件名，形如 `dsh-1a2b3c4d.md`。 */
export function fallbackMarkdownFilename(sessionId) {
  return `dsh-${shortSessionId(sessionId)}.md`;
}

/**
 * 文件名 = 会话标题：只保留标题本身，不带短 id、不带时间戳。
 * 标题缺失或清洗后为空时退回 `fallbackMarkdownFilename()`。
 */
export function markdownFilename(header, title) {
  const cleaned = (title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_STEM)
    // Do not leave a dangling high surrogate at the filename length limit.
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  return cleaned ? `${cleaned}.md` : fallbackMarkdownFilename(header?.id);
}
