// The Claude extension's worker asks for its feature flags without the two headers its pages send (anthropic-client-platform, anthropic-client-version).
// The server answers chrome_ext_cowork_iframe true for the request with both and false for the one without, and both write one cache, so the worker's
// answer turned the panel's claude.ai frame off and its check then refused the panel's messages ("anchor tab group not established"), 2026-10-28.
// The stand-ins add the two headers to that one request when they are missing, and touch nothing else.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';

function worker(manifest = { version: '1.0.76', permissions: ['storage'] }) {
  const sent = [];
  const fakeFetch = function (input, init) { sent.push({ input, headers: init && init.headers ? Object.fromEntries(typeof init.headers.entries === 'function' ? [...init.headers.entries()] : Object.entries(init.headers)) : null }); return Promise.resolve({ ok: true }); };
  const chrome = { runtime: { id: ID, getManifest: () => manifest, getURL: (p) => 'chrome-extension://' + ID + '/' + p }, tabs: { query: () => Promise.resolve([]) } };
  const ipcRenderer = { invoke: () => Promise.resolve(null), on: () => {} };
  const ctx = vm.createContext({ chrome, fetch: fakeFetch, Headers, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  ctx.globalThis = ctx;
  vm.runInContext(SW_SRC, ctx);
  return { sent, fetch: (...a) => vm.runInContext('fetch', ctx)(...a) };
}
const FLAGS = 'https://api.anthropic.com/api/bootstrap/features/claude_in_chrome';

describe('the feature-flag request of the extension\'s worker', () => {
  it('gets the extension\'s two client headers when it has none, and keeps its own', async () => {
    const w = worker();
    await w.fetch(FLAGS, { headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' } });
    expect(w.sent[0].headers).toMatchObject({ authorization: 'Bearer x', 'content-type': 'application/json', 'anthropic-client-platform': 'claude_browser_extension', 'anthropic-client-version': '1.0.76' });
  });
  it('a request that already has them is left alone', async () => {
    const w = worker();
    await w.fetch(FLAGS, { headers: { Authorization: 'Bearer x', 'anthropic-client-platform': 'claude_browser_extension', 'anthropic-client-version': '9.9.9' } });
    expect(w.sent[0].headers['anthropic-client-version']).toBe('9.9.9');
  });
  it('every other address is untouched', async () => {
    const w = worker();
    await w.fetch('https://api.anthropic.com/api/oauth/profile', { headers: { Authorization: 'Bearer x' } });
    await w.fetch('https://example.com/api/bootstrap/features/x', { headers: { a: 'b' } });
    await w.fetch('https://claude.ai/api/bootstrap/features/claude_in_chrome');
    expect(w.sent.every(s => !s.headers || !('anthropic-client-platform' in s.headers))).toBe(true);
  });
});
