// @vitest-environment node
//
// An Open as App window (and the overlay) shows one web page in Vex's own
// session, so the session's page preloads run in it. They asked main for the
// ad blocker's cosmetic filters, the fingerprint and passkey settings and the
// answer to the page's alert/confirm, and every one was refused as
// "Untrusted IPC sender" (2026-10-08). Those are now allowed for that window
// and nothing else is; the Vex shortcuts the preload used to send from it are
// no longer sent at all (there is no tab for them to act on).

import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

const ROOT = path.resolve(__dirname, '../../src');
const WEB_WINDOW_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled',
  'privacy:config-sync', 'compatibility:get', 'page-dialog'];

function build() {
  const session = { fromPartition: (p) => ({ partition: p }) };
  const webContents = { fromId: () => null, getAllWebContents: () => [] };
  const security = createSessionSecurity({ session, webContents, root: ROOT });
  const appWindow = () => {
    const handlers = {};
    const mainFrame = { url: 'https://en.wikipedia.org/wiki/Tea' };
    return {
      id: 4242, mainFrame, isDestroyed: () => false,
      getOwnerBrowserWindow: () => null,
      once: (ev, fn) => { handlers[ev] = fn; },
      destroy: () => handlers.destroyed && handlers.destroyed(),
    };
  };
  return { security, appWindow };
}

describe('an Open as App window and the IPC policy', () => {
  it('may use the channels its page preloads need, from any frame', () => {
    const { security, appWindow } = build();
    const win = appWindow();
    security.registerWebWindow(win);
    for (const channel of WEB_WINDOW_CHANNELS) {
      expect(security.isAuxiliary({ sender: win, senderFrame: win.mainFrame }, channel), channel).toBe(true);
      expect(security.isAuxiliary({ sender: win, senderFrame: { url: 'https://ads.example/frame' } }, channel), channel + ' in a frame').toBe(true);
    }
  });

  it('may not use anything else, and an unregistered or closed window gets nothing', () => {
    const { security, appWindow } = build();
    const win = appWindow();
    security.registerWebWindow(win);
    for (const channel of ['guest:page-shortcut', 'vault:get', 'storage-save', 'tabs:favicon', 'geolocation:get']) {
      expect(security.isAuxiliary({ sender: win, senderFrame: win.mainFrame }, channel), channel).toBe(false);
    }
    const other = appWindow();
    other.id = 99;
    expect(security.isAuxiliary({ sender: other, senderFrame: other.mainFrame }, 'page-dialog')).toBe(false);
    win.destroy();
    expect(security.isAuxiliary({ sender: win, senderFrame: win.mainFrame }, 'page-dialog')).toBe(false);
  });

  it('reaches the handlers through the real policy, which still refuses the rest', async () => {
    const { security, appWindow } = build();
    const win = appWindow();
    security.registerWebWindow(win);
    const invokes = new Map(), sends = new Map();
    const ipcMain = { handle: (ch, fn) => invokes.set(ch, fn), on: (ch, fn) => sends.set(ch, fn) };
    installIpcPolicy(ipcMain, security);
    const reached = [];
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', () => { reached.push('filters'); return 'ok'; });
    ipcMain.on('page-dialog', (event) => { reached.push('dialog'); event.returnValue = true; });
    ipcMain.on('guest:page-shortcut', () => reached.push('shortcut'));
    const event = () => ({ sender: win, senderFrame: win.mainFrame });
    expect(await invokes.get('@ghostery/adblocker/inject-cosmetic-filters')(event(), 'https://en.wikipedia.org/wiki/Tea')).toBe('ok');
    const dialog = event();
    sends.get('page-dialog')(dialog, { type: 'confirm', message: 'Sure?', value: '' });
    expect(dialog.returnValue).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sends.get('guest:page-shortcut')(event(), { key: 'd', shift: false });
    expect(warn).toHaveBeenCalledWith('[IPC] refused "%s": %s', 'guest:page-shortcut', 'Untrusted IPC sender');
    warn.mockRestore();
    expect(reached).toEqual(['filters', 'dialog']);
  });
});

describe('where the window is made', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  it('Open as App and the overlay register their window and tell the preload', () => {
    const app = main.slice(main.indexOf("ipcMain.handle('app:open-as-app'"));
    expect(app.slice(0, 900)).toMatch(/additionalArguments: \['--vex-web-window'\]/);
    expect(app.slice(0, 900)).toMatch(/secureSessions\.registerWebWindow\(win\.webContents\)/);
    const overlay = main.slice(main.indexOf("ipcMain.handle('overlay:open'"));
    expect(overlay.slice(0, 900)).toMatch(/secureSessions\.registerWebWindow\(_overlay\.webContents\)/);
    expect(fs.readFileSync(path.join(ROOT, 'main/overlay.js'), 'utf8')).toMatch(/additionalArguments: \['--vex-web-window'\]/);
  });

  it('the guest preload sends no Vex shortcuts from such a window', () => {
    const pre = fs.readFileSync(path.join(ROOT, 'preload-webview.js'), 'utf8');
    const block = pre.slice(pre.indexOf("var PAGE_FIRST_PLAIN = 'bhmdpu'") - 600, pre.indexOf("var PAGE_FIRST_PLAIN = 'bhmdpu'"));
    expect(block).toMatch(/process\.argv\.indexOf\('--vex-web-window'\) !== -1\) return;/);
  });
});
