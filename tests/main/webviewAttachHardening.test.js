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

// Suppressing WebAuthn is what stops Windows popping its "Windows Security"
// passkey / USB-key dialog over an ordinary password login. It applied
// everywhere until the September audit made it opt-in per exact hostname, which
// left the default list empty and brought the dialog back on every site.
//
// NOTE: this mirrors the rule rather than calling it. _passkeySuppressed lives
// inside main.js, which is not importable, so this pins the intended semantics
// but would NOT catch main.js drifting away from them. Real confirmation is the
// Windows dialog no longer appearing over a password login.
describe('passkey prompt suppression (mirrored rule)', () => {
  function suppressed(stored, hostname) {
    const hosts = stored === undefined ? ['*'] : stored;
    if (!Array.isArray(hosts)) return false;
    return hosts.includes('*') || hosts.includes(hostname);
  }
  it('suppresses everywhere when the user has never set the preference', () => {
    expect(suppressed(undefined, 'roblox.com')).toBe(true);
    expect(suppressed(undefined, 'accounts.google.com')).toBe(true);
  });
  it('honours an explicit wildcard', () => {
    expect(suppressed(['*'], 'anything.test')).toBe(true);
  });
  it('narrows to exact hostnames when the user lists them', () => {
    expect(suppressed(['roblox.com'], 'roblox.com')).toBe(true);
    expect(suppressed(['roblox.com'], 'github.com')).toBe(false);
  });
  it('re-enables passkey prompts everywhere when the list is cleared', () => {
    expect(suppressed([], 'roblox.com')).toBe(false);
  });
  it('ignores a corrupt stored value instead of throwing', () => {
    expect(suppressed('not-an-array', 'roblox.com')).toBe(false);
  });
});
