// src/main/archive-viewer.js — a saved page opens in a window that runs no
// script and can fetch nothing.

import { describe, it, expect, vi } from 'vitest';
const path = require('path');
const { pathToFileURL } = require('url');
const { openCopy, viewerPreferences, isAllowedRequest } = require('../../src/main/archive-viewer.js');

describe('the viewer window', () => {
  it('has scripts off, is sandboxed and has no Node or preload', () => {
    const p = viewerPreferences();
    expect(p.javascript).toBe(false);
    expect(p.sandbox).toBe(true);
    expect(p.nodeIntegration).toBe(false);
    expect(p.contextIsolation).toBe(true);
    expect(p.webviewTag).toBe(false);
    expect(p.preload).toBeUndefined();
  });

  it('lets through only the copy itself and inline data, never the network', () => {
    const file = pathToFileURL(path.resolve('C:/data/archive/0123456789abcdef.mhtml')).href;
    expect(isAllowedRequest(file, file)).toBe(true);
    expect(isAllowedRequest('data:image/png;base64,AAAA', file)).toBe(true);
    for (const u of ['https://example.com/logo.png', 'http://127.0.0.1:8080/x.css', 'wss://example.com/socket', 'ftp://example.com/', 'file:///C:/Users/me/secret.txt', ''])
      expect(isAllowedRequest(u, file), u).toBe(false);
  });

  it('cancels every request but the copy, denies permissions and refuses new windows and navigation', () => {
    let beforeRequest, permission;
    const session = {
      webRequest: { onBeforeRequest: (fn) => { beforeRequest = fn; } },
      setPermissionRequestHandler: (fn) => { permission = fn; },
      setPermissionCheckHandler: vi.fn(),
    };
    const handlers = {};
    let openHandler, ctor;
    class FakeWindow {
      constructor(opts) {
        ctor = opts;
        this.webContents = {
          setWindowOpenHandler: (fn) => { openHandler = fn; },
          on: (name, fn) => { handlers[name] = fn; },
        };
      }
      loadURL(u) { this.loaded = u; }
      once() {}
    }
    const file = path.resolve('C:/data/archive/0123456789abcdef.mhtml');
    const win = openCopy({ BrowserWindow: FakeWindow, session, file, title: 'T', url: 'https://example.com/', at: 1 });
    expect(ctor.webPreferences.javascript).toBe(false);
    expect(ctor.webPreferences.session).toBe(session);
    expect(win.loaded).toBe(pathToFileURL(file).href);

    const verdict = (url) => { let r; beforeRequest({ url }, (x) => { r = x; }); return r; };
    expect(verdict(pathToFileURL(file).href)).toEqual({});
    expect(verdict('https://tracker.example/pixel.gif')).toEqual({ cancel: true });
    expect(win.vexArchiveBlocked).toContain('https://tracker.example/pixel.gif');

    let granted; permission(null, 'geolocation', (v) => { granted = v; });
    expect(granted).toBe(false);
    expect(openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    const ev = { preventDefault: vi.fn() };
    handlers['will-navigate'](ev, 'https://example.com/elsewhere');
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});
