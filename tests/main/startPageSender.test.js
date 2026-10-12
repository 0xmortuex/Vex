// @vitest-environment node
//
// Audit SE6 (2026-10-10): the IPC policy let a page that is "the start page"
// use web-suggest and theme:get-custom-image (the owner's wallpaper), and the
// guest preload handed it its bridges. Both decided that from a regex that
// matched ANY file ending in /renderer/start.html: a downloaded kit, a file on
// a network share. Now it is Vex's own start.html, by its whole path, the
// check session-security already used for a tab's saved back list.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
const { createSessionSecurity } = require('../../src/main/session-security.js');

const ROOT = path.resolve('src');
const OWN = pathToFileURL(path.join(ROOT, 'renderer/start.html')).toString();

function realCheck() {
  const session = { fromPartition: (p) => ({ partition: p }) };
  return createSessionSecurity({ session, webContents: { fromId: () => null, getAllWebContents: () => [] }, root: ROOT }).isStartPageFile;
}

function setup() {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) };
  const host = { win: {}, privatePartition: null };
  const security = {
    isUiFrame: () => false,
    owner: () => host,              // a guest page of the main window
    isAuxiliary: () => false,
    ownsTarget: () => false,
    isStartPageFile: realCheck(),
  };
  installIpcPolicy(ipcMain, security);
  ipcMain.handle('theme:get-custom-image', async () => 'data:image/png;base64,THE-OWNERS-WALLPAPER');
  const call = (url) => handlers.get('theme:get-custom-image')({ sender: { id: 7 }, senderFrame: { url } }, 'user-abcd');
  ipcMain.on('start-page:is-own', (e) => { e.returnValue = security.isStartPageFile(e.senderFrame.url); });
  const isOwn = (url) => { const e = { sender: { id: 7 }, senderFrame: { url } }; handlers.get('start-page:is-own')(e); return e.returnValue; };
  return { call, isOwn };
}

describe('start-page-only channels', () => {
  it("serves Vex's own start page, with or without its ?theme=", async () => {
    const { call } = setup();
    await expect(call(OWN)).resolves.toMatch(/WALLPAPER/);
    await expect(call(OWN + '?theme=oxford')).resolves.toMatch(/WALLPAPER/);
  });
  it('refuses a downloaded file that only happens to be called renderer/start.html', async () => {
    const { call } = setup();
    await expect(call('file:///C:/Users/someone/Downloads/kit/renderer/start.html')).rejects.toThrow(/Untrusted IPC sender/);
  });
  it('refuses the same name on a network share', async () => {
    const { call } = setup();
    await expect(call('file://attacker.example/share/renderer/start.html')).rejects.toThrow(/Untrusted IPC sender/);
  });
  it('the guest preload asks main, and main answers from the frame', () => {
    const { isOwn } = setup();
    expect(isOwn(OWN)).toBe(true);
    expect(isOwn('file:///C:/Users/someone/Downloads/kit/renderer/start.html')).toBe(false);
    expect(isOwn('https://evil.example/renderer/start.html')).toBe(false);
  });
});

describe('the wiring', () => {
  it('main answers start-page:is-own with the same check; the preload asks it', () => {
    const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    expect(MAIN).toContain("ipcMain.on('start-page:is-own', (e) => { e.returnValue = secureSessions.isStartPageFile(e.senderFrame?.url || ''); });");
    const PRE = fs.readFileSync(path.join(ROOT, 'preload-webview.js'), 'latin1');
    const fn = PRE.slice(PRE.indexOf('function _isVexStartPage('), PRE.indexOf('function _isVexStartPage(') + 1400);
    expect(fn).toContain("sendSync('start-page:is-own') === true");
  });
  it('a refused question is answered no, never left waiting', () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) };
    installIpcPolicy(ipcMain, { isUiFrame: () => false, owner: () => null, isAuxiliary: () => false, ownsTarget: () => false, isStartPageFile: () => true });
    ipcMain.on('start-page:is-own', vi.fn());
    const e = { sender: { id: 9 }, senderFrame: { url: OWN } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handlers.get('start-page:is-own')(e);
    warn.mockRestore();
    expect(e.returnValue).toBe(false);
  });
});
