import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function handler(decisions) {
  const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf("ipcMain.handle('geolocation:check-permission'");
  const end = source.indexOf("ipcMain.handle('persist-set'", start);
  let fn;
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (_name, callback) => { fn = callback; } },
    URL, decisionsFor: () => decisions,
    pendingPermissions: new Map(), sendPermissionRequest: vi.fn(), setTimeout: vi.fn(),
  });
  return fn;
}

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
