/*
 * DSH 客户端模块。沿用加载器的 closure-factory 格式，因此本地目录/tarball
 * 安装无需任何构建步骤或第三方构建依赖。
 *
 * 交互顺序：先取文件名、再弹保存框、最后取内容。showSaveFilePicker 要求瞬时
 * 用户激活，所以前面的取名字请求必须是有界的（本地请求，META_TIMEOUT_MS 以内，
 * 远短于约 5 秒的激活窗口）。反过来「只用挂载时的快照」是错的：新会话在挂载的
 * 那一刻还没有标题。
 *
 * 文案全部走宿主的 locale 服务（zh / en 两份字典）。插件自己不判断语言——
 * 那是宿主的职责：用户显式选择 > 浏览器语言 > 英文回退。
 */

window.__ModuleLoader__.load({
  id: 'dsh-md-export',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');

    /**
     * 必须与宿主 `src/index.js` 的 `MD_EXPORT_PATH` 一致。浏览器模块 import
     * 不到宿主 ESM，所以这个重复是结构性的：改一处就要改两处。
     */
    const ENDPOINT = '/api/md-export';
    /** 「已保存」提示显示多久后回到常态。 */
    const SAVED_STATE_MS = 1600;
    const SLOT = 'conversation.session.header.utilities';
    const LOCALE_NS = 'dsh-md-export';
    const STYLE_ID = 'dsh-md-export/action';

    /** 两份字典都必须提供——宿主按用户偏好与浏览器语言二选一。 */
    const DICTIONARY = {
      zh: {
        button: '导出 MD',
        busy: '导出中…',
        done: '已保存',
        failed: '导出失败',
        hint: '把当前会话导出为 Markdown（弹出系统保存窗口）',
      },
      en: {
        button: 'Export MD',
        busy: 'Exporting…',
        done: 'Saved',
        failed: 'Export failed',
        hint: 'Export this conversation as Markdown (opens the system save dialog)',
      },
    };

    const STYLE = [
      '.dshMdExportAction{display:inline-flex;align-items:center;gap:6px;',
      'border:1px solid var(--dsw-alias-border-l2);height:32px;',
      'color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);cursor:pointer;',
      'background:transparent;border-radius:18px;padding:6px 12px;font-size:13px;font-weight:400;',
      'line-height:20px;white-space:nowrap}',
      '.dshMdExportAction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshMdExportAction:disabled{color:var(--dsw-alias-label-dimmed);cursor:not-allowed}',
      '.dshMdExportIcon{flex:none}',
    ].join('');

    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-md-export';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = STYLE;
      document.head.appendChild(tag);
    }

    /**
     * 取当前语言的翻译函数。
     *
     * 用宿主文档给出的 `ctx.locale.bind(ns)` 消费者接口，而不是自己去读
     * `navigator.language` —— 后者会绕过用户在 Settings 里的显式选择。
     * 任何一步不可用都退回英文，宁可文案不对也不要一个空白按钮。
     */
    function translator(locale) {
      const fallback = (key) => DICTIONARY.en[key] ?? key;
      if (!locale || typeof locale.bind !== 'function') return fallback;
      let bound;
      try {
        bound = locale.bind(LOCALE_NS);
      } catch {
        return fallback;
      }
      if (typeof bound !== 'function') return fallback;
      return (key) => {
        try {
          const value = bound(key);
          return typeof value === 'string' && value !== '' ? value : fallback(key);
        } catch {
          return fallback(key);
        }
      };
    }

    /** 下载箭头。用内联 SVG 而不是 emoji：emoji 各平台渲染差异太大。 */
    function DownloadIcon() {
      return jsxs('svg', {
        className: 'dshMdExportIcon',
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        children: [
          jsx('path', { d: 'M8 2.75v7.5' }),
          jsx('path', { d: 'M4.75 7 8 10.25 11.25 7' }),
          jsx('path', { d: 'M3 13.25h10' }),
        ],
      });
    }

    /**
     * 兜底文件名：元信息尚未取回、或会话本身没有标题时才用。
     * 与宿主 `src/render.js` 的 `fallbackMarkdownFilename()` 保持同样的形状
     * （同样是无法共享代码所致）。
     */
    function fallbackName(sessionId) {
      const id8 = String(sessionId ?? 'session').replace(/^session-/, '').slice(0, 8);
      return `dsh-${id8}.md`;
    }

    /** 保存框要用的元信息，必须带界：它挡在用户手势与保存框之间。 */
    const META_TIMEOUT_MS = 2000;

    /** 轻量元信息（标题 → 文件名）。极小响应，用作保存框的建议名。 */
    async function fetchMeta(sessionId) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), META_TIMEOUT_MS);
      try {
        const response = await fetch(`${ENDPOINT}?meta=1&sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          signal: controller === null ? undefined : controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    /** 服务端给的（可能含中文的）文件名 —— 经 X-Dsh-Filename 百分号编码传回。 */
    function serverFilename(response, fallback) {
      const encoded = response.headers.get('X-Dsh-Filename');
      if (encoded) {
        try {
          const decoded = decodeURIComponent(encoded);
          if (decoded.toLowerCase().endsWith('.md') && !/[\\/\u0000-\u001f]/.test(decoded)) return decoded;
        } catch {
          /* 落到 fallback */
        }
      }
      return fallback;
    }

    /** 回退路径：普通下载（不弹框，取决于浏览器/宿主设置）。 */
    function downloadViaAnchor(markdown, filename) {
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function pickSaveHandle(name) {
      if (typeof window.showSaveFilePicker !== 'function') return { handle: null, cancelled: false };
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        return { handle, cancelled: false };
      } catch (error) {
        if (error && error.name === 'AbortError') return { handle: null, cancelled: true };
        return { handle: null, cancelled: false }; // 宿主不支持 → 回退
      }
    }

    /**
     * 订阅语言变化。事件在宿主 ctx 上（`ctx.on('locale/change')`，与其它 0.2.x
     * 客户端的用法一致）；若某个部署把它挂在 locale 服务上，也一并兼容。
     * 两者都不可用时返回 undefined —— 按钮仍可用，只是切换语言后要等重新挂载。
     */
    function subscribeLocaleChange(ctx, locale, handler) {
      for (const source of [ctx, locale]) {
        if (source && typeof source.on === 'function') {
          try {
            const off = source.on('locale/change', handler);
            if (typeof off === 'function') return off;
          } catch { /* 换下一个来源 */ }
        }
      }
      return undefined;
    }

    function MdExportAction({ sessionId, locale, ctx }) {
      const [state, setState] = React.useState({ status: 'idle', error: null });
      const metaRef = React.useRef(null);
      // 宿主切换语言时不重新挂载组件，所以自己订阅一次并强制重渲染。
      const [, setLocaleRevision] = React.useState(0);

      React.useEffect(() => {
        const off = subscribeLocaleChange(ctx, locale, () => setLocaleRevision((n) => n + 1));
        return typeof off === 'function' ? off : undefined;
      }, [ctx, locale]);

      // 挂载时先取一次，仅作预热与兜底。它不能作为最终依据：新会话在挂载的
      // 那一刻还没有标题（标题由第一条消息之后生成），这份快照会一直是
      // dsh-<短id>，直到组件因切换会话而重新挂载。
      React.useEffect(() => {
        let alive = true;
        metaRef.current = null;
        fetchMeta(sessionId)
          .then((meta) => { if (alive) metaRef.current = meta; })
          .catch(() => { /* 点击时会重新取 */ });
        return () => { alive = false; };
      }, [sessionId]);

      const t = translator(locale);
      const busy = state.status === 'working';
      const label = busy ? t('busy')
        : state.status === 'error' ? t('failed')
          : state.status === 'done' ? t('done')
            : t('button');
      const title = state.status === 'error' ? state.error : t('hint');

      const onExport = async () => {
        setState({ status: 'working', error: null });

        // 0) 每次点击都重新取文件名。信挂载时的快照会让「新会话」永远导出成
        //    dsh-<短id>：挂载那一刻标题还不存在。
        let name = null;
        try {
          const meta = await fetchMeta(sessionId);
          metaRef.current = meta;
          name = meta?.filename ?? null;
        } catch {
          // 取不到就用挂载时的快照，再不行才用兜底名
          name = metaRef.current?.filename ?? null;
        }
        name = name ?? fallbackName(sessionId);

        // 1) 再要句柄：仍在激活窗口内（上面的请求有 META_TIMEOUT_MS 上界）
        const { handle, cancelled } = await pickSaveHandle(name);
        if (cancelled) {
          setState({ status: 'idle', error: null });
          return;
        }

        try {
          // 2) 再取内容
          const response = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' });
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
          }
          const markdown = await response.text();

          // 3) 落盘
          if (handle) {
            const writable = await handle.createWritable();
            try {
              await writable.write(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
              await writable.close();
            } catch (error) {
              try { await writable.abort(); } catch { /* 已经关闭 */ }
              throw error;
            }
          } else {
            downloadViaAnchor(markdown, serverFilename(response, name));
          }

          setState({ status: 'done', error: null });
          setTimeout(() => setState({ status: 'idle', error: null }), SAVED_STATE_MS);
        } catch (error) {
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      };

      return jsxs('button', {
        type: 'button',
        className: 'dshMdExportAction',
        onClick: onExport,
        disabled: busy,
        title,
        children: [jsx(DownloadIcon, {}), label],
      });
    }

    /**
     * locale 是宿主随客户端树一起激活的服务，所以直接声明依赖。
     * 插件不自己判断语言：注册两份字典，由宿主决定当前用哪份。
     */
    const inject = ['slots', 'locale'];

    function apply(ctx) {
      const locale = ctx.locale;
      ctx.effect(
        () => locale.register(LOCALE_NS, DICTIONARY),
        'md-export: locale dictionary',
      );

      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: 'md-export',
        label: translator(locale)('button'),
      }, (props) => MdExportAction({ ...props, locale, ctx })));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
