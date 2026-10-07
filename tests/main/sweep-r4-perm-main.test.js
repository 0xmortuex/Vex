// @vitest-environment node
//
// Main-side fixes from the r4 permissions sweep (2026-09-30):
//   * a site's permission decisions (location too) were one store for every
//     persist: session, so Block in a container blocked it in the main window
//     and Allow there allowed it everywhere (permissions.js);
//   * a JavaScript-off tab built again more than a minute after its old page
//     went (a background tab, built when next shown) lost its back list, and
//     the list went to whichever webview attached next (session-security.js);
//   * chrome.tabs.query/get could not tell which Vex tab is in front; main now
//     says, per window (main.js, _activeTabsFor).
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const { createPermissionService } = require('../../src/main/permissions.js');
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { validate } = require('../../src/main/ipc-schemas.js');

describe('site permissions are kept per container', () => {
  const dirs = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  function live(dir) {
    if (!dir) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-')); dirs.push(dir); }
    const ipcMain = { on: vi.fn(), handle: vi.fn() };
    const send = vi.fn();
    const host = { win: { webContents: { send } } };
    const svc = createPermissionService({ userDataPath: dir, secureSessions: { partitionOf: (c) => c.partition, owner: () => host }, ipcMain, _markHidRequestActive: () => {} });
    svc.permissionsReady();
    const handlers = {};
    const ses = { setPermissionRequestHandler: (fn) => { handlers.request = fn; }, setPermissionCheckHandler: (fn) => { handlers.check = fn; } };
    svc.wirePermissionsOnSession(ses, 'test', {});
    const respond = ipcMain.handle.mock.calls.find(c => c[0] === 'permission:respond')[1];
    const sessions = new Map();
    const sessionOf = (partition) => { if (!sessions.has(partition)) sessions.set(partition, { partition }); return sessions.get(partition); };
    const tab = (partition) => ({ partition, session: sessionOf(partition), getURL: () => 'https://maps.example/' });
    // Ask for the location from a tab in that partition: the answer, or the prompt.
    const ask = (partition) => {
      let answer;
      send.mockClear();
      handlers.request(tab(partition), 'geolocation', (ok) => { answer = ok; }, { requestingUrl: 'https://maps.example/' });
      return answer !== undefined ? answer : send.mock.calls[0][1];
    };
    const answer = (prompt, decision, remember = true) => respond({ sender: {} }, { id: prompt.id, decision, remember });
    const allowed = (partition) => handlers.check(tab(partition), 'geolocation', 'https://maps.example/', {});
    return { svc, dir, ask, answer, allowed };
  }

  it('a Block in a container stays in that container; main and the other containers still ask', async () => {
    const v = live();
    await v.answer(v.ask('persist:container-work'), 'deny');
    expect(v.ask('persist:container-work')).toBe(false);
    expect(v.ask('persist:main')).toMatchObject({ permission: 'geolocation' });        // asked, not refused
    expect(v.ask('persist:container-shopping')).toMatchObject({ permission: 'geolocation' });
    expect(v.ask('persist:route-tor')).toMatchObject({ permission: 'geolocation' });
  });

  it('an Allow in the main window does not reach a container; the app panels share main\'s', async () => {
    const v = live();
    await v.answer(v.ask('persist:main'), 'allow');
    expect(v.allowed('persist:main')).toBe(true);
    expect(v.allowed('persist:discord')).toBe(true);
    expect(v.allowed('persist:container-work')).toBe(false);
    expect(v.allowed('persist:route-proxy-abc')).toBe(false);
  });

  it('decisions saved before stay with persist:main, and each store survives a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-')); dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify({ 'https://maps.example::geolocation': 'allow' }));
    const v = live(dir);
    expect(v.allowed('persist:main')).toBe(true);
    expect(v.allowed('persist:container-work')).toBe(false);
    await v.answer(v.ask('persist:container-work'), 'deny', 'day');
    const again = live(dir);
    expect(again.allowed('persist:main')).toBe(true);
    expect(again.ask('persist:container-work')).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'permissions.json'), 'utf8'))).toEqual({ 'https://maps.example::geolocation': 'allow' });
  });

  it('a private window\'s decisions are still never written', async () => {
    const v = live();
    await v.answer(v.ask('private:abc'), 'allow');
    expect(v.allowed('private:abc')).toBe(true);
    expect(fs.existsSync(path.join(v.dir, 'permissions-containers.json'))).toBe(false);
    expect(fs.existsSync(path.join(v.dir, 'permissions.json'))).toBe(false);
  });

  it('Settings lists every store, naming where a decision applies; Revoke and Clear all reach the containers', async () => {
    const v = live();
    await v.answer(v.ask('persist:main'), 'allow');
    await v.answer(v.ask('persist:container-work'), 'deny', 'day');
    await v.answer(v.ask('persist:route-tor'), 'deny');
    const all = v.svc.loadPermissionDecisions();
    expect(Object.keys(all).filter(k => k !== '__until__').sort()).toEqual([
      'https://maps.example (in the work container)::geolocation',
      'https://maps.example (through Tor)::geolocation',
      'https://maps.example::geolocation',
    ]);
    expect(Object.keys(all.__until__)).toEqual(['https://maps.example (in the work container)::geolocation']);
    // Revoke as main.js does it: load, delete the key, save.
    const d = v.svc.loadPermissionDecisions();
    delete d['https://maps.example (in the work container)::geolocation'];
    await v.svc.savePermissionDecisions(d);
    expect(v.ask('persist:container-work')).toMatchObject({ permission: 'geolocation' });
    expect(v.ask('persist:route-tor')).toBe(false);
    expect(v.allowed('persist:main')).toBe(true);
    await v.svc.savePermissionDecisions({});
    expect(v.ask('persist:route-tor')).toMatchObject({ permission: 'geolocation' });
    expect(v.allowed('persist:main')).toBe(false);
    expect(v.svc.loadPermissionDecisions()).toEqual({});
  });

  it('a key naming a container that has no decisions is refused, not filed under main', () => {
    const v = live();
    expect(() => v.svc.savePermissionDecisions({ 'https://a.example (in the ghost container)::camera': 'allow' })).toThrow('ghost container');
  });
});

function harness() {
  const sessions = new Map();
  const session = { fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, { partition: p }); return sessions.get(p); } };
  const handlers = {};
  const closed = [];
  const win = { on: vi.fn(), once: (ev, fn) => { if (ev === 'closed') closed.push(fn); }, webContents: { id: 1, on: (ev, fn) => { handlers[ev] = fn; }, send: vi.fn(), setWindowOpenHandler: vi.fn(), isDestroyed: () => false } };
  const all = [{ id: 1, isDestroyed: () => false, getType: () => 'window' }];
  const security = createSessionSecurity({ session, webContents: { getAllWebContents: () => all, fromId: () => null }, root: process.cwd() + '/src' });
  security.registerHost(win);
  let nextId = 10;
  const guest = ({ javascript = true, entries = [], index = -1 } = {}) => {
    const on = {};
    const g = {
      id: nextId++, session: session.fromPartition('persist:main'),
      isDestroyed: () => false, getType: () => 'webview', hostWebContents: win.webContents,
      getLastWebPreferences: () => ({ javascript }),
      on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
      once: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
      emit: (ev, ...a) => (on[ev] || []).forEach(fn => fn(...a)),
      navigationHistory: {
        entries, index,
        getAllEntries: () => g.navigationHistory.entries,
        getActiveIndex: () => g.navigationHistory.index,
        restore: vi.fn(() => Promise.resolve()),
      },
    };
    return g;
  };
  const params = { partition: 'persist:main' };
  const willAttach = (prefs, g, { refuse = false } = {}) => {
    const event = { preventDefault: vi.fn() };
    handlers['will-attach-webview'](event, prefs, params);
    if (!refuse) all.push(g);
  };
  const didAttach = (g) => handlers['did-attach-webview']({}, g);
  // As measured in Vex's Electron: 'did-attach-webview' in the same run.
  const attach = async (prefs, g) => { willAttach(prefs, g); didAttach(g); await Promise.resolve(); };
  // As Electron may do it: 'did-attach-webview' after other code has run.
  const attachLater = async (prefs, g) => { willAttach(prefs, g); await Promise.resolve(); didAttach(g); };
  // A JavaScript-off tab that has been somewhere, then gone.
  const offTab = async (url = 'https://off.example/') => {
    const off = guest({ javascript: false });
    await attach({}, off);
    off.navigationHistory.entries = [{ url }]; off.navigationHistory.index = 0;
    off.emit('did-navigate');
    off.emit('destroyed');
    return off;
  };
  return { guest, attach, attachLater, willAttach, didAttach, offTab, closeWindow: () => closed.forEach(fn => fn()) };
}

describe('a JavaScript-off tab built again keeps its back list', () => {
  afterEach(() => vi.useRealTimers());

  it('when a background tab is built again ten minutes later, and not after half an hour', async () => {
    vi.useFakeTimers();
    const h = harness();
    const late = await h.offTab();
    const later = await h.offTab();
    vi.advanceTimersByTime(10 * 60 * 1000);
    const a = h.guest();
    await h.attach({ vexHistoryFrom: String(late.id) }, a);
    expect(a.navigationHistory.restore).toHaveBeenCalledWith({ index: 0, entries: [{ url: 'https://off.example/' }] });
    vi.advanceTimersByTime(21 * 60 * 1000);
    const b = h.guest();
    await h.attach({ vexHistoryFrom: String(later.id) }, b);
    expect(b.navigationHistory.restore).not.toHaveBeenCalled();
  });

  it('no more than 50 lists are kept, the oldest going first; none once the window closes', async () => {
    const h = harness();
    const first = await h.offTab();
    const kept = [];
    for (let i = 0; i < 50; i++) kept.push(await h.offTab());
    const a = h.guest();
    await h.attach({ vexHistoryFrom: String(first.id) }, a);
    expect(a.navigationHistory.restore).not.toHaveBeenCalled();
    const b = h.guest();
    await h.attach({ vexHistoryFrom: String(kept[0].id) }, b);
    expect(b.navigationHistory.restore).toHaveBeenCalled();
    h.closeWindow();
    const c = h.guest();
    await h.attach({ vexHistoryFrom: String(kept[1].id) }, c);
    expect(c.navigationHistory.restore).not.toHaveBeenCalled();
  });

  it('as the guest says it attached, in the same run or later', async () => {
    const h = harness();
    const offA = await h.offTab(), offB = await h.offTab();
    const a = h.guest();
    await h.attach({ vexHistoryFrom: String(offA.id) }, a);
    const b = h.guest();
    await h.attachLater({ vexHistoryFrom: String(offB.id) }, b);
    expect(a.navigationHistory.restore).toHaveBeenCalled();
    expect(b.navigationHistory.restore).toHaveBeenCalled();
  });

  it('goes to the webview made for it, though another attaches in between', async () => {
    const h = harness();
    const off = await h.offTab();
    const mine = h.guest(), other = h.guest();
    h.willAttach({ vexHistoryFrom: String(off.id) }, mine);
    await Promise.resolve();
    h.willAttach({}, other);
    await Promise.resolve();
    h.didAttach(other);                     // the other one says it attached first
    h.didAttach(mine);
    expect(other.navigationHistory.restore).not.toHaveBeenCalled();
    expect(mine.navigationHistory.restore).toHaveBeenCalled();
  });

  it('a refused attach hands it to nobody', async () => {
    const h = harness();
    const off = await h.offTab();
    const refused = h.guest(), next = h.guest();
    h.willAttach({ vexHistoryFrom: String(off.id) }, refused, { refuse: true });
    await Promise.resolve();
    await h.attach({}, next);
    expect(next.navigationHistory.restore).not.toHaveBeenCalled();
  });
});

describe('main: which tab is in front, for an extension', () => {
  const MAIN = fs.readFileSync(path.resolve('src/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const from = MAIN.indexOf('let _lastFocusedHostWin = null;');
  const code = MAIN.slice(from, MAIN.indexOf('\n}\n', from) + 3);
  const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/bg.html';
  const extSession = { name: 'ext' };

  function mainSide(windows, pages) {
    const hosts = new Map();
    const focus = [];
    windows.forEach((w, i) => {
      w.webContents = { id: 100 + i, executeJavaScript: vi.fn(async () => w.front) };
      w.isDestroyed = () => false;
      hosts.set(w.webContents.id, { win: w });
    });
    const ctx = vm.createContext({
      app: { on: (ev, fn) => { if (ev === 'browser-window-focus') focus.push(fn); } },
      webContents: { fromId: (id) => pages[id] || null },
      secureSessions: { hosts },
      mainWindow: windows[0],
      Number, String, Error,
    });
    vm.runInContext(code + '\nthis.active = _activeTabsFor;', ctx);
    return { active: ctx.active, focus: (w) => focus.forEach(fn => fn({}, w)) };
  }
  const page = (session = extSession) => ({ isDestroyed: () => false, session });

  it('the tab in front of each window, and of the window used last', async () => {
    const a = { front: 7 }, b = { front: 9 };
    const m = mainSide([a, b], { 7: page(), 9: page() });
    expect(await m.active(OWN, extSession)).toEqual({ ids: [7, 9], current: 7 });   // none focused yet: the main window
    m.focus(b);
    expect(await m.active(OWN, extSession)).toEqual({ ids: [7, 9], current: 9 });
  });

  it('names no page of another session, and none for a tab not made yet', async () => {
    const m = mainSide([{ front: 7 }, { front: null }], { 7: page({ name: 'private' }) });
    expect(await m.active(OWN, extSession)).toEqual({ ids: [], current: null });
  });

  it('only an extension asks; the channel is wired, schema\'d and allowed for extension pages', async () => {
    const m = mainSide([{ front: 7 }], { 7: page() });
    await expect(m.active('https://example.com/', extSession)).rejects.toThrow('Only an extension');
    expect(MAIN).toContain("ipcMain.handle('extensions:active-tabs', (event) => _activeTabsFor(event.senderFrame?.url, event.sender.session));");
    expect(MAIN).toContain("worker.ipc.handle('extensions:active-tabs', () => _activeTabsFor(worker.scriptURL, ses));");
    expect(() => validate('extensions:active-tabs', [])).not.toThrow();
    const security = createSessionSecurity({ session: { fromPartition: () => ({}) }, webContents: { getAllWebContents: () => [], fromId: () => null }, root: process.cwd() + '/src' });
    const frame = (url) => { const mainFrame = { url }; return { sender: { mainFrame }, senderFrame: mainFrame }; };
    expect(security.isAuxiliary(frame(OWN), 'extensions:active-tabs')).toBe(true);
    expect(security.isAuxiliary(frame('https://example.com/'), 'extensions:active-tabs')).toBe(false);
  });
});
