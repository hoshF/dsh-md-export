/*
 * DSH 客户端模块。沿用加载器的 closure-factory 格式，因此本地目录/tarball
 * 安装无需任何构建步骤或第三方构建依赖。
 *
 * 交互顺序刻意设计为「先弹保存框、再取内容」：showSaveFilePicker 要求瞬时
 * 用户激活，若先 await 网络请求，激活可能已过期而抛错。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-export',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');

    const ENDPOINT = '/api/md-export';
    const STYLE_ID = 'dsh-md-export/action';
    const STYLE = [
      '.dshMdExportAction{border:1px solid var(--dsw-alias-border-l2);height:32px;',
      'color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);cursor:pointer;',
      'background:transparent;border-radius:18px;padding:6px 12px;font-size:13px;font-weight:400;',
      'line-height:20px;white-space:nowrap}',
      '.dshMdExportAction:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshMdExportAction:disabled{color:var(--dsw-alias-label-dimmed);cursor:not-allowed}',
    ].join('');

    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-md-export';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = STYLE;
      document.head.appendChild(tag);
    }

    /** 兜底文件名：元信息尚未取回、或会话本身没有标题时才用。 */
    function fallbackName(sessionId) {
      const id8 = String(sessionId ?? 'session').replace(/^session-/, '').slice(0, 8);
      return `dsh-${id8}.md`;
    }

    /** 轻量元信息（标题 → 文件名）。极小响应，用作保存框的建议名。 */
    async function fetchMeta(sessionId) {
      const response = await fetch(`${ENDPOINT}?meta=1&sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
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

    function MdExportAction({ sessionId }) {
      const [state, setState] = React.useState({ status: 'idle', error: null });
      const metaRef = React.useRef(null);

      // 挂载即预取文件名。保存框必须在用户手势内弹出，所以标题不能等到点击时才去取。
      React.useEffect(() => {
        let alive = true;
        metaRef.current = null;
        fetchMeta(sessionId)
          .then((meta) => { if (alive) metaRef.current = meta; })
          .catch(() => { /* 点击时还有一次补救机会 */ });
        return () => { alive = false; };
      }, [sessionId]);

      const busy = state.status === 'working';
      const label = busy ? '导出中…' : state.status === 'error' ? '导出失败' : state.status === 'done' ? '已保存' : '导出 MD';
      const title = state.status === 'error' ? state.error : '把当前会话导出为 Markdown（弹出保存窗口）';

      const onExport = async () => {
        setState({ status: 'working', error: null });

        // 0) 取对话标题作为建议文件名；预取未命中就补一次（本地请求，远在 5 秒激活窗口内）
        let name = metaRef.current?.filename ?? null;
        if (!name) {
          try {
            const meta = await fetchMeta(sessionId);
            metaRef.current = meta;
            name = meta?.filename ?? null;
          } catch { /* 退回兜底名 */ }
        }

        // 1) 先要句柄：保住用户手势，同时立刻弹出原生保存框
        const { handle, cancelled } = await pickSaveHandle(name ?? fallbackName(sessionId));
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
            downloadViaAnchor(markdown, serverFilename(response, name ?? fallbackName(sessionId)));
          }

          setState({ status: 'done', error: null });
          setTimeout(() => setState({ status: 'idle', error: null }), 1600);
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
        children: [label],
      });
    }

    const inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'md-export',
        label: '导出 MD',
      }, MdExportAction));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
