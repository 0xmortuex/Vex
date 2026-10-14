// @vitest-environment jsdom
//
// The hidden-tab read for a watched page that builds itself with JavaScript.
// The window is a fake: what is tested is what is refused, what is bounded,
// what is read, and that the window is always closed.

import { describe, it, expect, vi } from 'vitest';
const { createPageRender, readerScript } = require('../../src/main/page-render.js');
const { isPrivateHost } = require('../../src/renderer/js/private-address.js');

function fakeWindow({ status = 200, result = { found: true, text: 'Price\n$299', title: 'Card' }, loadFails = null, hang = false } = {}) {
  const wins = [];
  class FakeWindow {
    constructor(opts) {
      this.opts = opts; this.destroyed = false;
      this.handlers = {};
      this.webContents = {
        setAudioMuted: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: (ev, fn) => { this.handlers[ev] = fn; },
        loadURL: vi.fn(async (u) => {
          if (hang) return new Promise(() => {});
          if (loadFails) throw new Error(loadFails);
          this.handlers['did-navigate']?.({}, u, status);
        }),
        executeJavaScript: vi.fn(async () => result),
        getURL: () => 'https://shop.example/card',
      };
      wins.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  return { FakeWindow, wins };
}

const make = (over = {}, win = {}) => {
  const f = fakeWindow(win);
  const headers = over.headers || { 'content-type': 'text/html; charset=utf-8' };
  const session = { fetch: vi.fn(async () => ({ headers: { get: (k) => headers[k.toLowerCase()] || null } })) };
  const r = createPageRender({
    BrowserWindow: f.FakeWindow, getSession: () => session, scriptsOff: () => false, isPrivateHost,
    timeoutMs: 200, settleMs: 1, wait: (ms) => new Promise(res => setTimeout(res, ms)), ...over.deps,
  });
  return { r, session, ...f };
};

describe('reading a page through a hidden window', () => {
  it('loads it once, in the given session, without a way for anything to be clicked, and reads the text', async () => {
    const { r, wins, session } = make();
    const out = await r.render('https://shop.example/card', { selector: '.price' });
    expect(out).toMatchObject({ found: true, text: 'Price\n$299', title: 'Card' });
    expect(wins).toHaveLength(1);
    const o = wins[0].opts;
    expect(o).toMatchObject({ show: false, focusable: false });
    expect(o.webPreferences).toMatchObject({ session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    expect(wins[0].webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(wins[0].destroyed).toBe(true);
  });

  it('refuses the home network, a non-web address, and a site with JavaScript off', async () => {
    const { r, wins } = make({ deps: { scriptsOff: (u) => /nojs\.example/.test(u) } });
    await expect(r.render('http://192.168.1.1/')).rejects.toThrow(/read directly/);
    await expect(r.render('http://localhost:3000/')).rejects.toThrow(/read directly/);
    await expect(r.render('file:///c:/x')).rejects.toThrow(/Only a web page/);
    await expect(r.render('https://nojs.example/')).rejects.toThrow(/JavaScript is switched off/);
    expect(wins).toHaveLength(0);
  });

  it('refuses a download or a file before loading it', async () => {
    const zip = make({ headers: { 'content-type': 'application/zip' } });
    await expect(zip.r.render('https://x.example/a.zip')).rejects.toThrow(/application\/zip, not a page/);
    const att = make({ headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=a.html' } });
    await expect(att.r.render('https://x.example/a')).rejects.toThrow(/download/);
    expect(zip.wins).toHaveLength(0);
    expect(att.wins).toHaveLength(0);
  });

  it('says an HTTP error and closes the window', async () => {
    const { r, wins } = make({}, { status: 503 });
    await expect(r.render('https://shop.example/card')).rejects.toThrow(/HTTP 503 from shop.example/);
    expect(wins[0].destroyed).toBe(true);
  });

  it('a load that fails or hangs is bounded and closed', async () => {
    const bad = make({}, { loadFails: 'ERR_NAME_NOT_RESOLVED' });
    await expect(bad.r.render('https://nowhere.example/')).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    expect(bad.wins[0].destroyed).toBe(true);
    const slow = make({}, { hang: true });
    await expect(slow.r.render('https://slow.example/')).rejects.toThrow(/took too long/);
    expect(slow.wins[0].destroyed).toBe(true);
  });

  it('a part that is not there comes back as not found, not as an error', async () => {
    const { r } = make({}, { result: { found: false, text: '', title: 'Card' } });
    expect(await r.render('https://shop.example/card', { selector: '.gone' })).toMatchObject({ found: false, text: '' });
  });

  it('an invalid selector is said', async () => {
    const { r } = make({}, { result: { invalid: true, found: false, text: '', title: '' } });
    await expect(r.render('https://shop.example/card', { selector: '..[' })).rejects.toThrow(/not a valid selector/);
  });

  it('one at a time', async () => {
    let open = 0, max = 0;
    const f = fakeWindow();
    class W extends f.FakeWindow {
      constructor(o) {
        super(o); open++; max = Math.max(max, open);
        const load = this.webContents.loadURL;
        this.webContents.loadURL = async (u) => { await new Promise(res => setTimeout(res, 20)); return load(u); };
      }
      destroy() { open--; super.destroy(); }
    }
    const r = createPageRender({ BrowserWindow: W, getSession: () => ({}), scriptsOff: () => false, isPrivateHost, timeoutMs: 1000, settleMs: 1 });
    await Promise.all([r.render('https://a.example/'), r.render('https://b.example/'), r.render('https://c.example/')]);
    expect(max).toBe(1);
  });
});

describe('the script run in the page', () => {
  const run = (html, sel, anchor = '') => {
    document.body.innerHTML = html;
    document.title = 'T';
    return window.eval(readerScript(sel, anchor, 1000));
  };

  it('reads one part, or the whole body', () => {
    expect(run('<p class="a">One</p><p class="b">Two</p>', '.b')).toMatchObject({ found: true, text: 'Two' });
    expect(run('<p>One</p><p>Two</p>', '').text).toContain('One');
  });

  it('finds a moved part by its first words, and reports a gone one', () => {
    expect(run('<section><b>Price now $299.00 only</b></section>', '.price', 'Price now $299')).toMatchObject({ found: true, text: 'Price now $299.00 only' });
    expect(run('<p>nothing</p>', '.price', 'Price now $299')).toMatchObject({ found: false });
  });

  it('a selector that is not valid is flagged, and a hostile one cannot break out of the string', () => {
    expect(run('<p>x</p>', '..[')).toMatchObject({ invalid: true });
    expect(run('<p>x</p>', '");window.__pwned=1;("')).toMatchObject({ invalid: true });
    expect(window.__pwned).toBeUndefined();
  });
});
