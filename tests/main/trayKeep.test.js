// @vitest-environment node
// Keep Vex running in the tray: which ways of closing hide the window and which really quit,
// the controller with a fake tray, and "Pause notifications" in quiet hours. No real tray here
// (the real-Electron probe for the Tray / hide / window-all-closed behaviour was run separately).
import { describe, it, expect, vi } from 'vitest';

const { createTrayKeep, decideClose, decideAllClosed, CLOSE_REASONS } = require('../../src/main/tray-keep.js');
const { createQuietHours } = require('../../src/main/quiet-hours.js');

describe('decideClose: hide or really close?', () => {
  const on = { enabled: true };
  it('hides only for the person pressing the X, with the setting on', () => {
    expect(decideClose({ ...on, reason: 'user' })).toMatchObject({ action: 'hide' });
  });
  it('closes when the setting is off (the default)', () => {
    expect(decideClose({ enabled: false, reason: 'user' })).toMatchObject({ action: 'close', why: 'setting-off' });
    expect(decideClose({ reason: 'user' }).action).toBe('close');
  });
  it('every real quit path closes, even with the setting on', () => {
    for (const reason of CLOSE_REASONS.filter(r => r !== 'user')) {
      expect(decideClose({ ...on, reason }).action, reason).toBe('close');
    }
  });
  it('safe mode, private windows and a missing tray icon never hide', () => {
    expect(decideClose({ ...on, reason: 'user', safeMode: true }).why).toBe('safe-mode');
    expect(decideClose({ ...on, reason: 'user', isPrivate: true }).why).toBe('private-window');
    expect(decideClose({ ...on, reason: 'user', trayReady: false }).why).toBe('no-tray');
  });
  it('refuses a reason it does not know instead of guessing', () => {
    expect(() => decideClose({ ...on, reason: 'because' })).toThrow(/Unknown reason/);
    expect(() => decideClose({ ...on })).toThrow(/Unknown reason/);
  });
});

describe('decideAllClosed', () => {
  it('stays only with the setting on, a tray icon, not quitting and not in safe mode', () => {
    expect(decideAllClosed({ enabled: true, trayReady: true })).toBe('stay');
    expect(decideAllClosed({ enabled: false, trayReady: true })).toBe('quit');
    expect(decideAllClosed({ enabled: true, trayReady: false })).toBe('quit');
    expect(decideAllClosed({ enabled: true, trayReady: true, quitting: true })).toBe('quit');
    expect(decideAllClosed({ enabled: true, trayReady: true, safeMode: true })).toBe('quit');
    expect(decideAllClosed()).toBe('quit');
  });
});

function fakeTray() {
  const made = [];
  class Tray {
    constructor(icon) { this.icon = icon; this.handlers = {}; this.gone = false; made.push(this); }
    setToolTip() {}
    setContextMenu(m) { this.menu = m; }
    on(ev, fn) { this.handlers[ev] = fn; }
    isDestroyed() { return this.gone; }
    destroy() { this.gone = true; }
  }
  return { Tray, made, Menu: { buildFromTemplate: (items) => items }, nativeImage: { createFromPath: (p) => ({ p, isEmpty: () => false }) } };
}
function fakeWin() {
  const w = { visible: true, hidden: 0, focus: vi.fn(), isDestroyed: () => false, isMinimized: () => false, isFocused: () => true, restore: vi.fn() };
  w.isVisible = () => w.visible;
  w.hide = () => { w.visible = false; w.hidden++; };
  w.show = () => { w.visible = true; };
  return w;
}
function make(over = {}) {
  const files = new Map();
  const fs = { existsSync: (f) => files.has(f), readFileSync: (f) => files.get(f), writeFileSync: (f, d) => files.set(f, d) };
  const el = fakeTray();
  const win = fakeWin();
  const calls = { notice: [], priv: 0, newTab: 0, reopen: 0, quit: 0 };
  const quiet = over.quiet === undefined ? { isPaused: () => false, pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) } : over.quiet;
  const tk = createTrayKeep({
    fs, file: 'tray.json', electron: el, iconPath: 'icon.ico', getMainWindow: () => (over.noWindow ? null : win),
    closePrivateWindows: () => { calls.priv++; }, newTab: () => { calls.newTab++; }, reopenMain: () => { calls.reopen++; }, quitApp: () => { calls.quit++; },
    quiet, notice: (t) => calls.notice.push(t), platform: 'win32', ...over.opts,
  });
  return { tk, el, win, calls, files, quiet };
}
const menuOf = (m) => m.el.made[0].menu;

describe('the tray controller', () => {
  it('is off by default and makes no tray icon', () => {
    const m = make(); m.tk.start();
    expect(m.tk.get().keepInTray).toBe(false);
    expect(m.el.made).toHaveLength(0);
    expect(m.tk.handleClose(m.win)).toBe(false);
    expect(m.win.hidden).toBe(0);
    expect(m.tk.handleAllClosed()).toBe(false);
  });
  it('turning it on makes the tray icon, and the X then hides the window and closes private windows', () => {
    const m = make();
    m.tk.set(true);
    expect(m.el.made).toHaveLength(1);
    expect(m.tk.handleClose(m.win)).toBe(true);
    expect(m.win.hidden).toBe(1);
    expect(m.calls.priv).toBe(1);
    expect(m.tk.handleAllClosed()).toBe(true);
  });
  it('says once, on the first hide, that Vex is still running, and remembers it', () => {
    const m = make(); m.tk.set(true);
    m.tk.handleClose(m.win); m.tk.handleClose(m.win);
    expect(m.calls.notice).toEqual(['Vex is still running in the tray. Right-click the icon to quit.']);
    expect(JSON.parse(m.files.get('tray.json'))).toMatchObject({ keepInTray: true, noticed: true });
  });
  it('a quit in progress, an update/restart close and the tray Quit item all really close', () => {
    const m = make(); m.tk.set(true);
    m.tk.markQuitting();
    expect(m.tk.handleClose(m.win)).toBe(false);
    expect(m.tk.handleAllClosed()).toBe(false);
    const n = make(); n.tk.set(true);
    n.tk.setForceClose(true);
    expect(n.tk.handleClose(n.win)).toBe(false);
    n.tk.setForceClose(false);
    expect(n.tk.handleClose(n.win)).toBe(true);
    const q = make(); q.tk.set(true);
    menuOf(q).find(i => i.label === 'Quit Vex').click();
    expect(q.calls.quit).toBe(1);
    expect(q.tk.handleClose(q.win)).toBe(false);
  });
  it('safe mode never keeps Vex in the tray and refuses the setting', () => {
    const m = make({ opts: { safeMode: true } });
    expect(() => m.tk.set(true)).toThrow(/safe mode/);
    expect(m.tk.handleClose(m.win)).toBe(false);
  });
  it('turning it off removes the icon', () => {
    const m = make(); m.tk.set(true); m.tk.set(false);
    expect(m.el.made[0].gone).toBe(true);
    expect(m.tk.handleAllClosed()).toBe(false);
  });
  it('only a real boolean is accepted', () => {
    expect(() => make().tk.set('yes')).toThrow(/on or off/);
  });
  it('left click toggles, double click opens, the menu items work', () => {
    const m = make(); m.tk.set(true);
    const tray = m.el.made[0];
    tray.handlers.click(); // visible and focused: hides
    expect(m.win.visible).toBe(false);
    tray.handlers.click(); // hidden: shows
    expect(m.win.visible).toBe(true);
    m.win.hide(); tray.handlers['double-click']();
    expect(m.win.visible).toBe(true);
    const labels = menuOf(m).filter(i => i.label).map(i => i.label);
    expect(labels).toEqual(['Open Vex', 'New tab', 'Pause notifications', 'Quit Vex']);
    m.win.hide(); menuOf(m).find(i => i.label === 'New tab').click();
    expect(m.win.visible).toBe(true);
    expect(m.calls.newTab).toBe(1);
  });
  it('Open Vex makes the window again when only the tray is left', () => {
    const m = make({ noWindow: true }); m.tk.set(true);
    m.tk.restore();
    expect(m.calls.reopen).toBe(1);
  });
  it('Pause notifications asks quiet hours to pause, and again to resume', async () => {
    let paused = false;
    const quiet = { isPaused: () => paused, pause: vi.fn(async () => { paused = true; }), resume: vi.fn(async () => { paused = false; }) };
    const m = make({ quiet }); m.tk.set(true);
    menuOf(m).find(i => i.label === 'Pause notifications').click();
    await Promise.resolve();
    expect(quiet.pause).toHaveBeenCalledWith(60 * 60 * 1000);
    await new Promise(r => setTimeout(r, 0));
    menuOf(m).find(i => i.label === 'Pause notifications').click();
    expect(quiet.resume).toHaveBeenCalled();
  });
  it('a damaged settings file leaves it off, loudly', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const again = createTrayKeep({ fs: { existsSync: () => true, readFileSync: () => '{nope', writeFileSync() {} }, file: 'x', electron: fakeTray(), iconPath: 'i', getMainWindow: () => null, closePrivateWindows() {}, newTab() {}, reopenMain() {}, quitApp() {}, notice() {}, platform: 'win32' });
    expect(again.get().keepInTray).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('quiet hours: pause notifications', () => {
  const memStore = () => { const mm = new Map(); return { read: async (k) => (mm.has(k) ? mm.get(k) : null), write: async (k, v) => { mm.set(k, v); return true; } }; };
  it('holds ordinary toasts while paused (quiet hours off), lets reminders through, and releases on resume', async () => {
    const t = { now: new Date(2026, 9, 16, 12, 0).getTime() };
    const show = vi.fn(async () => ({ ok: true }));
    const q = createQuietHours({ store: memStore(), show, now: () => t.now, setIntervalFn: () => null });
    await q.init();
    await q.pause(60 * 60 * 1000);
    expect(q.isPaused()).toBe(true);
    await q.gated({ title: 'A download finished' });
    await q.gated({ title: 'Reminder', kind: 'reminder' });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].title).toBe('Reminder');
    await q.resume();
    expect(q.isPaused()).toBe(false);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[1][0].title).toBe('A download finished');
  });
  it('a pause ends by itself and the tick releases what was held; it is capped at 8 hours', async () => {
    const t = { now: new Date(2026, 9, 16, 12, 0).getTime() };
    const show = vi.fn(async () => ({ ok: true }));
    const q = createQuietHours({ store: memStore(), show, now: () => t.now, setIntervalFn: () => null });
    await q.init();
    const r = await q.pause(99 * 3600 * 1000);
    expect(r.until - t.now).toBe(8 * 3600 * 1000);
    await q.gated({ title: 'Held' });
    expect(await q.tick()).toEqual({ released: 0 });
    t.now += 8 * 3600 * 1000 + 1;
    expect(q.isPaused()).toBe(false);
    expect(await q.tick()).toEqual({ released: 1 });
  });
  it('rejects a pause with no length', async () => {
    const q = createQuietHours({ store: memStore(), show: vi.fn(), setIntervalFn: () => null });
    await expect(q.pause(0)).rejects.toThrow(/length/);
    await expect(q.pause(NaN)).rejects.toThrow(/length/);
  });
});

describe('wiring in main.js and session-security.js', () => {
  const fsx = require('fs');
  const main = fsx.readFileSync(require('path').join(__dirname, '../../src/main.js'), 'utf8');
  const sec = fsx.readFileSync(require('path').join(__dirname, '../../src/main/session-security.js'), 'utf8');
  it('window-all-closed asks the tray before quitting', () => {
    const at = main.indexOf("app.on('window-all-closed'");
    const body = main.slice(at, main.indexOf('});', at));
    expect(body.indexOf('handleAllClosed')).toBeGreaterThan(-1);
    expect(body.indexOf('handleAllClosed')).toBeLessThan(body.indexOf('app.quit()'));
  });
  it('every quit path marks the tray as quitting: before-quit and session-end', () => {
    expect(main).toMatch(/app\.on\('before-quit', \(\) => \{ if \(_trayKeepInst\) _trayKeepInst\.markQuitting\(\); \}\);/);
    expect(main).toMatch(/win\.on\('session-end', \(\) => \{ if \(_trayKeepInst\) _trayKeepInst\.markQuitting\(\); \}\);/);
  });
  it('the three programmatic window closes (update, other profile update, restart) go through _closeMainForReal', () => {
    expect((main.match(/^\s+_closeMainForReal\(win\);/gm) || []).length).toBe(3);
  });
  it('the close hook runs before the save-and-close flow and only stops the close when it hid the window', () => {
    const at = sec.indexOf("win.on('close'");
    const body = sec.slice(at, at + 700);
    expect(body.indexOf('beforeClose(win, host)')).toBeGreaterThan(-1);
    expect(body.indexOf('beforeClose(win, host)')).toBeLessThan(body.indexOf("host.flushing = true"));
  });
  it('is off by default: nothing reads the setting as on without a saved true', () => {
    expect(main).toMatch(/createTrayKeep\(\{[\s\S]*tray-prefs\.json/);
    expect(fsx.readFileSync(require('path').join(__dirname, '../../src/main/tray-keep.js'), 'utf8')).toMatch(/keepInTray: false/);
  });
});
