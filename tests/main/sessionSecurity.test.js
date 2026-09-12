// @vitest-environment node
//
// Session security decides two things that everything else leans on: which
// window owns a given page, and what a <webview> is allowed to be. Every
// privileged channel is gated on the first (see ipc-policy), and the second is
// what stops a compromised renderer asking for a webview with Node in it.
//
// It had no tests of its own.

import { describe, it, expect, vi } from 'vitest';

const path = require('path');
const { pathToFileURL } = require('url');
const { createSessionSecurity } = require('../../src/main/session-security.js');

const ROOT = path.resolve('src');
const UI_URL = pathToFileURL(path.join(ROOT, 'renderer/index.html')).toString();

function build() {
  const madeSessions = [];
  const session = {
    fromPartition: (p) => { const s = { partition: p, clearStorageData: vi.fn(() => Promise.resolve()), clearCache: vi.fn(() => Promise.resolve()), closeAllConnections: vi.fn(() => Promise.resolve()) }; madeSessions.push(s); return s; },
  };
  const byId = new Map();
  const webContents = {
    fromId: (id) => byId.get(id) || null,
    getAllWebContents: () => [...byId.values()],
  };
  const security = createSessionSecurity({ session, webContents, root: ROOT });
  return { security, byId, madeSessions };
}

// A window whose webContents can register event handlers we can fire.
function fakeWindow(id) {
  const handlers = {};
  const wc = {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
    on: (event, fn) => { handlers['wc:' + event] = fn; },
    session: {},
  };
  const win = {
    webContents: wc,
    isDestroyed: () => false,
    on: (event, fn) => { handlers[event] = fn; },
    once: (event, fn) => { handlers['once:' + event] = fn; },
  };
  return { win, wc, handlers };
}

describe('which partitions are allowed to exist', () => {
  it('refuses a partition that is not a string, or absurdly long, or has control characters', () => {
    const { security } = build();
    expect(() => security.fromPartition(null)).toThrow(/Invalid session partition/);
    expect(() => security.fromPartition(123)).toThrow(/Invalid session partition/);
    expect(() => security.fromPartition('x'.repeat(161))).toThrow(/Invalid session partition/);
    expect(() => security.fromPartition('bad\u0000partition')).toThrow(/Invalid session partition/);
    expect(() => security.fromPartition('bad\nnewline')).toThrow(/Invalid session partition/);
  });

  it('accepts the ordinary ones and remembers which is which', () => {
    const { security } = build();
    const main = security.fromPartition('persist:main');
    const tor = security.fromPartition('tor-1');
    expect(security.partitionOf({ session: main })).toBe('persist:main');
    expect(security.partitionOf({ session: tor })).toBe('tor-1');
  });

  it('reports an unknown session as no partition rather than guessing', () => {
    const { security } = build();
    expect(security.partitionOf({ session: {} })).toBe('');
  });

  it('gives every private window its own unguessable partition', () => {
    const { security } = build();
    const a = security.newPrivatePartition();
    const b = security.newPrivatePartition();
    expect(a).toMatch(/^private:[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});

describe('what a <webview> is allowed to be', () => {
  // A renderer asks for a guest by setting attributes. If it could ask for
  // Node integration or its own preload, an XSS in the chrome would become
  // full code execution.
  const attach = (extra) => {
    const { security } = build();
    const { win, handlers } = fakeWindow(1);
    security.registerHost(win);
    const prefs = Object.assign({
      preload: 'C:/evil/preload.js',
      preloadURL: 'file:///evil/preload.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
    }, extra);
    const event = { preventDefault: vi.fn() };
    handlers['wc:will-attach-webview'](event, prefs, { partition: 'persist:main' });
    return { prefs, event };
  };

  it('strips a renderer-supplied preload', () => {
    const { prefs } = attach();
    expect(prefs.preload).toBeUndefined();
    expect(prefs.preloadURL).toBeUndefined();
  });

  it('forces the sandbox on and Node off, whatever was asked for', () => {
    const { prefs } = attach();
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInSubFrames).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.webSecurity).toBe(true);
  });

  it('refuses the attach outright when the partition is not allowed', () => {
    const { security } = build();
    const { win, handlers } = fakeWindow(1);
    security.registerHost(win);
    const event = { preventDefault: vi.fn() };
    handlers['wc:will-attach-webview'](event, {}, { partition: 'bad\u0000' });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('a private window pins every guest to its own partition', () => {
    const { security } = build();
    const { win, handlers } = fakeWindow(1);
    security.registerHost(win, 'private:abc');
    const prefs = {};
    handlers['wc:will-attach-webview']({ preventDefault: vi.fn() }, prefs, { partition: 'persist:main' });
    expect(prefs.partition).toBe('private:abc');
  });
});

describe('the host window cannot be navigated away', () => {
  it('blocks navigation and redirects of the chrome itself', () => {
    const { security } = build();
    const { win, handlers } = fakeWindow(1);
    security.registerHost(win);
    for (const which of ['wc:will-navigate', 'wc:will-redirect']) {
      const event = { preventDefault: vi.fn() };
      handlers[which](event);
      expect(event.preventDefault, which).toHaveBeenCalled();
    }
  });
});

describe('who owns a page', () => {
  it('recognises the host window itself', () => {
    const { security, byId } = build();
    const { win, wc } = fakeWindow(7);
    byId.set(7, wc);
    const host = security.registerHost(win);
    expect(security.owner(wc)).toBe(host);
  });

  it('treats a destroyed or missing sender as owned by nobody', () => {
    const { security } = build();
    expect(security.owner(null)).toBeNull();
    expect(security.owner({ isDestroyed: () => true })).toBeNull();
  });

  it('will not let one window act on another window\'s page', () => {
    const { security, byId } = build();
    const a = fakeWindow(1); const b = fakeWindow(2);
    byId.set(1, a.wc); byId.set(2, b.wc);
    security.registerHost(a.win);
    security.registerHost(b.win);
    expect(security.ownsTarget({ sender: a.wc }, 1)).toBe(true);
    expect(security.ownsTarget({ sender: a.wc }, 2)).toBe(false);
  });

  it('rejects a target id that is not a positive integer', () => {
    const { security, byId } = build();
    const a = fakeWindow(1);
    byId.set(1, a.wc);
    security.registerHost(a.win);
    for (const bad of [0, -1, 1.5, '1', null, undefined, NaN, Infinity]) {
      expect(security.ownsTarget({ sender: a.wc }, bad), String(bad)).toBe(false);
    }
  });
});

describe('which frame counts as the interface', () => {
  const uiFrame = (url, isMain = true) => {
    const { security, byId } = build();
    const { win, wc } = fakeWindow(1);
    byId.set(1, wc);
    security.registerHost(win);
    const frame = { url };
    wc.mainFrame = isMain ? frame : {};
    return security.isUiFrame({ sender: wc, senderFrame: frame });
  };

  it('accepts only Vex\'s own index.html, in the main frame', () => {
    expect(uiFrame(UI_URL)).toBe(true);
  });

  it('rejects a subframe, even one showing the same file', () => {
    expect(uiFrame(UI_URL, false)).toBe(false);
  });

  it('rejects any other file, and anything on the web', () => {
    expect(uiFrame(pathToFileURL(path.join(ROOT, 'renderer/start.html')).toString())).toBe(false);
    expect(uiFrame('https://example.com/index.html')).toBe(false);
    expect(uiFrame('not a url at all')).toBe(false);
  });
});

describe('the two preloads allowed to speak without being the interface', () => {
  const aux = (channel, preload, url) => {
    const { security } = build();
    const frame = { url: url || pathToFileURL(path.join(ROOT, 'renderer/popup-chrome.html')).toString() };
    const sender = { mainFrame: frame, getLastWebPreferences: () => ({ preload }) };
    return security.isAuxiliary({ sender, senderFrame: frame }, channel);
  };

  it('lets the Picture-in-Picture preload use its own channels', () => {
    expect(aux('pip:close', path.join(ROOT, 'preload-pip.js'))).toBe(true);
  });

  it('does not let some other preload borrow them', () => {
    expect(aux('pip:close', 'C:/evil/preload.js')).toBe(false);
  });

  it('lets the popup chrome act only on its own channel, from its own page', () => {
    expect(aux('popup-chrome:action', null)).toBe(true);
    expect(aux('vault:get', null)).toBe(false);
    expect(aux('popup-chrome:action', null, 'https://example.com/')).toBe(false);
  });

  it('refuses anything that is not the main frame', () => {
    const { security } = build();
    const sender = { mainFrame: { url: 'x' }, getLastWebPreferences: () => ({}) };
    expect(security.isAuxiliary({ sender, senderFrame: { url: 'y' } }, 'pip:close')).toBe(false);
  });
});
