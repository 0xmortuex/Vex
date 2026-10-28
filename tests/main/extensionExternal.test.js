// externally_connectable (2026-10-28): a web page the manifest names (claude.ai, for the Claude extension) messages its extension with
// chrome.runtime.sendMessage(extensionId, message). Electron's own function always said "Receiving end does not exist", so Claude's side panel
// (a claude.ai frame inside the extension's page) printed "Can't reach the Claude extension". The page preload puts a working one on such a page;
// main hands the message to the extension's worker; the worker's onMessageExternal listeners answer.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const PAGE_SRC = read('preload-webview.js');
const MAIN = read('main.js');
const ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';

function worker(manifest) {
  const calls = [];
  const listeners = [];
  const chrome = { runtime: { id: ID, getManifest: () => manifest, getURL: (p) => 'chrome-extension://' + ID + '/' + p }, tabs: { query: () => Promise.resolve([]) } };
  const ipcRenderer = {
    invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(ch === 'extensions:active-tabs' ? { ids: [], current: null } : null); },
    on: (ch, fn) => { if (ch === 'extensions:event') listeners.push(fn); },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  vm.runInContext(SW_SRC, ctx);
  const replies = () => calls.filter(x => x[0] === 'extensions:api' && x[1].op === 'external.reply').map(x => x[1].args);
  return { c: chrome, replies, deliver: (requestId, message, sender) => listeners.forEach(fn => fn({}, { type: 'external.message', args: [requestId, message, sender] })) };
}
const CLAIMING = { permissions: ['storage'], externally_connectable: { matches: ['https://claude.ai/*'] } };

describe('the worker side: runtime.onMessageExternal', () => {
  it('is there only for an extension whose manifest has externally_connectable', () => {
    const plain = worker({ permissions: ['storage'] });
    expect(plain.c.runtime.onMessageExternal).toBeUndefined();
    expect(typeof worker(CLAIMING).c.runtime.onMessageExternal.addListener).toBe('function');
  });
  it('a listener that answers at once: the reply goes to main with the request id', () => {
    const w = worker(CLAIMING);
    const heard = [];
    w.c.runtime.onMessageExternal.addListener((m, s, reply) => { heard.push([m, s.origin]); reply({ ok: 1 }); });
    w.deliver('r1', { type: 'ping' }, { origin: 'https://claude.ai', url: 'https://claude.ai/x' });
    expect(heard).toEqual([[{ type: 'ping' }, 'https://claude.ai']]);
    expect(w.replies()).toEqual([{ requestId: 'r1', response: { ok: 1 } }]);
  });
  it('a listener that returns true answers later, and nothing is closed meanwhile', async () => {
    const w = worker(CLAIMING);
    w.c.runtime.onMessageExternal.addListener((m, s, reply) => { setTimeout(() => reply('late'), 5); return true; });
    w.deliver('r2', 1, {});
    expect(w.replies()).toEqual([]);
    await new Promise(r => setTimeout(r, 20));
    expect(w.replies()).toEqual([{ requestId: 'r2', response: 'late' }]);
  });
  it('no listener answers and none returned true: the port is closed (the page sees Chrome\'s words)', () => {
    const w = worker(CLAIMING);
    w.c.runtime.onMessageExternal.addListener(() => {});
    w.deliver('r3', 1, {});
    expect(w.replies()).toEqual([{ requestId: 'r3', closed: true }]);
    const none = worker(CLAIMING);
    none.deliver('r4', 1, {});
    expect(none.replies()).toEqual([{ requestId: 'r4', closed: true }]);
  });
  it('the first answer wins and a second is ignored', () => {
    const w = worker(CLAIMING);
    w.c.runtime.onMessageExternal.addListener((m, s, reply) => { reply('first'); reply('second'); });
    expect(() => w.deliver('r5', 1, {})).not.toThrow();
    expect(w.replies()).toEqual([{ requestId: 'r5', response: 'first' }]);
  });
});

// The page side: vexExternalShim, run the way executeInMainWorld runs it.
function pageShim(send) {
  const m = /function vexExternalShim\(ids, send\) \{[\s\S]*?\n\}\n/.exec(PAGE_SRC);
  expect(m).toBeTruthy();
  const native = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  const win = { chrome: { runtime: { sendMessage: native } } };
  win.window = win;
  const ctx = vm.createContext({ window: win, Promise, JSON, Object, String, Error, TypeError, console });
  vm.runInContext('(' + m[0].trim().replace(/^function vexExternalShim/, 'function') + ')', ctx)([ID], send);
  return win.chrome.runtime;
}
describe('the page side: chrome.runtime.sendMessage on a page the manifest names', () => {
  it('takes the place of Electron\'s own and sends the extension id and the message to main', async () => {
    const sent = [];
    const rt = pageShim((id, message) => { sent.push([id, message]); return Promise.resolve({ value: { answer: 1 } }); });
    expect(await rt.sendMessage(ID, { a: 1 })).toEqual({ answer: 1 });
    expect(sent).toEqual([[ID, { a: 1 }]]);
  });
  it('with a callback; a failure is lastError during the callback, in Chrome\'s words, and the wrapping of the IPC error is removed', async () => {
    const rt = pageShim((id) => Promise.reject(new Error("Error invoking remote method 'extensions:external-message': Error: Could not establish connection. Receiving end does not exist.")));
    const seen = await new Promise((resolve) => rt.sendMessage(ID, { a: 1 }, (v) => resolve({ v, err: rt.lastError && rt.lastError.message })));
    expect(seen).toEqual({ v: undefined, err: 'Could not establish connection. Receiving end does not exist.' });
    expect(rt.lastError).toBeUndefined();
  });
  it('without an extension id it is the TypeError Chrome throws', () => {
    const rt = pageShim(() => Promise.resolve({}));
    expect(() => rt.sendMessage({ a: 1 })).toThrow(TypeError);
  });
});

describe('main', () => {
  it('judges the page from the asking frame\'s own address, refuses private pages, and keeps the answer for the extension that was asked', () => {
    expect(MAIN).toMatch(/ipcMain\.on\('extensions:external-ids', \(event\) => \{[\s\S]*?_extPageIsPrivate\(event\.sender\)[\s\S]*?_extExternalTargets\(event\.sender\.session, event\.senderFrame && event\.senderFrame\.url\)/);
    expect(MAIN).toMatch(/ipcMain\.handle\('extensions:external-message'[\s\S]*?_extExternalTargets\(ses, frameUrl\)\.find\(e => e\.id === request\.id\)/);
    expect(MAIN).toMatch(/case 'external\.reply': \{[\s\S]*?p\.extId !== extId\) return undefined;/);
  });
  it('a frame inside an extension page has no tab; the side panel webview is the one that gets the page preloads in its frames', () => {
    expect(MAIN).toMatch(/if \(!event\.senderFrame \|\| !event\.senderFrame\.parent\) sender\.tab = _extTabFor\(ext, event\.sender\);/);
    const security = read('main/session-security.js');
    expect(security).toMatch(/prefs\.nodeIntegrationInSubFrames = !!extPanel && \/\^chrome-extension:/);
    expect(read('renderer/js/ext-sidepanel.js')).toContain("'contextIsolation=yes,vexExtPanel=yes'");
  });
  it('the two channels are open to a page (guest) and checked by schema', () => {
    expect(read('main/ipc-policy.js')).toMatch(/GUEST_CHANNELS = new Set\(\['extensions:external-ids', 'extensions:external-message'/);
    expect(read('main/ipc-schemas.js')).toMatch(/define\('extensions:external-message'/);
  });
});
