// A compromised or buggy renderer controls the <webview> attributes it asks for.
// The host must not honour a requested preload, node integration, a disabled
// sandbox or a foreign partition, or a guest page could reach Node or read
// another container's cookies. That hardening lives in the will-attach-webview
// handler and had no direct coverage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionSecurity } from '../../src/main/session-security.js';

function harness(privatePartition = null) {
  const handlers = new Map();
  const created = [];
  const win = {
    on: vi.fn(),
    once: vi.fn(),
    webContents: {
      id: 1,
      on: (event, fn) => handlers.set(event, fn),
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
    },
  };
  const security = createSessionSecurity({
    session: { fromPartition: (partition) => { created.push(partition); return { partition }; } },
    webContents: { getAllWebContents: () => [], fromId: () => null },
    root: process.cwd() + '/src',
  });
  security.registerHost(win, privatePartition);
  return { handlers, created, security };
}

function attach(handlers, prefs, params) {
  const event = { preventDefault: vi.fn() };
  handlers.get('will-attach-webview')(event, prefs, params);
  return event;
}

describe('will-attach-webview hardening', () => {
  let handlers, created;
  beforeEach(() => { ({ handlers, created } = harness()); });

  it('strips a renderer-requested preload', () => {
    const prefs = { preload: 'C:/evil.js', preloadURL: 'file:///evil.js' };
    attach(handlers, prefs, { partition: 'persist:main' });
    expect(prefs.preload).toBeUndefined();
    expect(prefs.preloadURL).toBeUndefined();
  });

  it('forces the isolation flags regardless of what was asked for', () => {
    const prefs = {
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
    };
    attach(handlers, prefs, { partition: 'persist:main' });
    expect(prefs).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('defaults a missing partition to persist:main', () => {
    const prefs = {};
    attach(handlers, prefs, {});
    expect(prefs.partition).toBe('persist:main');
  });

  it('rejects a partition containing control characters', () => {
    const prefs = { partition: 'persist:main' };
    const event = attach(handlers, prefs, { partition: 'persist:bad\u0000name' });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('rejects an absurdly long partition name', () => {
    const event = attach(handlers, {}, { partition: 'persist:' + 'x'.repeat(200) });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('pins a private window\'s guests to the private partition even if the renderer asks for another', () => {
    const priv = harness('private:abc123');
    const prefs = {};
    priv.handlers.get('will-attach-webview')({ preventDefault: vi.fn() }, prefs, { partition: 'persist:main' });
    expect(prefs.partition).toBe('private:abc123');
    expect(prefs.session).toEqual({ partition: 'private:abc123' });
  });

  it('gives the guest the session object for the resolved partition, not the requested one', () => {
    const prefs = {};
    attach(handlers, prefs, { partition: 'persist:container-work' });
    expect(prefs.partition).toBe('persist:container-work');
    expect(prefs.session).toEqual({ partition: 'persist:container-work' });
    expect(created).toContain('persist:container-work');
  });

  it('blocks host navigation and redirects outright', () => {
    for (const event of ['will-navigate', 'will-redirect']) {
      const e = { preventDefault: vi.fn() };
      handlers.get(event)(e, 'https://evil.test/');
      expect(e.preventDefault, event + ' must be blocked').toHaveBeenCalled();
    }
  });
});
