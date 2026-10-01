// @vitest-environment node
//
// Main-process halves of the 2026-09-29 privacy sweep:
//  - the vault refuses to be read while Vex is locked (a private window opened
//    from the lock screen could list and read every password);
//  - a temporary session's route is not restored at startup (a burner
//    identity's Tor route started Tor on every launch for a session that no
//    longer exists).

import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { createVaultService } = require('../../src/main/vault.js');
const { restoreRoutes } = require('../../src/main/routing.js');

describe('the vault while Vex is locked', () => {
  it('refuses list, get, health and autofill, and opens again when unlocked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-'));
    const handlers = {};
    let locked = false;
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b) => b.toString('utf8').slice(4),
    };
    const svc = createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} }, isLocked: () => locked });
    const call = (c, ...a) => handlers[c]({ sender: {} }, ...a);
    await call('vault:save', { host: 'bank.example', username: 'me', password: 'hunter2' });

    locked = true;
    expect(() => call('vault:list')).toThrow(/Vex is locked/);
    expect(() => call('vault:get', 'bank.example')).toThrow(/Vex is locked/);
    expect(call('vault:health').error).toMatch(/Vex is locked/);
    expect((await call('vault:save', { host: 'x.example', username: 'a', password: 'b' })).ok).toBe(false);
    const wc = { isDestroyed: () => false, getURL: () => 'https://bank.example/login', executeJavaScript: vi.fn(async () => {}) };
    svc._autofillPopup(wc);
    expect(wc.executeJavaScript).not.toHaveBeenCalled();

    locked = false;
    expect(call('vault:get', 'bank.example')[0].password).toBe('hunter2');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('routes restored at startup', () => {
  it('skips a temporary session and keeps the default and persistent ones', async () => {
    const started = [];
    await restoreRoutes({
      routes: {
        'otr-burner-abc': { mode: 'tor' },
        'tor-xyz': { mode: 'tor' },
        'persist:container-tor-1': { mode: 'tor' },
        default: { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' },
      },
      getSession: () => ({ setProxy: async () => {} }),
      applyRouting: async (p) => { started.push(p); },
      report: () => {},
    });
    expect(started.sort()).toEqual(['', 'persist:container-tor-1']);
  });
});
