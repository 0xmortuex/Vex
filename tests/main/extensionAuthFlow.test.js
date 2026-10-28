// chrome.identity.launchWebAuthFlow (src/main/extension-auth-flow.js), 2026-10-28: how the Claude extension signs in, with no window shown.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { createAuthFlow, SETTLE_MS, DEFAULT_QUIET_MS, INTERACTIVE_MS } = createRequire(import.meta.url)('../../src/main/extension-auth-flow.js');
const EXT = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';

let wins, flow;
function fakeWindow(opts) {
  const win = new EventEmitter();
  win.opts = opts; win.destroyed = false; win.shown = false;
  win.webContents = new EventEmitter();
  win.webContents.loaded = [];
  win.webContents.loadURL = vi.fn(async (url) => { win.webContents.loaded.push(url); });
  win.isDestroyed = () => win.destroyed;
  win.destroy = () => { win.destroyed = true; win.emit('closed'); };
  win.show = () => { win.shown = true; };
  wins.push(win);
  return win;
}
beforeEach(() => {
  vi.useFakeTimers();
  wins = [];
  flow = createAuthFlow({ createWindow: fakeWindow });
});
afterEach(() => vi.useRealTimers());

const start = (over = {}) => flow.launch({ ses: { name: 'persist:main' }, extId: EXT, url: 'https://claude.ai/oauth/authorize?client_id=x&redirect_uri=chrome-extension://' + EXT + '/oauth_callback.html', ...over });

describe('the redirect that ends it', () => {
  it('a redirect to the extension\'s own address is the answer, with the code, and the window is gone (silent: nothing was shown)', async () => {
    const p = start();
    expect(wins[0].shown).toBe(false);
    expect(wins[0].opts.interactive).toBe(false);
    const prevented = vi.fn();
    wins[0].webContents.emit('will-redirect', { preventDefault: prevented }, 'chrome-extension://' + EXT + '/oauth_callback.html?code=C0DE&state=S');
    expect(await p).toBe('chrome-extension://' + EXT + '/oauth_callback.html?code=C0DE&state=S');
    expect(prevented).toHaveBeenCalled();
    expect(wins[0].destroyed).toBe(true);
  });
  it('the https://<id>.chromiumapp.org/ address counts too, whichever way the page gets there', async () => {
    for (const ev of ['will-redirect', 'will-navigate']) {
      const p = start();
      wins.at(-1).webContents.emit(ev, { preventDefault() {} }, 'https://' + EXT + '.chromiumapp.org/cb?code=1');
      expect(await p).toBe('https://' + EXT + '.chromiumapp.org/cb?code=1');
    }
    const p = start();
    wins.at(-1).webContents.emit('did-start-navigation', { url: 'chrome-extension://' + EXT + '/x?code=2', preventDefault() {} });
    expect(await p).toBe('chrome-extension://' + EXT + '/x?code=2');
  });
  it('a load that fails AT the extension\'s address (nothing is served there) is still the answer', async () => {
    const p = start();
    wins[0].webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'chrome-extension://' + EXT + '/oauth_callback.html?code=Z', true);
    expect(await p).toBe('chrome-extension://' + EXT + '/oauth_callback.html?code=Z');
  });
  it('another extension\'s address, a look-alike host and an ordinary page are not the answer', async () => {
    const p = start();
    const wc = wins[0].webContents;
    for (const bad of ['chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/x', 'https://' + EXT + '.chromiumapp.org.evil.example/x', 'https://evil.example/' + EXT + '.chromiumapp.org/', 'https://claude.ai/login']) {
      wc.emit('will-redirect', { preventDefault: vi.fn() }, bad);
    }
    expect(wins[0].destroyed).toBe(false);
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 10);
    await expect(p).rejects.toThrow('Authorization page could not be loaded.');
  });
  it('the page is loaded from the address given, in the extension\'s session, with no preload and no Node (the window is made by the caller from the session)', async () => {
    const p = start({ url: 'https://claude.ai/oauth/authorize?a=1' });
    expect(wins[0].webContents.loadURL).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?a=1');
    expect(wins[0].opts.ses).toEqual({ name: 'persist:main' });
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/x');
    await p;
  });
});

describe('silent (interactive: false)', () => {
  it('a page that loads and does not redirect says user interaction is required (the Claude extension tells this apart)', async () => {
    const p = start();
    wins[0].webContents.emit('did-finish-load');
    vi.advanceTimersByTime(SETTLE_MS + 5);
    await expect(p).rejects.toThrow('User interaction required.');
    expect(wins[0].destroyed).toBe(true);
  });
  it('a redirect that follows the page load within a moment is still the answer', async () => {
    const p = start();
    wins[0].webContents.emit('did-finish-load');
    vi.advanceTimersByTime(SETTLE_MS - 200);
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/cb?code=late');
    expect(await p).toContain('code=late');
  });
  it('a page that cannot be loaded, or takes too long, says so in the words the extension looks for', async () => {
    let p = start();
    wins[0].webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://claude.ai/', true);
    await expect(p).rejects.toThrow('Authorization page could not be loaded.');
    p = start({ timeoutMs: 4000 });
    vi.advanceTimersByTime(4100);
    await expect(p).rejects.toThrow('Authorization page could not be loaded.');
  });
  it('a failure of a frame inside the page is not a failure of the page', async () => {
    const p = start();
    wins[0].webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'https://ads.example/x.js', false);
    expect(wins[0].destroyed).toBe(false);
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/cb');
    await p;
  });
  it('the time it waits is the one the extension asked for, but never more than a minute', async () => {
    const p = start({ timeoutMs: 999999 });
    vi.advanceTimersByTime(60001);
    await expect(p).rejects.toThrow('could not be loaded');
  });
});

describe('interactive', () => {
  it('shows the window, and closing it says the person did not approve', async () => {
    const p = start({ interactive: true });
    expect(wins[0].shown).toBe(true);
    wins[0].emit('closed');
    await expect(p).rejects.toThrow('The user did not approve access.');
  });
  it('does not give up on a page that loaded: the person is signing in', async () => {
    const p = start({ interactive: true });
    wins[0].webContents.emit('did-finish-load');
    vi.advanceTimersByTime(60000);
    expect(wins[0].destroyed).toBe(false);
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/cb?code=ok');
    expect(await p).toContain('code=ok');
  });
  it('gives up after five minutes', async () => {
    const p = start({ interactive: true });
    vi.advanceTimersByTime(INTERACTIVE_MS + 10);
    await expect(p).rejects.toThrow('The user did not approve access.');
    expect(wins[0].destroyed).toBe(true);
  });
});

describe('addresses it will not open', () => {
  it('only http and https, and an address that is not one', async () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'chrome-extension://abc/x.html', 'not a url', '']) {
      await expect(start({ url: bad })).rejects.toThrow('Authorization page could not be loaded.');
    }
    expect(wins.length).toBe(0);
  });
  it('the first answer wins: later events change nothing', async () => {
    const p = start();
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/cb?code=first');
    wins[0].emit('closed');
    wins[0].webContents.emit('will-redirect', { preventDefault() {} }, 'chrome-extension://' + EXT + '/cb?code=second');
    expect(await p).toContain('code=first');
  });
});
