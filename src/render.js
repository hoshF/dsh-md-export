/**
 * 会话事件 → Markdown（对齐 AfterChat / ChatFormat 的对话导出规范）。
 *
 * 结构：
 *   ## Metadata        —— 项目符号 + 粗体键 + 反引号值（不用表格）
 *   ## Conversation    —— ### 🧑‍💻 User / ### 🤖 Assistant，无轮次号、无分隔线
 *                        可选 #### 🤔 Thought Process + #### 💡 Response
 *   ### References     —— 按 URL 归一化去重，按首次出现编号
 *
 * 两条来自该规范的关键规则：
 *   1. 正文里的 `# 标题` 转成 `**加粗**`（围栏感知），保证正文永远压不过文档大纲。
 *   2. 引用按「首次出现顺序」编号，URL 归一化（去 hash、去 tracking 参数、去尾斜杠）。
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
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const offMin = -d.getTimezoneOffset();
  const off = `${offMin >= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(offMin) / 60))}:${pad2(Math.abs(offMin) % 60)}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${off}`;
}

/**
 * `# 标题` → `**标题**`。围栏（``` / ~~~）内部原样保留，否则会破坏 Shell/Python
 * 的 `# 注释`。标题内原有的 `**` 会被吸收进同一层加粗。
 */
export function stripHashes(text) {
  if (text === null || text === undefined) return '';
  let fence = null;
  return String(text)
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      const mark = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : '';
      if (fence !== null) {
        if (mark === fence) fence = null;
        return line;
      }
      if (mark) {
        fence = mark;
        return line;
      }
      return line.replace(/^#{1,6}\s+(.+)$/, (match, content) => {
        const merged = content
          .split(/(`+[^`]*`+)/)
          .map((seg, i) => (i % 2 ? seg : seg.replace(/\*\*/g, '')))
          .join('');
        const inner = merged.trim();
        return inner ? `**${inner}**` : match;
      });
    })
    .join('\n');
}

/** URL 归一化：去 hash、去 tracking 参数、去冗余尾斜杠。 */
export function normalizeRefUrl(rawUrl) {
  if (!rawUrl) return '';
  const str = String(rawUrl).trim();
  if (!str) return '';
  try {
    const u = new URL(str);
    u.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'spm', 'from', 'source', 'feature', 'ref', 'ref_src', 'fbclid', 'gclid', 'msclkid', 'ved', 'ei']) {
      u.searchParams.delete(p);
    }
    let res = u.toString();
    if (res.endsWith('/') && !res.endsWith('://')) res = res.slice(0, -1);
    return res;
  } catch {
    return str.split('#')[0].trim().replace(/\/+$/, '');
  }
}

/** `- [n] [title](url)`，标题缺失或等于 URL 时退化。 */
export function formatRefLine(num, title, url) {
  const norm = normalizeRefUrl(url);
  const clean = (title ?? '').trim();
  if (clean && clean !== norm && clean !== url) {
    return norm ? `- [${num}] [${clean}](${norm})` : `- [${num}] ${clean}`;
  }
  if (norm) return `- [${num}] [${norm}](${norm})`;
  return `- [${num}] ${clean || 'unknown'}`;
}

/** 本机地址不是「信源」：正文里调试用的 127.0.0.1 / localhost 链接不进 References。 */
function isInternalUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '::1' || host === '0.0.0.0'
      || host === '[::1]' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** 按 URL 归一化去重的引用注册器，编号即首次出现顺序。 */
class ReferenceCollector {
  constructor() {
    this.byUrl = new Map();
    this.list = [];
  }

  add(title, url) {
    const norm = normalizeRefUrl(url);
    if (!norm || isInternalUrl(norm)) return null;
    const existing = this.byUrl.get(norm);
    if (existing) {
      // 先到者可能没标题，后来者补上
      if (!existing.title && title) existing.title = String(title).trim();
      return existing.num;
    }
    const num = this.list.length + 1;
    const entry = { num, title: (title ?? '').trim(), url: norm };
    this.byUrl.set(norm, entry);
    this.list.push(entry);
    return num;
  }

  render() {
    if (this.list.length === 0) return [];
    return ['### References', '', ...this.list.map((r) => formatRefLine(r.num, r.title, r.url)), ''];
  }
}

/** 从一段 Markdown 文本里抽出 `[title](url)` 与裸 URL。 */
function collectLinks(text, refs) {
  if (!text) return;
  const seenSpans = [];
  for (const m of text.matchAll(/\[([^\]]{0,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
    refs.add(m[1], m[2]);
    seenSpans.push(m.index);
  }
  // 裸 URL（跳过已作为 markdown 链接出现的位置）
  for (const m of text.matchAll(/(?<![(<\w])(https?:\/\/[^\s<>()"']+)/g)) {
    const inside = seenSpans.some((start) => m.index > start && m.index < start + 400);
    if (inside) continue;
    refs.add('', m[1]);
  }
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
  let toolIndex = new Map();

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
          toolIndex = new Map();
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
          } else if (block?.type === 'tool-call' && opts.tools) {
            const record = { name: block.name ?? 'tool', arguments: block.arguments ?? '', result: null, isError: false };
            turn.tools.push(record);
            if (block.id) toolIndex.set(block.id, record);
          }
        }
        // 引用收集只看助手正文，且不受 --tools/--reasoning 开关影响
        collectLinks(textParts.join('\n\n'), refs);
        break;
      }
      case 'tool/result': {
        const name = toolIndex.get(data.message?.toolCallId ?? data.toolCallId)?.name;
        const body = textOf(data.message?.content);
        if (opts.tools) {
          const id = data.message?.toolCallId ?? data.toolCallId;
          const record = id ? toolIndex.get(id) : null;
          if (record) {
            record.result = body;
            record.isError = Boolean(data.message?.isError);
          } else {
            ensure().tools.push({ name: '（未匹配的工具结果）', arguments: '', result: body, isError: Boolean(data.message?.isError) });
          }
        }
        // web 检索结果里的信源同样计入 References（对齐规范的 SEARCH 片段语义）
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
  let title = null;
  for (const event of events) {
    if (event?.type === 'session/title' && event.data?.title) title = event.data.title;
  }

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
        out.push(`**（注入消息 · ${item.kind}）**`, '', stripHashes(item.text), '');
      }
    }
    if (opts.system) {
      for (const text of turn.system) {
        out.push('**（系统提示词）**', '', stripHashes(text), '');
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
      out.push(`<details><summary>工具调用（${turn.tools.length}）</summary>`, '');
      turn.tools.forEach((tool, n) => {
        out.push(`##### ${n + 1}. \`${tool.name}\``, '');
        if (tool.arguments) out.push(fence(tool.arguments, 'json'), '');
        if (tool.result !== null) {
          out.push(tool.isError ? '**结果（错误）**' : '**结果**', '', fence(tool.result), '');
        }
      });
      out.push('</details>', '');
    }

    if (turn.aborted) out.push('> ⚠️ 本轮被中止', '');
  }

  out.push(...refs.render());

  return {
    markdown: `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`,
    turnCount: real.length,
    referenceCount: refs.list.length,
    title,
  };
}

/** 内容里可能出现 ``` ，围栏要足够长才不会被内容截断。 */
function fence(text, lang = '') {
  let f = '```';
  while (text.includes(f)) f += '`';
  return `${f}${lang}\n${text}\n${f}`;
}

/**
 * 文件名 = 会话标题（对齐 AfterChat 的命名：纯标题，无短 id、无时间戳）。
 * 标题缺失或清洗后为空时退回 `dsh-<短id>.md`。
 */
export function markdownFilename(header, title) {
  const cleaned = (title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[.\s]+$/, '')
    .trim();
  if (cleaned) return `${cleaned}.md`;
  const id8 = String(header?.id ?? 'session').replace(/^session-/, '').slice(0, 8);
  return `dsh-${id8}.md`;
}
