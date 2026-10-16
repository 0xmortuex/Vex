// T2-059 / T2-049 / T2-068: the pure parts of the PiP memory, the second-screen
// window and the Game Control Center file, plus the new channels' wiring.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const pipMemory = require('../../src/main/pip-memory.js');
const ss = require('../../src/main/second-screen.js');
const gcc = require('../../src/main/gcc-bridge.js');
const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');

describe('PiP memory', () => {
  it('normalises a game key and refuses nonsense', () => {
    expect(pipMemory.contextKey('C:\\Games\\Foo\\Foo.exe')).toBe('foo');
    expect(pipMemory.contextKey('')).toBe('');
    expect(() => pipMemory.contextKey('../x;y')).toThrow(/usable/);
    expect(() => pipMemory.contextKey(5)).toThrow(/text/);
  });
  it('prefers the game\'s own place when it still lands on a screen, else the last one', () => {
    const usable = (b) => (b && b.x < 5000 ? b : null);
    const state = { bounds: { x: 1, y: 1, width: 400, height: 300 }, byContext: { foo: { x: 9000, y: 0, width: 400, height: 300 }, bar: { x: 10, y: 10, width: 400, height: 300 } } };
    expect(pipMemory.boundsFor(state, 'bar', usable).x).toBe(10);
    expect(pipMemory.boundsFor(state, 'foo', usable).x).toBe(1);        // monitor gone: the last position
    expect(pipMemory.boundsFor(state, '', usable).x).toBe(1);
  });
  it('remembers per game, bounded, newest last', () => {
    let s = {};
    for (let i = 0; i < pipMemory.MAX_CONTEXTS + 5; i++) s = pipMemory.remember(s, 'g' + i, { x: i, y: 0, width: 300, height: 200 });
    expect(Object.keys(s.byContext)).toHaveLength(pipMemory.MAX_CONTEXTS);
    expect(s.byContext.g0).toBeUndefined();
    expect(pipMemory.remember({ a: 1 }, '', { x: 0, y: 0, width: 1, height: 1 })).toEqual({ a: 1 });
  });
  it('hides only when asked AND a fullscreen game is up', () => {
    expect(pipMemory.shouldHide({ hideOverGame: true, gameFullscreen: true })).toBe(true);
    expect(pipMemory.shouldHide({ hideOverGame: false, gameFullscreen: true })).toBe(false);
    expect(pipMemory.shouldHide({ hideOverGame: true, gameFullscreen: false })).toBe(false);
  });
});

describe('second-screen window rules', () => {
  const d1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const d2 = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  it('only http(s) pages, at most 12', () => {
    expect(ss.cleanPages([{ title: 'a', url: 'https://x.test/a' }])[0].url).toBe('https://x.test/a');
    expect(() => ss.cleanPages([{ url: 'file:///C:/x' }])).toThrow(/http/);
    expect(() => ss.cleanPages([{ url: 'javascript:1' }])).toThrow(/http/);
    expect(() => ss.cleanPages([])).toThrow(/no page/);
    expect(() => ss.cleanPages(Array.from({ length: 13 }, () => ({ url: 'https://x.test' })))).toThrow(/up to 12/);
  });
  it('refuses to open over a game on a single monitor, allows it with no game', () => {
    expect(() => ss.pickDisplay({ displays: [d1], primaryId: 1, gameRunning: true })).toThrow(/only one screen/);
    expect(ss.pickDisplay({ displays: [d1], primaryId: 1, gameRunning: false }).id).toBe(1);
  });
  it('picks the non-primary monitor, or the remembered one, never the game\'s while it runs', () => {
    expect(ss.pickDisplay({ displays: [d1, d2], primaryId: 1, gameRunning: true }).id).toBe(2);
    expect(ss.pickDisplay({ displays: [d1, d2], primaryId: 1, savedId: 1, gameRunning: true }).id).toBe(2);
    expect(ss.pickDisplay({ displays: [d1, d2], primaryId: 1, savedId: 1, gameRunning: false }).id).toBe(1);
    expect(ss.pickDisplay({ displays: [d1, d2], primaryId: 1, savedId: 99, gameRunning: false }).id).toBe(2);
  });
  it('places saved bounds that fit, else centres', () => {
    expect(ss.placeOn(d2, { x: 2000, y: 50, width: 700, height: 800 })).toEqual({ x: 2000, y: 50, width: 700, height: 800 });
    const c = ss.placeOn(d2, { x: 10, y: 10, width: 700, height: 800 });
    expect(c.x).toBeGreaterThanOrEqual(1920);
  });
  it('clamps zoom and maps keys; window-only options are fixed', () => {
    expect(ss.clampZoom(9)).toBe(3);
    expect(ss.clampZoom(0.1)).toBe(0.5);
    expect(() => ss.clampZoom('x')).toThrow();
    expect(ss.keyAction({ type: 'keyDown', control: true, key: 'Tab', shift: true })).toBe('prev');
    expect(ss.keyAction({ type: 'keyDown', control: true, key: '=' })).toBe('zoom-in');
    expect(ss.keyAction({ type: 'keyDown', key: 'Tab' })).toBeNull();
    const src = read('src/main/second-screen.js');
    expect(src).toMatch(/alwaysOnTop: false, fullscreenable: false/);
    expect(src).not.toMatch(/setAlwaysOnTop\(true/);
  });
  it('creates a plain window with no node and denies permissions', () => {
    const made = [];
    class Win {
      constructor(o) { this.o = o; made.push(this); this.webContents = { setWindowOpenHandler() {}, on() {}, setZoomFactor() {} }; }
      isDestroyed() { return false; } setTitle() {} loadURL() { return Promise.resolve(); } on() {} getBounds() { return {}; } isMinimized() { return false; } destroy() {}
    }
    const perms = {};
    const session = { fromPartition: () => ({ setPermissionRequestHandler: (f) => { perms.h = f; }, setPermissionCheckHandler: (f) => { perms.c = f; }, on() {} }) };
    const screen = { getAllDisplays: () => [d1, d2], getPrimaryDisplay: () => d1, getDisplayMatching: () => d2 };
    const w = ss.createSecondScreen({ BrowserWindow: Win, screen, session, readState: () => ({}), writeState() {}, isGameRunning: () => true });
    const st = w.open({ pages: [{ title: 'g', url: 'https://x.test' }] });
    expect(st.open).toBe(true);
    expect(made[0].o.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
    expect(made[0].o.x).toBeGreaterThanOrEqual(1920);
    let granted = null; perms.h(null, 'media', (ok) => { granted = ok; });
    expect(granted).toBe(false);
  });
});

describe('Game Control Center file', () => {
  const now = Date.parse('2026-10-16T18:03:30Z');
  const good = { version: 1, updatedAt: '2026-10-16T18:03:11Z', game: { name: 'G', exe: 'g.exe', running: true }, profile: 'P', streamer: true, capture: false, clipsDir: 'C:\\Videos\\GCC', recentClips: [{ file: 'a.mp4', game: 'G', session: 's', at: '2026-10-16T18:00:00Z' }] };
  it('parses a good file', () => {
    const s = gcc.parse(JSON.stringify(good), now);
    expect(s).toMatchObject({ stale: false, streamer: true, profile: 'P', clipsDir: 'C:\\Videos\\GCC' });
    expect(s.game.running).toBe(true);
    expect(s.recentClips[0].file).toBe('a.mp4');
  });
  it('a stale file means GCC is not running', () => {
    const s = gcc.parse(JSON.stringify(good), now + 10 * 60000);
    expect(s.stale).toBe(true);
    expect(s.game.running).toBe(false);
    expect(s.streamer).toBe(false);
  });
  it('raises on anything wrong, never repairs', () => {
    expect(() => gcc.parse('{', now)).toThrow(/not valid JSON/);
    expect(() => gcc.parse(JSON.stringify({ ...good, version: 2 }), now)).toThrow(/version 2/);
    expect(() => gcc.parse(JSON.stringify({ ...good, clipsDir: 'relative' }), now)).toThrow(/full path/);
    expect(() => gcc.parse(JSON.stringify({ ...good, streamer: 'yes' }), now)).toThrow(/true or false/);
    expect(() => gcc.parse(JSON.stringify({ ...good, recentClips: [{ file: 'C:\\x\\a.mp4' }] }), now)).toThrow(/not a path/);
    expect(() => gcc.parse(JSON.stringify({ ...good, updatedAt: 'x' }), now)).toThrow(/updatedAt/);
    expect(() => gcc.parse('x'.repeat(gcc.MAX_BYTES + 1), now)).toThrow(/too large/);
  });
  it('a missing file is "not present"; a directory or a big file is an error', () => {
    const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
    expect(gcc.read('p', { fsImpl: { statSync() { throw enoent; } } })).toEqual({ present: false });
    expect(() => gcc.read('p', { fsImpl: { statSync: () => ({ isFile: () => false }) } })).toThrow(/not a file/);
    expect(() => gcc.read('p', { fsImpl: { statSync: () => ({ isFile: () => true, size: gcc.MAX_BYTES + 1 }) } })).toThrow(/too large/);
    const r = gcc.read('p', { now, fsImpl: { statSync: () => ({ isFile: () => true, size: 10 }), readFileSync: () => JSON.stringify(good) } });
    expect(r.present).toBe(true);
  });
  it('the path is fixed under the app data folder', () => {
    expect(gcc.bridgePath('C:\\Users\\me\\AppData\\Roaming').replace(/\\/g, '/')).toMatch(/game-control-center\/vex-bridge\.json$/);
    expect(() => gcc.bridgePath('')).toThrow();
  });
});

describe('the new channels', () => {
  const CHANNELS = ['gccbridge:read', 'secondscreen:open', 'secondscreen:close', 'secondscreen:state', 'pip:memory'];
  const { UI_ONLY_CHANNELS, validatePayload } = require('../../src/main/ipc-policy.js');
  const policySrc = read('src/main/ipc-policy.js');
  const PRIVATE_DISABLED = eval(policySrc.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval
  const schemas = read('src/main/ipc-schemas.js');
  const preload = read('src/preload.js');
  it('each has a schema, a preload entry, is UI-only and closed in a private window', () => {
    for (const c of CHANNELS) {
      expect(schemas, c).toContain(c);
      expect(preload, c).toContain("'" + c + "'");
      expect(UI_ONLY_CHANNELS.has(c), c).toBe(true);
      expect(PRIVATE_DISABLED.test(c), c).toBe(true);
    }
  });
  it('payloads are checked', () => {
    const ok = (ch, ...a) => { try { validatePayload(ch, a); return true; } catch { return false; } };
    expect(ok('secondscreen:open', { pages: [{ title: 'a', url: 'https://x.test' }], index: 0 })).toBe(true);
    expect(ok('secondscreen:open', { pages: [] })).toBe(false);
    expect(ok('secondscreen:open', { pages: [{ url: 'https://x.test' }], zoom: 9 })).toBe(false);
    expect(ok('pip:memory', { context: 'foo', hideOverGame: true })).toBe(true);
    expect(ok('pip:memory', { hideOverGame: 'yes' })).toBe(false);
    expect(ok('gccbridge:read', 'x')).toBe(false);
  });
});
