// The in-game overlay (src/main/game-overlay.js, game-overlay-ipc.js, preload-game-overlay.js,
// renderer/game-overlay.html). The state machine, the hotkey, the per-game memory, the address
// rules, the IPC contract and the anti-cheat promise (no process access: a grep over the files).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ov = require('../../src/main/game-overlay.js');
const { validate, schemas } = require('../../src/main/ipc-schemas.js');
const { installIpcPolicy, UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const { cleanTokens } = require('../../src/main/game-overlay-ipc.js');

// ---- fakes ------------------------------------------------------------------------
function fakeTimers() {
  let now = 0, id = 0;
  const jobs = new Map();
  return {
    setTimer: (fn, ms) => { jobs.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: (t) => jobs.delete(t),
    advance(ms) {
      now += ms;
      for (const [k, j] of [...jobs]) if (j.at <= now) { jobs.delete(k); j.fn(); }
    },
    pending: () => jobs.size,
  };
}
function fakeShortcuts({ takenBy = [], throwOn = [] } = {}) {
  const held = new Map();
  return {
    held,
    register(accel, fn) { if (throwOn.includes(accel)) throw new Error('bad accelerator'); if (takenBy.includes(accel)) return false; held.set(accel, fn); return true; },
    unregister(accel) { held.delete(accel); },
  };
}
function fakeWindowMaker(log) {
  const made = [];
  const make = (opts) => {
    let bounds = { ...opts.bounds };
    const w = {
      opts, destroyed: false, visible: false, clickThrough: opts.clickThrough, opacity: opts.opacity, mode: opts.mode, sent: [], hints: 0,
      show() { w.visible = true; log.push('showInactive'); },
      hide() { w.visible = false; log.push('hide'); },
      destroy() { w.destroyed = true; w.visible = false; log.push('destroy'); },
      isDestroyed: () => w.destroyed,
      setClickThrough(on) { w.clickThrough = on; log.push('clickThrough:' + on); },
      setOpacity(n) { w.opacity = n; },
      setMode(m, b) { w.mode = m; bounds = { ...b }; },
      getBounds: () => ({ ...bounds }),
      move(b) { bounds = { ...bounds, ...b }; opts.onBounds(); },
      send(ch, p) { w.sent.push([ch, p]); },
      showHint(b) { w.hints++; w.visible = true; bounds = { ...b }; w.clickThrough = true; log.push('hint'); },
    };
    made.push(w);
    return w;
  };
  make.made = made;
  return make;
}
const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
function build(cfg = {}, extra = {}) {
  const t = fakeTimers();
  const log = [];
  const makeWindow = fakeWindowMaker(log);
  let config = { ...ov.DEFAULTS, on: true, ...cfg };
  let saved = null;
  const shortcuts = extra.shortcuts || fakeShortcuts();
  const ctl = ov.createOverlayController({
    makeWindow, globalShortcut: shortcuts, getConfig: () => config,
    memory: { load: () => saved, save: (m) => { saved = JSON.parse(JSON.stringify(m)); } },
    workAreas: () => [SCREEN], primaryWorkArea: () => SCREEN,
    setTimer: t.setTimer, clearTimer: t.clearTimer, conflicts: extra.conflicts, canShow: extra.canShow,
    log: (m) => log.push(m),
  });
  return { ctl, t, log, makeWindow, shortcuts, setConfig: (c) => { config = { ...config, ...c }; }, saved: () => saved };
}

// ---- settings ---------------------------------------------------------------------
describe('settings', () => {
  it('start off, with a hotkey that is not split view\u2019s Ctrl+Alt+O', () => {
    expect(ov.DEFAULTS.on).toBe(false);
    expect(ov.DEFAULTS.hotkey).toBe('Ctrl+Alt+Shift+O');
    expect(ov.parseConfig(null).config).toEqual({ ...ov.DEFAULTS });
  });
  it('cleanConfig says the first thing that is wrong', () => {
    expect(() => ov.cleanConfig({ on: 'yes' })).toThrow('true or false');
    expect(() => ov.cleanConfig({ hotkey: 'O' })).toThrow('modifier');
    expect(() => ov.cleanConfig({ opacity: 'x' })).toThrow('number');
    expect(() => ov.cleanConfig({ destroyMinutes: 999 })).toThrow('0 to 240');
    expect(() => ov.cleanConfig({ panels: [] })).toThrow('at least one');
    expect(() => ov.cleanConfig({ panels: ['guide', 'keylogger'] })).toThrow('Unknown overlay panel');
    expect(() => ov.cleanConfig([])).toThrow('object');
  });
  it('keeps what is valid: see-through is clamped, panels keep their order', () => {
    const c = ov.cleanConfig({ opacity: 0.01, panels: ['music', 'guide', 'guide'] });
    expect(c.opacity).toBe(ov.MIN_OPACITY);
    expect(c.panels).toEqual(['guide', 'music']);
    expect(ov.clampOpacity(7)).toBe(1);
  });
  it('a saved profile with one bad part loses only that part, and says so', () => {
    const { config, dropped } = ov.parseConfig({ on: true, opacity: 0.5, destroyMinutes: -4, panels: ['nope'] });
    expect(config.on).toBe(true);
    expect(config.opacity).toBe(0.5);
    expect(config.destroyMinutes).toBe(ov.DEFAULTS.destroyMinutes);
    expect(dropped.sort()).toEqual(['destroyMinutes', 'panels']);
  });
});

describe('addresses', () => {
  it('only plain web addresses without a password', () => {
    expect(ov.guideUrl('https://wiki.example/Page?x=1')).toBe('https://wiki.example/Page?x=1');
    expect(ov.guideUrl('http://127.0.0.1:8080/guide.html')).toBe('http://127.0.0.1:8080/guide.html');
    for (const bad of ['', 'file:///C:/x', 'javascript:alert(1)', 'vex://start', 'data:text/html,hi', 'https://user:pw@site.example/', 'not a url', 'ftp://x.example/'])
      expect(() => ov.guideUrl(bad)).toThrow();
    expect(() => ov.guideUrl('https://x.example/' + 'a'.repeat(3000))).toThrow('too long');
  });
  it('guides are per game (program name, any case, .exe ignored); a bad one refuses the list', () => {
    const c = ov.cleanConfig({ guides: { 'RobloxPlayerBeta.exe': 'https://roblox.fandom.com/' }, defaultGuide: 'https://example.org/' });
    expect(c.guides).toEqual({ robloxplayerbeta: 'https://roblox.fandom.com/' });
    expect(ov.guideFor(c, 'robloxplayerbeta')).toBe('https://roblox.fandom.com/');
    expect(ov.guideFor(c, 'other')).toBe('https://example.org/');
    expect(ov.guideFor(ov.DEFAULTS, 'x')).toBe('');
    expect(() => ov.cleanConfig({ guides: { game: 'javascript:1' } })).toThrow();
    const many = {}; for (let i = 0; i < 41; i++) many['g' + i] = 'https://x.example/';
    expect(() => ov.cleanConfig({ guides: many })).toThrow('At most');
  });
  it('a quick search goes to the person\u2019s own engine, and is escaped', () => {
    expect(ov.searchUrl('https://duckduckgo.com/?q=%s', 'a b&c')).toBe('https://duckduckgo.com/?q=a%20b%26c');
    expect(() => ov.searchUrl('', 'x')).toThrow('No search engine');
    expect(() => ov.searchUrl('https://e.example/?q=%s', '  ')).toThrow('Type something');
  });
});

// ---- where it sat for each game ---------------------------------------------------------
describe('per-game place and size', () => {
  const usable = ov.usableOn([SCREEN]);
  it('remembers a place for each game and the small bar apart from the full card', () => {
    let m = ov.emptyMemory();
    m = ov.rememberBounds(m, 'expanded', 'roblox', { x: 10, y: 20, width: 460, height: 600 });
    m = ov.rememberBounds(m, 'expanded', 'minecraft', { x: 500, y: 40, width: 400, height: 500 });
    m = ov.rememberBounds(m, 'compact', 'roblox', { x: 30, y: 30, width: 380, height: 150 });
    expect(ov.boundsFor(m, 'expanded', 'roblox', usable)).toEqual({ x: 10, y: 20, width: 460, height: 600 });
    expect(ov.boundsFor(m, 'expanded', 'minecraft', usable).x).toBe(500);
    expect(ov.boundsFor(m, 'compact', 'roblox', usable).width).toBe(380);
    // a game with none of its own gets the last place used
    expect(ov.boundsFor(m, 'expanded', 'newgame', usable).x).toBe(500);
  });
  it('a place on a screen that is gone is not used', () => {
    const m = ov.rememberBounds(ov.emptyMemory(), 'expanded', 'roblox', { x: 5000, y: 0, width: 460, height: 600 });
    expect(ov.boundsFor(m, 'expanded', 'roblox', usable)).toBeNull();
    expect(ov.defaultBounds(SCREEN, 'expanded')).toEqual({ x: 1920 - 460 - 24, y: 24, width: 460, height: 600 });
  });
  it('refuses to remember a window with no size, and keeps at most 40 games', () => {
    expect(() => ov.rememberBounds(ov.emptyMemory(), 'expanded', 'g', { x: 0, y: 0, width: 0, height: 5 })).toThrow('no size');
    let m = ov.emptyMemory();
    for (let i = 0; i < 45; i++) m = ov.rememberBounds(m, 'expanded', 'game' + i, { x: i, y: 0, width: 400, height: 400 });
    expect(Object.keys(m.expanded.byContext).length).toBe(40);
  });
  it('parseMemory ignores junk and long notes', () => {
    expect(ov.parseMemory('x')).toEqual(ov.emptyMemory());
    expect(ov.parseMemory({ notes: { a: 'hi', b: 5 } }).notes).toEqual({ a: 'hi' });
  });
});

// ---- the state machine --------------------------------------------------------------------
describe('show, hide, destroy', () => {
  it('makes no window until it is wanted, shows without focus, hides, and destroys after the set minutes', () => {
    const { ctl, t, makeWindow, log } = build({ destroyMinutes: 5 });
    expect(ctl.hasWindow()).toBe(false);
    expect(ctl.state().status).toBe('none');
    ctl.toggle();
    expect(makeWindow.made.length).toBe(1);
    expect(ctl.state().status).toBe('shown');
    expect(log).toContain('showInactive');
    ctl.toggle();
    expect(ctl.state().status).toBe('hidden');
    expect(ctl.hasWindow()).toBe(true);
    t.advance(4 * 60 * 1000);
    expect(ctl.hasWindow()).toBe(true);
    t.advance(60 * 1000 + 1);
    expect(ctl.hasWindow()).toBe(false);
    expect(ctl.state().status).toBe('none');
    expect(log).toContain('destroy');
    expect(t.pending()).toBe(0);
  });
  it('showing again before the time is up cancels the destroy and reuses the window', () => {
    const { ctl, t, makeWindow } = build({ destroyMinutes: 5 });
    ctl.show(); ctl.hide();
    t.advance(2 * 60 * 1000);
    ctl.show();
    t.advance(60 * 60 * 1000);
    expect(makeWindow.made.length).toBe(1);
    expect(ctl.state().status).toBe('shown');
  });
  it('0 minutes keeps a hidden window for ever', () => {
    const { ctl, t } = build({ destroyMinutes: 0 });
    ctl.show(); ctl.hide();
    expect(t.pending()).toBe(0);
    t.advance(1e9);
    expect(ctl.hasWindow()).toBe(true);
  });
  it('a closed window is forgotten and made again next time', () => {
    const { ctl, makeWindow } = build();
    ctl.show();
    makeWindow.made[0].opts.onClosed();
    expect(ctl.state().status).toBe('none');
    ctl.show();
    expect(makeWindow.made.length).toBe(2);
  });
  it('refuses to show while Vex is locked, with the reason', () => {
    const { ctl, makeWindow } = build({}, { canShow: () => 'Vex is locked. Unlock it first.' });
    expect(() => ctl.show()).toThrow('locked');
    expect(makeWindow.made.length).toBe(0);
  });
  it('dispose destroys the window and gives the hotkey back', () => {
    const { ctl, shortcuts } = build();
    ctl.registerHotkey();
    ctl.show();
    ctl.dispose();
    expect(shortcuts.held.size).toBe(0);
    expect(ctl.hasWindow()).toBe(false);
  });
});

describe('click-through, see-through, small bar', () => {
  it('follows the setting at first and keeps this session\u2019s choice, telling the window', () => {
    const { ctl, makeWindow } = build({ clickThrough: true });
    ctl.show();
    const w = makeWindow.made[0];
    expect(w.opts.clickThrough).toBe(true);
    ctl.setClickThrough(false);
    expect(w.clickThrough).toBe(false);
    expect(ctl.state().clickThrough).toBe(false);
    expect(w.sent.at(-1)[0]).toBe('gameoverlay:state');
    expect(w.sent.at(-1)[1].clickThrough).toBe(false);
    expect(() => ctl.setClickThrough('yes')).toThrow();
  });
  it('see-through is clamped to 20..100 percent', () => {
    const { ctl, makeWindow } = build();
    ctl.show();
    ctl.setOpacity(0.05);
    expect(makeWindow.made[0].opacity).toBe(0.2);
    expect(() => ctl.setOpacity('a')).toThrow();
  });
  it('the small bar and the full card each come back where they were left', () => {
    const { ctl, makeWindow } = build();
    ctl.setGame('roblox');
    ctl.show();
    const w = makeWindow.made[0];
    w.move({ x: 100, y: 100 });
    ctl.setCompact(true);
    expect(w.mode).toBe('compact');
    w.move({ x: 700, y: 50 });
    ctl.setCompact(false);
    expect(w.getBounds().x).toBe(100);
    ctl.setCompact(true);
    expect(w.getBounds().x).toBe(700);
  });
  it('moving is saved after a pause, hiding saves at once, and another game has its own place', () => {
    const { ctl, t, makeWindow, saved } = build();
    ctl.setGame('roblox');
    ctl.show();
    makeWindow.made[0].move({ x: 321, y: 123 });
    expect(saved()).toBeNull();
    t.advance(700);
    expect(saved().expanded.byContext.roblox.x).toBe(321);
    makeWindow.made[0].move({ x: 400 });
    ctl.hide();
    expect(saved().expanded.byContext.roblox.x).toBe(400);
    ctl.setGame('minecraft');
    ctl.show();
    expect(makeWindow.made[0].getBounds().x).toBe(400);   // none of its own yet: the last place used
  });
});

describe('the hint when a game starts', () => {
  it('shows a small click-through note, never the full card, and hides itself', () => {
    const { ctl, t, makeWindow, log } = build({ hint: true });
    ctl.registerHotkey();
    ctl.onGame({ game: true, app: 'RobloxPlayerBeta' });
    const w = makeWindow.made[0];
    expect(w.hints).toBe(1);
    expect(w.clickThrough).toBe(true);
    expect(ctl.state().hint).toBe('Ctrl+Alt+Shift+O');
    expect(ctl.state().game).toBe('robloxplayerbeta');
    t.advance(9001);
    expect(ctl.state().status).toBe('hidden');
    expect(log.filter(l => l === 'showInactive').length).toBe(0);
  });
  it('the hotkey during the hint opens the real overlay with the usual click-through setting', () => {
    const { ctl, makeWindow } = build({ hint: true, clickThrough: false });
    ctl.registerHotkey();
    ctl.onGame({ game: true, app: 'g' });
    ctl.toggle();
    expect(ctl.state().hint).toBe('');
    expect(ctl.state().status).toBe('shown');
    expect(makeWindow.made[0].clickThrough).toBe(false);
  });
  it('the hotkey AFTER the hint timed out still restores the full size and the click-through setting (real-window bug)', () => {
    const { ctl, t, makeWindow } = build({ hint: true, clickThrough: false });
    ctl.registerHotkey();
    ctl.onGame({ game: true, app: 'g' });
    const w = makeWindow.made[0];
    t.advance(9001);
    expect(ctl.state().status).toBe('hidden');
    expect(w.clickThrough).toBe(true);
    ctl.toggle();
    expect(ctl.state().status).toBe('shown');
    expect(w.clickThrough).toBe(false);
    expect(w.mode).toBe('expanded');
  });
  it('does nothing when it is off, when no hotkey is registered, or when no game runs', () => {
    const a = build({ hint: false }); a.ctl.registerHotkey(); a.ctl.onGame({ game: true, app: 'g' });
    const b = build({ hint: true }); b.ctl.onGame({ game: true, app: 'g' });
    const c = build({ hint: true }); c.ctl.registerHotkey(); c.ctl.onGame({ game: false, app: '' });
    for (const x of [a, b, c]) expect(x.makeWindow.made.length).toBe(0);
  });
  it('the hint box is not remembered as the overlay\u2019s place', () => {
    const { ctl, saved } = build({ hint: true });
    ctl.registerHotkey();
    ctl.onGame({ game: true, app: 'g' });
    ctl.hide();
    expect(saved()).toBeNull();
  });
});

// ---- the hotkey -----------------------------------------------------------------------------
describe('the global hotkey', () => {
  it('registers one shortcut and the press toggles the overlay', () => {
    const { ctl, shortcuts } = build();
    const r = ctl.registerHotkey();
    expect(r).toEqual({ accelerator: 'Ctrl+Alt+Shift+O', registered: true, error: '' });
    expect([...shortcuts.held.keys()]).toEqual(['Ctrl+Alt+Shift+O']);
    shortcuts.held.get('Ctrl+Alt+Shift+O')();
    expect(ctl.state().status).toBe('shown');
    shortcuts.held.get('Ctrl+Alt+Shift+O')();
    expect(ctl.state().status).toBe('hidden');
  });
  it('says so when another program already holds the key', () => {
    const { ctl } = build({}, { shortcuts: fakeShortcuts({ takenBy: ['Ctrl+Alt+Shift+O'] }) });
    const r = ctl.registerHotkey();
    expect(r.registered).toBe(false);
    expect(r.error).toContain('Another program');
  });
  it('refuses a key another Vex shortcut holds, whatever its spelling', () => {
    const { ctl, shortcuts } = build({}, { conflicts: () => ['CommandOrControl+Alt+Shift+O'] });
    const r = ctl.registerHotkey('ctrl+alt+shift+o');
    expect(r.registered).toBe(false);
    expect(r.error).toContain('already used');
    expect(shortcuts.held.size).toBe(0);
  });
  it('refuses a plain key and reports a throw from the system', () => {
    const { ctl } = build({}, { shortcuts: fakeShortcuts({ throwOn: ['Ctrl+Alt+Shift+Q'] }) });
    expect(ctl.registerHotkey('Q').registered).toBe(false);
    expect(ctl.registerHotkey('Ctrl+Alt+Shift+Q').error).toContain('Windows refused');
  });
  it('re-registering gives the old key back first, and turning the overlay off releases it', () => {
    const { ctl, shortcuts, setConfig } = build();
    ctl.applyConfig();
    expect([...shortcuts.held.keys()]).toEqual(['Ctrl+Alt+Shift+O']);
    setConfig({ hotkey: 'Ctrl+Alt+Shift+K' });
    ctl.applyConfig();
    expect([...shortcuts.held.keys()]).toEqual(['Ctrl+Alt+Shift+K']);
    ctl.show();
    setConfig({ on: false });
    ctl.applyConfig();
    expect(shortcuts.held.size).toBe(0);
    expect(ctl.hasWindow()).toBe(false);
  });
  it('a failing press is reported, not swallowed', () => {
    const messages = [];
    const t = fakeTimers();
    const sc = fakeShortcuts();
    const ctl = ov.createOverlayController({
      makeWindow: () => { throw new Error('no window'); }, globalShortcut: sc, getConfig: () => ({ ...ov.DEFAULTS, on: true }),
      workAreas: () => [SCREEN], primaryWorkArea: () => SCREEN, setTimer: t.setTimer, clearTimer: t.clearTimer, notify: (m) => messages.push(m),
    });
    ctl.registerHotkey();
    sc.held.get('Ctrl+Alt+Shift+O')();
    expect(messages[0]).toContain('no window');
  });
});

// ---- notes ----------------------------------------------------------------------------------------
describe('notes', () => {
  it('are kept for each game and refused when too long', () => {
    const { ctl, saved } = build();
    ctl.setGame('roblox'); ctl.saveNotes('farm gems');
    ctl.setGame('minecraft'); expect(ctl.notes()).toBe('');
    ctl.setGame('roblox'); expect(ctl.notes()).toBe('farm gems');
    expect(saved().notes.roblox).toBe('farm gems');
    expect(() => ctl.saveNotes('x'.repeat(ov.MAX_NOTES + 1))).toThrow('too long');
  });
});

// ---- the IPC contract -------------------------------------------------------------------------------
describe('IPC', () => {
  const channels = [...fs.readFileSync('src/preload-game-overlay.js', 'utf8').matchAll(/invoke\('([^']+)'/g)].map(m => m[1])
    .concat([...fs.readFileSync('src/preload.js', 'utf8').matchAll(/(?:invoke|send)\('(gameoverlay:[^']+)'/g)].map(m => m[1]));
  it('every channel the two preloads use has a schema', () => {
    expect(channels.length).toBeGreaterThanOrEqual(15);
    expect(channels.filter(c => !schemas.has(c))).toEqual([]);
  });
  it('accepts the real shapes and refuses wrong ones', () => {
    expect(() => validate('gameoverlay:view', [{ panel: 'guide', x: 1, y: 2, width: 300, height: 200 }])).not.toThrow();
    expect(() => validate('gameoverlay:view', [{ panel: 'none' }])).not.toThrow();
    expect(() => validate('gameoverlay:view', [{ panel: 'shell', x: 1, y: 2, width: 3, height: 4 }])).toThrow();
    expect(() => validate('gameoverlay:view', [{ panel: 'guide', x: -1 }])).toThrow();
    expect(() => validate('gameoverlay:opacity', [0.5])).not.toThrow();
    expect(() => validate('gameoverlay:opacity', [5])).toThrow();
    expect(() => validate('gameoverlay:music', ['toggle'])).not.toThrow();
    expect(() => validate('gameoverlay:music', ['rm -rf'])).toThrow();
    expect(() => validate('gameoverlay:click-through', ['yes'])).toThrow();
    expect(() => validate('gameoverlay:hide', ['extra'])).toThrow();
    expect(() => validate('gameoverlay:save-notes', ['x'.repeat(20001)])).toThrow();
    expect(() => validate('gameoverlay:timer', [{ mode: 'timer', running: true, startedAt: 1, elapsedMs: 0, durationMs: 60000 }])).not.toThrow();
    expect(() => validate('gameoverlay:timer', [{ mode: 'nuke', running: true, startedAt: 1, elapsedMs: 0, durationMs: 1 }])).toThrow();
    expect(() => validate('gameoverlay:config', [{ config: { on: true }, lang: 'tr' }])).not.toThrow();
    expect(() => validate('gameoverlay:config', [{ config: 'on' }])).toThrow();
    expect(() => validate('gameoverlay:music-answer', [{ id: '1', ok: true, title: 'x' }])).not.toThrow();
  });
  it('theme values: only --vex-* names and the two look attributes', () => {
    expect(cleanTokens({ '--vex-bg-base': '#fff', 'data-gui-style': 'glass' })['--vex-bg-base']).toBe('#fff');
    expect(() => cleanTokens({ 'background-image': 'url(x)' })).toThrow('Not a theme name');
    expect(() => cleanTokens({ '--vex-a': 5 })).toThrow('short text');
  });
  it('the setup calls are Vex-window-only; the overlay page reaches only its own channels', async () => {
    for (const c of ['gameoverlay:config', 'gameoverlay:toggle', 'gameoverlay:status', 'gameoverlay:music-answer']) expect(UI_ONLY_CHANNELS.has(c)).toBe(true);
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    installIpcPolicy(ipcMain, { isUiFrame: () => false, owner: () => null, isAuxiliary: () => false, ownsTarget: () => true });
    for (const c of ['gameoverlay:hide', 'gameoverlay:config', 'api:request', 'vault:get']) ipcMain.handle(c, () => 'ran');
    const call = (ch, url, ...args) => handlers.get(ch)({ sender: {}, senderFrame: { url } }, ...args);
    expect(await call('gameoverlay:hide', 'file:///C:/vex/src/renderer/game-overlay.html')).toBe('ran');
    await expect(call('gameoverlay:config', 'file:///C:/vex/src/renderer/game-overlay.html', { config: {} })).rejects.toThrow('Untrusted IPC sender');
    await expect(call('vault:get', 'file:///C:/vex/src/renderer/game-overlay.html', 'x')).rejects.toThrow();
    await expect(call('gameoverlay:hide', 'https://evil.example/')).rejects.toThrow('Untrusted IPC sender');
    await expect(call('gameoverlay:hide', 'file:///C:/elsewhere/game-overlay.html')).rejects.toThrow('Untrusted IPC sender');
  });
});

describe('the overlay page in Turkish', () => {
  it('every literal t(\'...\') string has a Turkish entry, including the timer’s "N min" buttons (real-window bug)', () => {
    const code = fs.readFileSync('src/renderer/js/game-overlay-page.js', 'utf8');
    const table = code.slice(code.indexOf('const TR = {'), code.indexOf('let lang'));
    const missing = [...code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, '\'')).filter(k => !table.includes('\'' + k.replace(/'/g, '\\\'') + '\':'));
    expect(missing).toEqual([]);
    expect(code).toMatch(/min \+ ' ' \+ t\('min'\)/);
  });
});

// ---- the promise to anti-cheat: nothing here looks at another program ---------------------------------------
describe('anti-cheat safety by construction', () => {
  const files = ['src/main/game-overlay.js', 'src/main/game-overlay-ipc.js', 'src/preload-game-overlay.js', 'src/renderer/game-overlay.html', 'src/renderer/js/game-overlay-page.js', 'src/renderer/js/game-overlay.js'];
  const FORBIDDEN = /child_process|\bspawn\b|execFile|ffi-napi|\bkoffi\b|ReadProcessMemory|WriteProcessMemory|OpenProcess|VirtualAllocEx|SetWindowsHookEx|CreateRemoteThread|LoadLibrary|desktopCapturer|capturePage|getSources|uiohook|iohook|node-global-key-listener|process\.kill|debugger\.attach|attachDebugger|\.dll\b|\binject\(|ptrace|tasklist|GetForegroundWindow|FindWindow|EnumWindows|SetForegroundWindow|BitBlt|PrintWindow|AddVectoredExceptionHandler/;
  for (const f of files) {
    it(f + ' names no API that reads, hooks or captures another program', () => {
      const code = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
      expect(code.match(FORBIDDEN)).toBeNull();
    });
  }
  it('the only system-wide call is globalShortcut.register / unregister', () => {
    const code = fs.readFileSync('src/main/game-overlay.js', 'utf8');
    const uses = [...code.matchAll(/globalShortcut\.(\w+)/g)].map(m => m[1]);
    expect(new Set(uses)).toEqual(new Set(['register', 'unregister']));
    expect(code).not.toMatch(/require\('electron'\)/);   // it is handed Electron's classes, it does not reach for more
  });
  it('the overlay window is sandboxed with context isolation, never gets Node, and shows only on the active screen without focus', () => {
    const code = fs.readFileSync('src/main/game-overlay.js', 'utf8');
    expect(code).toMatch(/contextIsolation: true, nodeIntegration: false, sandbox: true/);
    expect(code).toMatch(/showInactive\(\)/);
    expect(code).not.toMatch(/\.focus\(\)/);
  });
  it('the main-process wiring never tells the game window anything: it knows a game only by the name Game mode gave', () => {
    const wiring = fs.readFileSync('src/main/game-overlay-ipc.js', 'utf8');
    expect(wiring).not.toMatch(/getProcess|pid\b|getAppMetrics/);
  });
});
