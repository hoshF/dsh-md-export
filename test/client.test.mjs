/**
 * Client save-flow tests over the shipped loader module, with React hooks and
 * the host slot locale contract supplied by a small mock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const SESSION_ID = 'session-client-fixture';
const MARKDOWN = '## Conversation\n\nSynthetic conversation.\n';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Drain the promises used by fetch, picker, Blob.text(), and hook rerenders.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function createClient({ meta, content, picker, supportsPicker = true, language = 'en' } = {}) {
  const requests = [];
  const pickerCalls = [];
  const writes = [];
  const downloads = [];
  const hooks = [];
  const effects = [];
  const timers = new Map();
  const urls = new Map();
  let nextTimer = 0;
  let now = 0;
  let hookIndex = 0;
  let renderAction;
  let slotDefinition;
  let tree;
  let mounted = true;
  let renderQueued = false;
  let updatesAfterUnmount = 0;
  let closes = 0;
  let aborts = 0;

  const makeHandle = (name = 'Chosen by user.md', write = async () => {}) => ({
    name,
    async createWritable() {
      return {
        async write(blob) {
          await write(blob);
          writes.push({ name, markdown: await blob.text() });
        },
        async close() { closes += 1; },
        async abort() { aborts += 1; },
      };
    },
  });

  function render() {
    hookIndex = 0;
    tree = renderAction({ sessionId: SESSION_ID, t: ctx.locale.bind(slotDefinition.locale) });
    while (effects.length > 0) effects.shift()();
  }

  const React = {
    Fragment: 'fragment',
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (value) => {
        if (!mounted) { updatesAfterUnmount += 1; return; }
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
        if (renderQueued) return;
        renderQueued = true;
        queueMicrotask(() => {
          renderQueued = false;
          if (mounted) render();
        });
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (previous && Array.isArray(dependencies) && dependencies.length === previous.dependencies?.length
        && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      const current = { dependencies, cleanup: null };
      hooks[index] = current;
      effects.push(() => {
        previous?.cleanup?.();
        current.cleanup = effect();
      });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dictionaries = new Map();
  const ctx = {
    locale: {
      register(namespace, dictionary) { dictionaries.set(namespace, dictionary); },
      bind(namespace) { return (key) => dictionaries.get(namespace)[language][key]; },
    },
    effect(effect) { effect(); },
    slots: {
      inject(_slot, effect) { effect(); },
      register(definition, action) { slotDefinition = definition; renderAction = action; },
    },
  };
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        factory((name) => {
          if (name === 'react') return React;
          if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
          if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Toast: function Toast() {} };
          throw new Error(`unexpected module: ${name}`);
        }).apply(ctx);
      },
    },
  };
  if (supportsPicker) {
    window.showSaveFilePicker = async (options) => {
      pickerCalls.push(options);
      return picker ? picker(options, makeHandle) : makeHandle();
    };
  }

  vm.runInNewContext(source, {
    window, React, AbortController, Blob,
    document: {
      querySelector() { return null; },
      head: { appendChild() {} },
      body: { appendChild() {} },
      createElement() {
        return {
          dataset: {},
          click() { downloads.push({ filename: this.download, blob: urls.get(this.href) }); },
          remove() {},
        };
      },
    },
    URL: {
      createObjectURL(blob) { const url = `blob:fixture-${urls.size}`; urls.set(url, blob); return url; },
      revokeObjectURL(url) { urls.delete(url); },
    },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, { signal } = {}) {
      const parsed = new URL(url, 'http://localhost');
      const metadata = parsed.searchParams.has('meta');
      requests.push({ metadata, sessionId: parsed.searchParams.get('sessionId') });
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (metadata) {
        const value = meta ? await meta() : { filename: 'Suggested.md' };
        return { ok: true, json: async () => value };
      }
      const value = content ? await content() : MARKDOWN;
      return {
        ok: true,
        text: async () => value,
        headers: { get: (name) => name === 'X-Dsh-Filename' ? encodeURIComponent('服务器建议.md') : null },
      };
    },
  }, { filename: 'lib/client.js' });
  render();

  return {
    requests, pickerCalls, writes, downloads,
    get slotDefinition() { return slotDefinition; },
    get button() { return tree.props.children[0].props; },
    get toast() { return tree.props.children[1]?.props ?? null; },
    get closes() { return closes; },
    get aborts() { return aborts; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    setLanguage(value) {
      language = value;
      if (mounted) render();
    },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await settle();
      }
      now = end;
      await settle();
    },
    unmount() {
      mounted = false;
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

test('slot locale injection updates English and Chinese labels and hints without remounting', async () => {
  const client = createClient();
  await settle();
  assert.equal(client.slotDefinition.locale, 'dsh-md-export');
  assert.equal(client.slotDefinition.label, 'Export MD');
  assert.equal(client.button.children[1], 'Export MD');
  assert.equal(client.button.children[2].props.children[0],
    'Export this conversation as Markdown (opens the system save dialog)');

  client.setLanguage('zh');
  assert.equal(client.button.children[1], '导出 MD');
  assert.equal(client.button.children[2].props.children[0], '把当前会话导出为 Markdown（弹出系统保存窗口）');
  client.setLanguage('en');
  assert.equal(client.button.children[1], 'Export MD');
  assert.equal(client.button.children[2].props.children[0],
    'Export this conversation as Markdown (opens the system save dialog)');
  await settle();
  assert.equal(client.requests.length, 1, 'a language update reran the mount-time metadata request');
  assert.equal(client.pickerCalls.length, 0);
});

test('language changes preserve the pending save and its duplicate-click lock', async () => {
  const pending = deferred();
  const client = createClient({ content: () => pending.promise });
  await settle();
  const save = client.button.onClick();
  await settle();
  assert.equal(client.button.children[1], 'Exporting…');
  assert.equal(client.button.disabled, true);

  client.setLanguage('zh');
  assert.equal(client.button.children[1], '导出中…');
  assert.equal(client.button.disabled, true);
  await client.button.onClick();
  client.setLanguage('en');
  assert.equal(client.button.children[1], 'Exporting…');
  assert.equal(client.button.disabled, true);
  await client.button.onClick();
  assert.equal(client.pickerCalls.length, 1);
  assert.equal(client.requests.length, 3, 'a language update restarted metadata or content loading');

  pending.resolve(MARKDOWN);
  await save;
  await settle();
  assert.equal(client.writes.length, 1);
  assert.equal(client.closes, 1);
  assert.equal(client.button.children[1], 'Saved');
  assert.equal(client.button.disabled, false);
  assert.equal(client.toast.text, 'Saved Chosen by user.md');
  client.setLanguage('zh');
  assert.equal(client.button.children[1], '已保存');
});

test('save uses fresh metadata, fetches content after the picker, and reports the chosen name', async () => {
  let metadataReads = 0;
  const client = createClient({
    meta: async () => ({ filename: ++metadataReads === 1 ? 'Untitled.md' : 'Latest title.md' }),
    picker: async (options, makeHandle) => {
      assert.equal(client.requests.filter((request) => !request.metadata).length, 0);
      return makeHandle('Renamed by user.md');
    },
  });
  await settle();
  await client.button.onClick();
  await settle();

  assert.equal(client.pickerCalls[0].suggestedName, 'Latest title.md');
  assert.deepEqual(client.writes, [{ name: 'Renamed by user.md', markdown: MARKDOWN }]);
  assert.equal(client.closes, 1);
  assert.equal(client.aborts, 0);
  assert.equal(client.button.disabled, false);
  assert.equal(client.toast.text, 'Saved Renamed by user.md');
  await client.advance(1600);
  assert.equal(client.button.children[1], 'Export MD');
});

test('queued repeated clicks start only one save operation', async () => {
  const client = createClient();
  await settle();
  const click = client.button.onClick;
  await Promise.all([click(), click()]);
  await settle();

  assert.equal(client.pickerCalls.length, 1);
  assert.equal(client.requests.filter((request) => !request.metadata).length, 1);
  assert.equal(client.writes.length, 1);
});

test('an earlier success timer cannot enable the button during another save', async () => {
  const pending = deferred();
  let contentReads = 0;
  const client = createClient({ content: () => ++contentReads === 1 ? MARKDOWN : pending.promise });
  await settle();
  await client.button.onClick();
  await settle();
  const nextSave = client.button.onClick();
  await settle();
  assert.equal(client.button.disabled, true);

  await client.advance(1600);
  assert.equal(client.button.disabled, true, 'the old completion timer unlocked a pending save');
  assert.equal(client.button.children[1], 'Exporting…');
  await client.button.onClick();
  assert.equal(client.pickerCalls.length, 2, 'a third save started while the second was still pending');
  pending.resolve(MARKDOWN);
  await nextSave;
});

test('cancelling the picker skips content and permits a later save', async () => {
  let pickerReads = 0;
  const client = createClient({
    picker: async (_options, makeHandle) => {
      if (++pickerReads === 1) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      return makeHandle();
    },
  });
  await settle();
  await client.button.onClick();
  await settle();
  assert.equal(client.requests.filter((request) => !request.metadata).length, 0);
  assert.equal(client.downloads.length, 0);
  assert.equal(client.toast, null);
  assert.equal(client.button.disabled, false);
  assert.equal(client.button.children[1], 'Export MD');

  await client.button.onClick();
  assert.equal(client.writes.length, 1);
});

test('a failed write aborts the writable, reports the reason, and permits retry', async () => {
  let pickerReads = 0;
  const client = createClient({
    picker: async (_options, makeHandle) => makeHandle('Chosen.md', async () => {
      if (pickerReads++ === 0) throw new Error('disk full');
    }),
  });
  await settle();
  await client.button.onClick();
  await settle();
  assert.equal(client.aborts, 1);
  assert.equal(client.closes, 0);
  assert.equal(client.writes.length, 0);
  assert.equal(client.button.disabled, false);
  assert.equal(client.button.children[1], 'Export failed');
  assert.match(client.toast.text, /disk full/);

  await client.button.onClick();
  assert.equal(client.writes.length, 1);
  assert.equal(client.closes, 1);
});

test('unmounting clears delayed success UI updates', async () => {
  const client = createClient();
  await settle();
  await client.button.onClick();
  await settle();
  const staleClick = client.button.onClick;
  const finishToast = client.toast.onDone;
  client.unmount();
  await staleClick();
  finishToast();
  await client.advance(1600);
  assert.equal(client.pickerCalls.length, 1, 'an obsolete click opened another save window');
  assert.equal(client.updatesAfterUnmount, 0);
});

test('a save completing after unmount does not update the removed UI', async () => {
  const pending = deferred();
  const client = createClient({ content: () => pending.promise });
  await settle();
  const save = client.button.onClick();
  await settle();
  client.unmount();
  pending.resolve(MARKDOWN);
  await save;
  await client.advance(1600);
  assert.deepEqual(client.writes, [{ name: 'Chosen by user.md', markdown: MARKDOWN }]);
  assert.equal(client.updatesAfterUnmount, 0);
});

test('hosts without a save picker download with the response filename', async () => {
  const client = createClient({ supportsPicker: false });
  await settle();
  await client.button.onClick();
  await settle();
  assert.equal(client.downloads.length, 1);
  assert.equal(client.downloads[0].filename, '服务器建议.md');
  assert.equal(await client.downloads[0].blob.text(), MARKDOWN);
  assert.equal(client.toast.text, 'Saved 服务器建议.md');
});
