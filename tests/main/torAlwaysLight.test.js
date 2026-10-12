// @vitest-environment node
//
// Tor tabs always tell pages "light" (prefers-color-scheme), whatever Vex's
// theme or Website appearance says, as Tor Browser does: every Tor user looks
// alike. Website appearance (src/main/website-appearance.js) sets the one
// app-wide nativeTheme.themeSource, so a dark Vex had Tor pages report dark.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
const path = require('path');

const { syncTorLight, LIGHT } = require('../../src/main/tor-light.js');
const { markRoutedSession } = require('../../src/main/routing.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');

function fakePage(ses) {
  const dbg = new EventEmitter();
  let attached = false;
  dbg.isAttached = () => attached;
  dbg.attach = vi.fn(() => { attached = true; });
  dbg.detach = vi.fn(() => { attached = false; dbg.emit('detach', {}, 'target closed'); });
  dbg.sendCommand = vi.fn(async () => ({}));
  return { session: ses, debugger: dbg, isDestroyed: () => false, setWebRTCIPHandlingPolicy: vi.fn() };
}

describe('a page in a Tor session reports light', () => {
  it('a Tor tab is held light, and so are the cross-site frames in it', async () => {
    const page = fakePage({ __vexTor: true });
    await syncTorLight(page);
    expect(page.debugger.attach).toHaveBeenCalledOnce();
    expect(page.debugger.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', { features: LIGHT });
    expect(LIGHT).toEqual([{ name: 'prefers-color-scheme', value: 'light' }]);
    expect(page.debugger.sendCommand).toHaveBeenCalledWith('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    page.debugger.sendCommand.mockClear();
    page.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'S1', targetInfo: { type: 'iframe' } });
    await new Promise(r => setImmediate(r));
    expect(page.debugger.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', { features: LIGHT }, 'S1');
    expect(page.debugger.sendCommand).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', {}, 'S1');
  });

  it('a second sync does not attach again', async () => {
    const page = fakePage({ __vexTor: true });
    await syncTorLight(page);
    await syncTorLight(page);
    expect(page.debugger.attach).toHaveBeenCalledOnce();
  });

  it('a page outside Tor is left alone', async () => {
    const page = fakePage({ __vexRouted: true });
    await syncTorLight(page);
    expect(page.debugger.attach).not.toHaveBeenCalled();
    expect(page.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it('a session set back to direct lets its pages follow Vex again', async () => {
    const ses = { __vexTor: true };
    const page = fakePage(ses);
    await syncTorLight(page);
    ses.__vexTor = false;
    await syncTorLight(page);
    expect(page.debugger.detach).toHaveBeenCalledOnce();
  });

  it('a hold lost (DevTools detached it) is taken again on the next sync', async () => {
    const page = fakePage({ __vexTor: true });
    await syncTorLight(page);
    page.debugger.detach();
    page.debugger.detach.mockClear();
    await syncTorLight(page);
    expect(page.debugger.attach).toHaveBeenCalledTimes(2);
  });

  it('a failed emulation is an error, not a quiet dark Tor page', async () => {
    const page = fakePage({ __vexTor: true });
    page.debugger.sendCommand = vi.fn(async () => { throw new Error('boom'); });
    await expect(syncTorLight(page)).rejects.toThrow(/boom/);
  });

  it('routing a session through Tor (or off it) syncs the pages already open in it', () => {
    const ses = {};
    const mine = fakePage(ses), other = fakePage({});
    const sync = vi.fn(async () => {});
    markRoutedSession(ses, 'tor', [mine, other], sync);
    expect(sync).toHaveBeenCalledWith(mine);
    expect(sync).not.toHaveBeenCalledWith(other);
  });
});

describe('main wires it for every page and every route change', () => {
  const MAIN = read('src/main.js');
  it('every page a Tor session opens, popups included, before the webview-only part, and again as it navigates', () => {
    const handler = MAIN.slice(MAIN.indexOf("app.on('web-contents-created', (_event, contents) => {\n  // Tor tabs"));
    const sync = handler.indexOf('_syncTorLight(contents)');
    expect(sync).toBeGreaterThan(0);
    expect(sync).toBeLessThan(handler.indexOf("if (type !== 'webview') return;"));
    expect(handler.slice(0, handler.indexOf("if (type !== 'webview') return;"))).toMatch(/did-start-navigation[\s\S]*isMainFrame && !isInPlace\) _syncTorLight\(contents\)/);
  });
  it('each markRoutedSession call passes the sync', () => {
    const calls = MAIN.match(/markRoutedSession\([^;]*\);/g);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) expect(call, call).toContain('_syncTorLight');
  });
  it('the Website appearance hint says so, in Turkish too', () => {
    const html = read('src/renderer/index.html');
    expect(html).toContain('>Tor tabs always show sites light, like Tor Browser.</span>');
    expect(read('src/renderer/js/i18n-ui.js')).toContain("'Tor tabs always show sites light, like Tor Browser.': '");
  });
});
