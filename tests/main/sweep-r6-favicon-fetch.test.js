// A tab's icon is drawn in Vex's own window, whose session is direct, so a
// Tor, proxy or container tab's site saw the real address every time the
// strip drew its icon (found 2026-09-30). Such a tab's icon is fetched in main
// through the tab's OWN session and handed back as a data: URL
// (src/main/favicon-fetch.js); the renderer asks by the page's id
// (tabs:favicon), which must belong to the asking window.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
const { createFaviconFetch, sniffImage } = require('../../src/main/favicon-fetch.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);

// One guest page per id, each with a session of its own.
function setup(fetchImpl, { type = 'webview', destroyed = false } = {}) {
  const fetch = vi.fn(fetchImpl);
  const guest = { isDestroyed: () => destroyed, getType: () => type, session: { fetch } };
  const other = { isDestroyed: () => false, getType: () => 'webview', session: { fetch: vi.fn() } };
  const webContents = { fromId: (id) => (id === 7 ? guest : id === 8 ? other : null) };
  return { fetch, other, fi: createFaviconFetch({ webContents, timeoutMs: 200, maxBytes: 1024 }) };
}
const answer = (body, headers = {}, status = 200) => async () => new Response(body, { status, headers });

describe('a tab icon fetched through the tab\'s own session', () => {
  it('goes through that page\'s session only, and comes back as a data: URL', async () => {
    const { fetch, other, fi } = setup(answer(PNG, { 'content-type': 'image/png' }));
    const r = await fi.fetchIcon(7, 'https://site.test/favicon.ico');
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/png;base64,' + PNG.toString('base64') });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://site.test/favicon.ico');
    expect(other.session.fetch).not.toHaveBeenCalled();
  });

  it('knows an icon a server labels as anything, by its bytes', async () => {
    const { fi } = setup(answer(ICO, { 'content-type': 'application/octet-stream' }));
    const r = await fi.fetchIcon(7, 'https://site.test/favicon.ico');
    expect(r.ok).toBe(true);
    expect(r.dataUrl.startsWith('data:image/x-icon;base64,')).toBe(true);
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImage(Buffer.from('<html>no</html>'))).toBe('');
  });

  it('refuses what is not a picture, and says the site answered', async () => {
    const { fi } = setup(answer('<html>login</html>', { 'content-type': 'text/html' }));
    expect(await fi.fetchIcon(7, 'https://site.test/favicon.ico')).toMatchObject({ ok: false, answered: true });
    const missing = setup(answer('nope', {}, 404));
    expect(await missing.fi.fetchIcon(7, 'https://site.test/favicon.ico')).toMatchObject({ ok: false, answered: true, error: 'the site answered 404' });
  });

  it('refuses an icon too large, declared or streamed', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
    const declared = setup(answer(big, { 'content-type': 'image/png', 'content-length': String(big.length) }));
    expect(await declared.fi.fetchIcon(7, 'https://site.test/i.png')).toMatchObject({ ok: false, error: 'the icon is too large' });
    const streamed = setup(answer(big, { 'content-type': 'image/png' }));
    expect(await streamed.fi.fetchIcon(7, 'https://site.test/i.png')).toMatchObject({ ok: false, error: 'the icon is too large' });
  });

  // Tor down or the proxy refusing: no icon, and not taken as "the site has none".
  it('gives no icon when the session refuses, and marks it worth asking again', async () => {
    const { fi } = setup(async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED'); });
    expect(await fi.fetchIcon(7, 'https://site.test/favicon.ico')).toEqual({ ok: false, answered: false, error: 'net::ERR_PROXY_CONNECTION_FAILED' });
  });

  it('gives up at its deadline', async () => {
    const { fi } = setup((_url, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
    expect(await fi.fetchIcon(7, 'https://slow.test/favicon.ico')).toEqual({ ok: false, answered: false, error: 'timeout' });
  });

  it('fetches only web addresses, only for a tab that is there', async () => {
    const { fetch, fi } = setup(answer(PNG, { 'content-type': 'image/png' }));
    expect((await fi.fetchIcon(7, 'file:///C:/secret.png')).ok).toBe(false);
    expect((await fi.fetchIcon(7, 'not a url')).ok).toBe(false);
    expect((await fi.fetchIcon(99, 'https://site.test/favicon.ico')).error).toBe('That tab is gone');
    expect(fetch).not.toHaveBeenCalled();
    const win = setup(answer(PNG), { type: 'window' });
    expect((await win.fi.fetchIcon(7, 'https://site.test/favicon.ico')).error).toBe('That is not a tab');
    expect(win.fetch).not.toHaveBeenCalled();
    const gone = setup(answer(PNG), { destroyed: true });
    expect((await gone.fi.fetchIcon(7, 'https://site.test/favicon.ico')).error).toBe('That tab is gone');
  });
});

describe('tabs:favicon', () => {
  it('takes a page id and a web address', () => {
    expect(() => validate('tabs:favicon', [7, 'https://site.test/favicon.ico'])).not.toThrow();
    expect(() => validate('tabs:favicon', ['7', 'https://site.test/favicon.ico'])).toThrow();
    expect(() => validate('tabs:favicon', [7, 'file:///C:/x.ico'])).toThrow();
    expect(() => validate('tabs:favicon', [7])).toThrow();
  });

  it('refuses a page that belongs to another window, and a page asking', async () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    let owns = false, ui = true;
    installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => ({}), isAuxiliary: () => false, ownsTarget: () => owns });
    ipcMain.handle('tabs:favicon', () => 'fetched');
    const call = () => handlers.get('tabs:favicon')({ sender: {}, senderFrame: { url: 'file:///x/index.html' } }, 7, 'https://site.test/favicon.ico');
    await expect(call()).rejects.toThrow('Target belongs to another window');
    owns = true;
    expect(await call()).toBe('fetched');
    ui = false;   // a guest page is not Vex's window
    await expect(call()).rejects.toThrow('Untrusted IPC sender');
  });

  it('is answered in main by the fetch through the tab\'s session', () => {
    const main = fs.readFileSync('src/main.js', 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('tabs:favicon', \(_e, guestId, url\) => _faviconFetch\.fetchIcon\(guestId, url\)\)/);
    expect(fs.readFileSync('src/preload.js', 'utf8')).toMatch(/tabFavicon: +\(pageId, url\) => ipcRenderer\.invoke\('tabs:favicon', pageId, url\)/);
  });
});
