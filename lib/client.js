/*
 * DSH client module in the loader's closure-factory format. Directory and
 * tarball installs use this file directly, without a build step.
 *
 * Refresh the filename, open the picker, then fetch Markdown. The metadata
 * request is bounded by META_TIMEOUT_MS to preserve transient user activation
 * for showSaveFilePicker. A mount-time snapshot can precede title generation.
 *
 * The host locale service selects between the zh/en dictionaries according to
 * the user's preference, browser language, and English fallback.
 */

window.__ModuleLoader__.load({
  id: 'dsh-md-export',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');

    // Toast and the host check icon are optional; saving works without them.
    let Toast = null;
    let HostCheckIcon = null;
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      Toast = primitives.Toast ?? null;
      HostCheckIcon = primitives.IconCheckOutlineRegular ?? null;
    } catch {
      Toast = null;
      HostCheckIcon = null;
    }
    if (typeof Toast !== 'function') Toast = null;
    if (typeof HostCheckIcon !== 'function') HostCheckIcon = null;

    // Keep in sync with MD_EXPORT_PATH in src/index.js.
    const ENDPOINT = '/api/md-export';
    const SAVED_STATE_MS = 1600;
    const SLOT = 'conversation.session.header.utilities';
    const LOCALE_NS = 'dsh-md-export';
    const STYLE_ID = 'dsh-md-export/action';

    const DICTIONARY = {
      zh: {
        button: '导出 MD',
        busy: '导出中…',
        done: '已保存',
        failed: '导出失败',
        savedAs: '已保存 {name}',
        hint: '把当前会话导出为 Markdown（弹出系统保存窗口）',
      },
      en: {
        button: 'Export MD',
        busy: 'Exporting…',
        done: 'Saved',
        failed: 'Export failed',
        savedAs: 'Saved {name}',
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
      // Use an accessible hint without a tooltip that overlaps the save Toast.
      '.dshMdExportHint{position:absolute;width:1px;height:1px;margin:-1px;padding:0;',
      'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    ].join('');

    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-md-export';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = STYLE;
      document.head.appendChild(tag);
    }

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

    // Keep in sync with fallbackMarkdownFilename() in src/render.js.
    function fallbackName(sessionId) {
      const id8 = String(sessionId ?? 'session').replace(/^session-/, '').slice(0, 8);
      return `dsh-${id8}.md`;
    }

    // Metadata runs before the picker and must fit within user activation.
    const META_TIMEOUT_MS = 2000;
    const TOAST_HOLD_MS = 3000;
    const TOAST_ERROR_HOLD_MS = 6000;
    const TOAST_NAME_MAX = 60;

    // A missing composer leaves Toast at its default viewport position.
    function composerAnchor() {
      return document.querySelector('[data-composer-card]');
    }

    function truncateName(name) {
      const value = String(name ?? '');
      return value.length > TOAST_NAME_MAX ? `${value.slice(0, TOAST_NAME_MAX - 1)}…` : value;
    }

    const SUCCESS_COLOR = 'var(--dsw-alias-state-success-primary)';
    const ERROR_COLOR = 'var(--dsw-alias-state-error-primary)';

    function StatusGlyph({ tone = 'success' } = {}) {
      const failed = tone === 'error';
      const Glyph = failed ? AlertIcon : (HostCheckIcon ?? CheckIcon);
      return jsx('span', {
        style: { display: 'inline-flex', flex: 'none', color: failed ? ERROR_COLOR : SUCCESS_COLOR },
        children: jsx(Glyph, {}),
      });
    }

    function AlertIcon() {
      return jsxs('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.75,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        children: [
          jsx('circle', { cx: 8, cy: 8, r: 6 }),
          jsx('path', { d: 'M8 4.9v3.6' }),
          jsx('path', { d: 'M8 11.1h.01' }),
        ],
      });
    }

    function CheckIcon() {
      return jsx('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.75,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        children: jsx('path', { d: 'M3.5 8.5 6.5 11.5 12.5 5' }),
      });
    }

    /** Fetch only the suggested filename before the picker consumes user activation. */
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

    async function fetchExport(sessionId) {
      const response = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
      }
      return { response, markdown: await response.text() };
    }

    async function writeMarkdown(handle, markdown) {
      const writable = await handle.createWritable();
      try {
        await writable.write(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
        await writable.close();
      } catch (error) {
        // Discard a partial write; preserve the original error if abort also fails.
        try { await writable.abort(); } catch { /* Already closed or unavailable. */ }
        throw error;
      }
    }

    // The server percent-encodes Unicode filenames in X-Dsh-Filename.
    function serverFilename(response, fallback) {
      const encoded = response.headers.get('X-Dsh-Filename');
      if (encoded) {
        try {
          const decoded = decodeURIComponent(encoded);
          if (decoded.toLowerCase().endsWith('.md') && !/[\\/\u0000-\u001f]/.test(decoded)) return decoded;
        } catch {
          /* Use the metadata or fallback name. */
        }
      }
      return fallback;
    }

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
        return { handle: null, cancelled: false };
      }
    }

    function MdExportAction({ sessionId, t }) {
      const [state, setState] = React.useState({ status: 'idle', error: null });
      const [toast, setToast] = React.useState(null);
      const metaRef = React.useRef(null);
      // A fresh key replays Toast when consecutive saves have the same message.
      const toastSeqRef = React.useRef(0);
      // Block duplicate clicks before React has rendered disabled=true.
      const runningRef = React.useRef(false);
      const savedTimerRef = React.useRef(null);
      const mountedRef = React.useRef(true);

      React.useEffect(() => {
        mountedRef.current = true;
        return () => {
          mountedRef.current = false;
          if (savedTimerRef.current !== null) {
            clearTimeout(savedTimerRef.current);
            savedTimerRef.current = null;
          }
        };
      }, []);

      // Prewarm a fallback. A new session's title may be generated after mount,
      // so each export refreshes this snapshot before opening the picker.
      React.useEffect(() => {
        let alive = true;
        metaRef.current = null;
        fetchMeta(sessionId)
          .then((meta) => { if (alive) metaRef.current = meta; })
          .catch(() => { /* Retry on export. */ });
        return () => { alive = false; };
      }, [sessionId]);

      const busy = state.status === 'working';
      const label = busy ? t('busy')
        : state.status === 'error' ? t('failed')
          : state.status === 'done' ? t('done')
            : t('button');
      const hintId = `dsh-md-export-hint-${sessionId}`;

      const onExport = async () => {
        if (runningRef.current || !mountedRef.current) return;
        runningRef.current = true;
        if (savedTimerRef.current !== null) {
          clearTimeout(savedTimerRef.current);
          savedTimerRef.current = null;
        }
        setState({ status: 'working', error: null });

        try {
          // Refresh the suggested name; the mount-time title may be stale.
          let name = null;
          try {
            const meta = await fetchMeta(sessionId);
            metaRef.current = meta;
            name = meta?.filename ?? null;
          } catch {
            // Keep the cached suggestion if this request fails.
            name = metaRef.current?.filename ?? null;
          }
          name = name ?? fallbackName(sessionId);

          // Do not open a new dialog after this action has unmounted.
          if (!mountedRef.current) return;
          // Pick before fetching Markdown to preserve user activation.
          const { handle, cancelled } = await pickSaveHandle(name);
          if (cancelled) {
            if (mountedRef.current) setState({ status: 'idle', error: null });
            return;
          }

          const { response, markdown } = await fetchExport(sessionId);

          let savedName = name;
          if (handle) {
            await writeMarkdown(handle, markdown);
            // The user can rename the file in the picker.
            if (typeof handle.name === 'string' && handle.name !== '') savedName = handle.name;
          } else {
            savedName = serverFilename(response, name);
            downloadViaAnchor(markdown, savedName);
          }

          // Finish an already chosen file, but do not update an unmounted UI.
          if (!mountedRef.current) return;
          setState({ status: 'done', error: null });
          // Report the chosen filename, which may differ from the suggestion.
          toastSeqRef.current += 1;
          setToast({
            tone: 'success',
            text: t('savedAs').replace('{name}', truncateName(savedName)),
            seq: toastSeqRef.current,
          });
          savedTimerRef.current = setTimeout(() => {
            savedTimerRef.current = null;
            if (mountedRef.current && !runningRef.current) setState({ status: 'idle', error: null });
          }, SAVED_STATE_MS);
        } catch (error) {
          if (!mountedRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setState({ status: 'error', error: message });
          // Keep the failure reason visible without requiring a hover.
          toastSeqRef.current += 1;
          setToast({
            tone: 'error',
            text: message === '' ? t('failed') : `${t('failed')}: ${truncateName(message)}`,
            seq: toastSeqRef.current,
          });
        } finally {
          runningRef.current = false;
        }
      };

      const banner = toast === null || typeof Toast !== 'function'
        ? null
        : jsx(Toast, {
          text: toast.text,
          icon: jsx(StatusGlyph, { tone: toast.tone }),
          holdMs: toast.tone === 'error' ? TOAST_ERROR_HOLD_MS : TOAST_HOLD_MS,
          anchor: composerAnchor(),
          onDone: () => { if (mountedRef.current) setToast(null); },
        }, toast.seq);

      return jsxs(React.Fragment, {
        children: [
          jsxs('button', {
            type: 'button',
            className: 'dshMdExportAction',
            onClick: onExport,
            disabled: busy,
            'aria-describedby': hintId,
            children: [
              jsx(DownloadIcon, {}),
              label,
              jsx('span', { id: hintId, className: 'dshMdExportHint', children: [t('hint')] }),
            ],
          }),
          banner,
        ],
      });
    }

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
        label: locale.bind(LOCALE_NS)('button'),
        locale: LOCALE_NS,
      }, MdExportAction));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
