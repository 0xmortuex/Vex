// @vitest-environment node
//
// chrome.windows, chrome.notifications and chrome.downloads were absent: an
// extension reading one threw, or (with a guard) did nothing (found
// 2026-10-10). Main answers them from Vex's windows, its Windows
// notifications and its downloads.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { createExtensionDownloads } = req('../../src/main/extension-downloads.js');
const { createNotifier } = req('../../src/main/notify.js');
const SW_SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

function worker(manifest, answer) {
  const asked = [];
  const ipcRenderer = {
    invoke: (ch, r) => { asked.push(r); if (ch !== 'extensions:api') return Promise.resolve(ch === 'extensions:active-tabs' ? { ids: [], current: null } : null); try { return Promise.resolve(answer(r)); } catch (e) { return Promise.reject(e); } },
    on: () => {},
  };
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest, getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p },
    tabs: { query: async (q) => [{ id: 4, windowId: 1, index: 0, q }], get: async () => null },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: () => ({ ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } }) });
  vm.runInContext(SW_SRC, ctx);
  return { c: chrome, asked };
}

describe('chrome.windows', () => {
  it('asks main, and fills in the tabs when asked to', async () => {
    const w = worker({}, (r) => (r.op === 'windows.getCurrent' ? { id: 1, type: 'normal' } : null));
    expect(w.c.windows.WINDOW_ID_CURRENT).toBe(-2);
    const win = await w.c.windows.getCurrent({ populate: true });
    expect(win.id).toBe(1);
    expect(win.tabs.map(t => [t.id, t.windowId])).toEqual([[4, 1]]);
    await expect(w.c.windows.remove(1)).rejects.toThrow(/close a window/);
  });
  it('main lists Vex\'s windows but never a private one, and a new window is a tab', () => {
    expect(MAIN).toMatch(/filter\(h => !h\.privatePartition && h\.win && !h\.win\.isDestroyed\(\)\)/);
    expect(MAIN).toMatch(/for \(const url of urls\) await _openTabForExtension\(senderUrl, ses, \{ url, active: data\.focused !== false \}\);/);
  });
});

describe('chrome.notifications', () => {
  it('only with the permission, through main', async () => {
    expect(worker({}, () => null).c.notifications).toBeUndefined();
    const w = worker({ permissions: ['notifications'] }, (r) => (r.op === 'notifications.create' ? r.args.id || 'gen' : null));
    expect(await w.c.notifications.create('n1', { title: 't', message: 'm' })).toBe('n1');
    expect(await w.c.notifications.create({ title: 't', message: 'm' })).toBe('gen');
  });
  it('a toast\'s own click goes to its extension, not to every toast\'s handler', async () => {
    const handlers = {};
    class N { constructor(o) { this.o = o; } on(ev, fn) { handlers[ev] = fn; } show() { handlers.show(); } static isSupported() { return true; } }
    const global = vi.fn(), own = vi.fn();
    const notifier = createNotifier({ Notification: N, onClick: global });
    await notifier.show({ title: 'x', onClick: own });
    handlers.click();
    expect(own).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
  it('main says which extension sent it', () => {
    expect(MAIN).toMatch(/From the extension \$\{name\}/);
  });
});

describe('chrome.downloads', () => {
  it('follows Vex\'s downloads as Chrome describes them, with onCreated and onChanged', () => {
    let t = 1000;
    const d = createExtensionDownloads({ now: () => t });
    const made = d.note('download-started', { id: 'dl_1', url: 'https://a.example/f.zip', path: 'C:\\D\\f.zip', totalBytes: 0 });
    expect(made.event).toBe('downloads.onCreated');
    expect(made.args[0]).toMatchObject({ id: 1, url: 'https://a.example/f.zip', state: 'in_progress', totalBytes: -1 });
    expect(d.note('download-progress', { id: 'dl_1', receivedBytes: 10, totalBytes: 0, paused: false, canResume: false, state: 'progressing' })).toBe(null);
    expect(d.note('download-progress', { id: 'dl_1', receivedBytes: 10, totalBytes: 0, paused: true, canResume: true, state: 'progressing' }).args[0])
      .toEqual({ id: 1, paused: { previous: false, current: true }, canResume: { previous: false, current: true } });
    t = 2000;
    const done = d.note('download-complete', { id: 'dl_1', state: 'completed', path: 'C:\\D\\f (1).zip', receivedBytes: 50 });
    expect(done.args[0].state).toEqual({ previous: 'in_progress', current: 'complete' });
    expect(done.args[0].filename).toEqual({ previous: 'C:\\D\\f.zip', current: 'C:\\D\\f (1).zip' });
    expect(d.search({ state: 'complete' }).map(i => [i.id, i.bytesReceived, i.fileSize])).toEqual([[1, 50, 50]]);
    expect(d.vexIdOf(1)).toBe('dl_1');
    expect(() => d.vexIdOf(9)).toThrow(/Invalid download id/);
  });
  it('download() answers the id once the download starts', async () => {
    const d = createExtensionDownloads();
    const id = d.waitFor('https://a.example/x', 1000);
    d.note('download-started', { id: 'dl_9', url: 'https://a.example/x', path: 'x' });
    expect(await id).toBe(1);
    await expect(d.waitFor('https://never.example/', 10)).rejects.toThrow(/did not start/);
  });
  it('download() answers for an address that redirects, and url/finalUrl say both ends (found 2026-10-11)', async () => {
    const d = createExtensionDownloads();
    const id = d.waitFor('https://a.example/get?file=1', 1000);
    // The panel hears the address the file came from in the end; the item
    // knows every address it went through.
    const made = d.note('download-started', { id: 'dl_r', url: 'https://cdn.example/f.zip', path: 'f.zip' },
      ['https://a.example/get?file=1', 'https://cdn.example/f.zip']);
    expect(await id).toBe(1);
    expect(made.args[0]).toMatchObject({ url: 'https://a.example/get?file=1', finalUrl: 'https://cdn.example/f.zip' });
    expect(MAIN).toMatch(/_extDownloads\.note\(channel, data, /);
  });
  it('the stand-in offers what main does and refuses the rest', async () => {
    const w = worker({ permissions: ['downloads'] }, (r) => (r.op === 'downloads.search' ? [] : 7));
    expect(await w.c.downloads.download({ url: 'https://a.example/x' })).toBe(7);
    await expect(w.c.downloads.removeFile(1)).rejects.toThrow(/delete a downloaded file/);
    expect(MAIN).toMatch(/_extDownloadEvent\(channel, data\);/);
  });
});
