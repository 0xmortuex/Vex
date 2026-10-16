// src/main/preconnect.js, window-set.js, jump-list.js, mini-window.js (Wave 3: T3-075, T3-095, T3-085, T3-079)
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { judge, registrableDomain, createPreconnect } = require('../../src/main/preconnect.js');
const { fitBounds, createWindowSet } = require('../../src/main/window-set.js');
const { actionFromArgv, buildTasks } = require('../../src/main/jump-list.js');
const { createMiniWindows, parsePrefs, webAddress } = require('../../src/main/mini-window.js');

const on = { on: true, allow: [] };
describe('preconnect policy', () => {
  it('reads the registrable domain, with country registries', () => {
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('x.gov.tr')).toBe('x.gov.tr');
  });
  it('allows the same site only, or an allow-listed one', () => {
    expect(judge({ pageUrl: 'https://www.example.com/a', linkUrl: 'https://cdn.example.com/x?y=1', prefs: on }).origin).toBe('https://cdn.example.com');
    expect(judge({ pageUrl: 'https://example.com/', linkUrl: 'https://other.org/', prefs: on }).ok).toBe(false);
    expect(judge({ pageUrl: 'https://example.com/', linkUrl: 'https://sub.other.org/', prefs: { on: true, allow: ['other.org'] } }).ok).toBe(true);
  });
  it('never in a private tab, when off, across schemes, or with a login in the link', () => {
    expect(judge({ pageUrl: 'https://a.com/', linkUrl: 'https://a.com/x', prefs: on, privatePage: true }).reason).toMatch(/private/);
    expect(judge({ pageUrl: 'https://a.com/', linkUrl: 'https://a.com/x', prefs: { on: false } }).ok).toBe(false);
    expect(judge({ pageUrl: 'https://a.com/', linkUrl: 'http://a.com/x', prefs: on }).ok).toBe(false);
    expect(judge({ pageUrl: 'https://a.com/', linkUrl: 'https://u:p@a.com/x', prefs: on }).ok).toBe(false);
    expect(judge({ pageUrl: 'https://a.com/', linkUrl: 'javascript:alert(1)', prefs: on }).ok).toBe(false);
  });
  it('limits repeats and calls the session once', () => {
    const preconnect = vi.fn();
    let t = 0;
    const guest = { isDestroyed: () => false, getType: () => 'webview', getURL: () => 'https://a.com/', session: { preconnect } };
    const p = createPreconnect({ webContents: { fromId: () => guest }, getPrefs: () => on, isPrivate: () => false, now: () => t });
    expect(p.preconnect(1, 'https://a.com/x').ok).toBe(true);
    expect(p.preconnect(1, 'https://a.com/y').reason).toBe('just done');
    expect(preconnect).toHaveBeenCalledWith({ url: 'https://a.com', numSockets: 1 });
    t = 31000;
    expect(p.preconnect(1, 'https://a.com/z').ok).toBe(true);
  });
  it('refuses a private page', () => {
    const guest = { isDestroyed: () => false, getType: () => 'webview', getURL: () => 'https://a.com/', session: { preconnect: vi.fn() } };
    const p = createPreconnect({ webContents: { fromId: () => guest }, getPrefs: () => on, isPrivate: () => true });
    expect(p.preconnect(1, 'https://a.com/x').ok).toBe(false);
    expect(guest.session.preconnect).not.toHaveBeenCalled();
  });
});

describe('window set', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 1280, height: 1000 };
  it('keeps a window on the monitor it was on', () => {
    expect(fitBounds({ x: 2000, y: 50, width: 800, height: 600 }, [area, second], area)).toEqual({ x: 2000, y: 50, width: 800, height: 600 });
  });
  it('centres (no place) when its monitor is gone, and clamps the size', () => {
    expect(fitBounds({ x: 2000, y: 50, width: 3000, height: 600 }, [area], area)).toEqual({ width: 1920, height: 600 });
  });
  it('pulls a window that hangs off the edge back in', () => {
    expect(fitBounds({ x: 1500, y: 900, width: 800, height: 600 }, [area], area)).toEqual({ x: 1120, y: 440, width: 800, height: 600 });
  });
  function make(prefs = { on: true, apps: true }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ws-'));
    const file = path.join(dir, 'window-set.json');
    return { file, ws: createWindowSet({ file, fs, getWorkAreas: () => [area], getPrimaryWorkArea: () => area, getPrefs: () => prefs, setTimer: (f) => { f(); return 0; }, clearTimer: () => {} }) };
  }
  const fakeWin = () => {
    const h = {};
    return { on: (e, f) => { h[e] = f; }, emit: (e) => h[e] && h[e](), isDestroyed: () => false, isMinimized: () => false, isFullScreen: () => false, isMaximized: () => false,
      getBounds: () => ({ x: 10, y: 20, width: 500, height: 400 }), getNormalBounds: () => ({ x: 10, y: 20, width: 500, height: 400 }) };
  };
  it('remembers the main window and gives it back next time', () => {
    const { file, ws } = make();
    const w = fakeWin(); ws.trackMain(w); w.emit('move');
    const again = createWindowSet({ file, fs, getWorkAreas: () => [area], getPrimaryWorkArea: () => area, getPrefs: () => ({ on: true }) });
    expect(again.mainPlacement()).toEqual({ bounds: { x: 10, y: 20, width: 500, height: 400 }, maximized: false });
  });
  it('writes nothing and restores nothing when off', () => {
    const { file, ws } = make({ on: false });
    ws.trackMain(fakeWin());
    expect(fs.existsSync(file)).toBe(false);
    expect(ws.mainPlacement()).toBe(null);
  });
  it('tracks app windows, lists a closed one, and a window closing at quit is not "closed"', () => {
    const { ws } = make();
    const a = fakeWin(), b = fakeWin();
    ws.trackApp(a, { url: 'https://a.com/', title: 'A', partition: 'persist:main' });
    ws.trackApp(b, { url: 'https://b.com/', title: 'B', partition: 'persist:main' });
    a.emit('closed');
    expect(ws.closedList().map(c => c.url)).toEqual(['https://a.com/']);
    ws.beginQuit();
    b.emit('closed');
    expect(ws.closedList().length).toBe(1);
    expect(ws.appsToRestore().map(x => x.url)).toEqual(['https://b.com/']);
    expect(ws.takeClosed().url).toBe('https://a.com/');
    expect(ws.takeClosed()).toBe(null);
  });
  it('never writes a Tor or private session or a non-web address', () => {
    const { ws } = make();
    ws.trackApp(fakeWin(), { url: 'https://a.com/', partition: 'persist:route-tor' });
    ws.trackApp(fakeWin(), { url: 'https://a.com/', partition: 'private-1' });
    ws.trackApp(fakeWin(), { url: 'file:///x', partition: 'persist:main' });
    ws.beginQuit();
    expect(ws.appsToRestore()).toEqual([]);
  });
});

describe('jump list', () => {
  it('accepts only the four known actions, exactly', () => {
    expect(actionFromArgv(['x', '--vex-jump=new-note'])).toBe('new-note');
    expect(actionFromArgv(['--vex-jump=new-note;calc'])).toBe(null);
    expect(actionFromArgv(['--vex-jump=../x'])).toBe(null);
  });
  it('builds four tasks plus the kept one, quoting an argument with a space', () => {
    const t = buildTasks({ execPath: 'Vex.exe', extraArgs: ['--user-data-dir=C:/a b'], enabled: true, keep: [{ title: 'safe' }] });
    expect(t.length).toBe(5);
    expect(t[0].arguments).toBe('"--user-data-dir=C:/a b" --vex-jump=new-note');
    expect(buildTasks({ execPath: 'x', enabled: false, keep: [{ title: 'safe' }] })).toEqual([{ title: 'safe' }]);
  });
});

describe('mini window', () => {
  it('is off unless chosen; takes only plain web addresses', () => {
    expect(parsePrefs(null).on).toBe(false);
    expect(webAddress('https://a.com/x')).toBe('https://a.com/x');
    expect(webAddress('file:///c:/x')).toBe(null);
    expect(webAddress('https://u:p@a.com/')).toBe(null);
  });
  function harness(prefs) {
    const wins = [];
    class Win {
      constructor(o) { this.o = o; this.h = {}; this.closed = false; this.webContents = { on: (e, f) => { this.h['wc:' + e] = f; }, getURL: () => 'https://a.com/now' }; wins.push(this); }
      on(e, f) { this.h[e] = f; }
      once(e, f) { this.h[e] = f; }
      setMenuBarVisibility() {}
      setTitle() {}
      isDestroyed() { return this.closed; }
      isFocused() { return false; }
      close() { this.closed = true; if (this.h.closed) this.h.closed(); }
      loadURL() { return Promise.resolve(); }
    }
    const opened = [];
    const timers = [];
    const m = createMiniWindows({ BrowserWindow: Win, getPrefs: () => prefs, register: vi.fn(), openAsTab: (u) => opened.push(u), reveal: vi.fn(), setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {} });
    return { m, wins, opened, timers };
  }
  it('does nothing when off', () => { expect(harness({ on: false }).m.take('https://a.com/')).toBe(false); });
  it('opens a sandboxed window with no Vex preload, caps at four, and promotes to a tab', () => {
    const { m, wins, opened } = harness({ on: true });
    expect(m.take('https://a.com/')).toBe(true);
    expect(wins[0].o.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    expect(wins[0].o.webPreferences.preload).toBeUndefined();
    for (let i = 0; i < 5; i++) m.take('https://a.com/' + i);
    expect(m.count()).toBe(4);
    const w = wins[wins.length - 1];
    w.h['wc:before-input-event']({ preventDefault: vi.fn() }, { type: 'keyDown', key: 'Enter', control: true, shift: true });
    expect(opened).toEqual(['https://a.com/now']);
  });
  it('closes itself after the minutes set once it is unfocused', () => {
    const { m, wins, timers } = harness({ on: true, autoCloseMinutes: 5 });
    m.take('https://a.com/');
    wins[0].h.blur();
    expect(timers[0].ms).toBe(5 * 60 * 1000);
    timers[0].f();
    expect(wins[0].closed).toBe(true);
  });
});
