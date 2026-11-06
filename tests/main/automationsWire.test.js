// Page automations: the Electron side, with fakes. Every IPC channel is answered, the encrypted file is the only
// thing written, and the window a run uses is sandboxed, muted, never opens a popup and cancels a download.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const { registerAutomations, createElectronDriverFactory } = require('../../src/main/automations-wire.js');
const { SecretStore } = require('../../src/main/file-store.js');

const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(Buffer.from(s).map(b => b ^ 0x21)), decryptString: (b) => Buffer.from(Buffer.from(b).map(x => x ^ 0x21)).toString() };

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.audioMuted = false; this.opener = null; this.loading = false; this.url = ''; }
  setAudioMuted(v) { this.audioMuted = v; }
  setWindowOpenHandler(fn) { this.opener = fn; }
  async loadURL(u) { this.url = u; }
  getURL() { return this.url; }
  isLoading() { return this.loading; }
  async executeJavaScript(code) { this.last = code; return { ok: true }; }
  async capturePage() { return { isEmpty: () => false, getSize: () => ({ width: 400 }), toJPEG: () => Buffer.from('JPG') }; }
}
function makeWindowClass(log) {
  return class FakeWindow {
    constructor(opts) { this.opts = opts; this.webContents = new FakeWebContents(); this.shown = false; this.destroyed = false; log.windows.push(this); }
    show() { this.shown = true; } focus() {} isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  };
}

describe('the window a run uses', () => {
  it('is sandboxed, in the recording\'s own session, muted, no popups, no non-web navigation, and goes away', async () => {
    const log = { windows: [] };
    const session = new EventEmitter();
    const make = createElectronDriverFactory({ BrowserWindow: makeWindowClass(log), getSession: (p) => { session.partition = p; return session; } });
    const d = await make('persist:container-work', { visible: false, name: 'Grades' });
    const w = log.windows[0];
    expect(session.partition).toBe('persist:container-work');
    expect(w.opts.webPreferences).toMatchObject({ session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    expect(w.opts.webPreferences.preload).toBeUndefined();
    expect(w.opts.show).toBe(false);
    expect(w.webContents.audioMuted).toBe(true);
    expect(w.webContents.opener()).toEqual({ action: 'deny' });
    const ev = { prevented: false, preventDefault() { this.prevented = true; } };
    w.webContents.emit('will-navigate', ev, 'file:///C:/secret'); expect(ev.prevented).toBe(true);
    const ok = { prevented: false, preventDefault() { this.prevented = true; } };
    w.webContents.emit('will-navigate', ok, 'https://example.com/next'); expect(ok.prevented).toBe(false);
    // a download made by this window is cancelled; another window's is not touched
    const dl = { prevented: false, preventDefault() { this.prevented = true; } };
    session.emit('will-download', dl, {}, w.webContents); expect(dl.prevented).toBe(true);
    const other = { prevented: false, preventDefault() { this.prevented = true; } };
    session.emit('will-download', other, {}, new FakeWebContents()); expect(other.prevented).toBe(false);
    expect((await d.screenshot())).toMatch(/^data:image\/jpeg;base64,/);
    await d.close();
    expect(w.destroyed).toBe(true);
    expect(session.listenerCount('will-download')).toBe(0);
  });
  it('a visible run shows its window; "reveal" shows a hidden one for an ask-me step', async () => {
    const log = { windows: [] };
    const make = createElectronDriverFactory({ BrowserWindow: makeWindowClass(log), getSession: () => new EventEmitter() });
    const v = await make('persist:main', { visible: true });
    expect(log.windows[0].shown).toBe(true);
    const h = await make('persist:main', { visible: false });
    expect(log.windows[1].shown).toBe(false);
    await h.reveal();
    expect(log.windows[1].shown).toBe(true);
    await v.close(); await h.close();
  });
});

describe('registerAutomations', () => {
  function build() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-autowire-'));
    const handlers = new Map();
    const ipcMain = { handle: (c, fn) => handlers.set(c, fn) };
    const sent = [];
    const win = { isDestroyed: () => false, isFocused: () => true, isVisible: () => true, webContents: { send: (c, e) => sent.push([c, e]) } };
    const svc = registerAutomations({
      ipcMain, BrowserWindow: makeWindowClass({ windows: [] }), getSession: () => new EventEmitter(), secretStore: new SecretStore(safeStorage), userDataPath: dir,
      notifier: { show: async () => ({}) }, osScheduler: { supported: false }, mainWindowOf: () => win, readRouting: () => ({}), focusMainWindow: () => {}, log: () => {},
    });
    const call = (c, ...a) => handlers.get(c)({}, ...a);
    return { dir, handlers, call, sent, svc };
  }
  it('answers all fifteen channels, keeps the data in one encrypted file and passes errors to the caller', async () => {
    const t = build();
    expect(t.handlers.size).toBe(15);
    await t.call('automations:state');
    expect((await t.call('automations:state')).enabled).toBe(false);
    await expect(t.call('automations:run', 'nothing')).rejects.toThrow(/no longer exists|switched off/);
    await t.call('automations:set-enabled', true);
    const rec = await t.call('automations:save', { name: 'W', partition: 'persist:main', steps: [{ type: 'open', url: 'https://example.com/' }, { type: 'type', value: 'wire-secret-words', target: { role: 'textbox', name: 'Q', css: '#q' } }] });
    expect(rec.id).toBeTruthy();
    expect(fs.readdirSync(t.dir)).toEqual(['automations.enc']);
    expect(fs.readFileSync(path.join(t.dir, 'automations.enc')).toString('latin1')).not.toContain('wire-secret-words');
    expect(JSON.parse(await t.call('automations:export', rec.id)).steps.some(s => s.value)).toBe(false);
    await expect(t.call('automations:save', { name: 'bad', partition: 'persist:route-tor', steps: [{ type: 'open', url: 'https://example.com/' }] })).rejects.toThrow(/private, Tor or routed/);
    await expect(t.call('automations:decide', 'rr', 'approve')).rejects.toThrow(/no longer open/);
    expect(await t.call('automations:stop')).toBe(false);
    await t.call('automations:kill');
    await expect(t.call('automations:run', rec.id)).rejects.toThrow(/kill switch/);
    expect(t.sent.length).toBeGreaterThan(0);
    expect(t.sent.every(([c]) => c === 'automations:event')).toBe(true);
  });
});
