import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
// The handler reads decisions through the same savedDecision every other
// permission uses ("Allow this visit" in the session map, day answers that end).
const { savedDecision } = createRequire(import.meta.url)('../../src/main/permissions.js');

const SOURCE = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
// The helper that keeps Tor pages from the location, run as written.
const REFUSED = SOURCE.slice(SOURCE.indexOf('function _locationRefused'), SOURCE.indexOf("ipcMain.handle('geolocation:get'"));

function handlers(decisions, partitionOf = () => 'persist:main') {
  const start = SOURCE.indexOf("ipcMain.handle('geolocation:get'");
  const end = SOURCE.indexOf("ipcMain.handle('persist-set'", start);
  const fns = {};
  vm.runInNewContext(REFUSED + SOURCE.slice(start, end), {
    ipcMain: { handle: (name, callback) => { fns[name] = callback; } },
    URL, decisionsFor: () => decisions, savedDecision, sessionDecisionsFor: () => new Map(),
    pendingPermissions: new Map(), sendPermissionRequest: vi.fn(), setTimeout: vi.fn(),
    secureSessions: { partitionOf }, console,
    _readPersistString: (key, fallback) => (key === 'vex.locationMode' ? 'manual' : key === 'vex.manualLocation' ? { latitude: 41, longitude: 29 } : fallback),
  });
  return fns;
}
const handler = (decisions, partitionOf) => handlers(decisions, partitionOf)['geolocation:check-permission'];

describe('geolocation IPC origin binding', () => {
  it('ignores a forged allowed origin and uses the sending frame', async () => {
    const fn = handler({ 'https://evil.test::geolocation': 'deny', 'https://trusted.test::geolocation': 'allow' });
    expect(await fn({ senderFrame: { url: 'https://evil.test/page' } }, { origin: 'https://trusted.test' })).toBe('deny');
  });
  it('does not grant permissions for missing or opaque frames', async () => {
    const fn = handler({});
    expect(await fn({}, { origin: null })).toBe('deny');
    expect(await fn({ senderFrame: { url: 'data:text/html,hi' } })).toBe('deny');
  });
  it('honors an existing decision for the actual origin', async () => {
    const fn = handler({ 'https://trusted.test::geolocation': 'allow' });
    expect(await fn({ senderFrame: { url: 'https://trusted.test/page' } }, { origin: 'https://evil.test' })).toBe('allow');
  });
});

describe('a Tor page never gets the location (found 2026-09-30)', () => {
  const allowed = { 'https://site.test::geolocation': 'allow' };
  const frame = { senderFrame: { url: 'https://site.test/' } };

  it('is refused in a session marked as Tor, even with a saved Allow', async () => {
    const fns = handlers(allowed);
    const tor = { ...frame, sender: { session: { __vexTor: true } } };
    expect(await fns['geolocation:check-permission'](tor)).toBe('deny');
    expect(fns['geolocation:get'](tor)).toEqual({ mode: 'off' });
  });

  it('is refused in a Tor tab and a Tor site rule by their partition', async () => {
    for (const partition of ['tor-abc', 'persist:route-tor']) {
      const fns = handlers(allowed, () => partition);
      expect(await fns['geolocation:check-permission']({ ...frame, sender: { session: {} } })).toBe('deny');
    }
  });

  it('an ordinary tab is unchanged', async () => {
    const fns = handlers(allowed);
    expect(await fns['geolocation:check-permission']({ ...frame, sender: { session: {} } })).toBe('allow');
  });
});
