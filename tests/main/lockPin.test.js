// Audit B1 (2026-10-10): a locked Vex opened for VexLock.unlock() typed into
// DevTools' console, and F12 opened DevTools on the lock screen. Main now
// checks the PIN itself (src/main/lock-pin.js), never takes the window's word
// that it unlocked, and keeps DevTools shut while locked.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const { createLockGate, parseRecord, MAX_FAILS } = require('../../src/main/lock-pin.js');

// The record exactly as js/vex-lock.js writes it (Web Crypto in the window).
async function windowRecord(pin) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return JSON.stringify({ salt: Buffer.from(salt).toString('base64'), hash: Buffer.from(new Uint8Array(bits)).toString('base64') });
}

describe('main checks the PIN the window stored', () => {
  it('opens for the right PIN and not for a wrong one', async () => {
    const rec = await windowRecord('4821');
    const gate = createLockGate({ readRecord: () => rec });
    expect(await gate.tryUnlock('1111')).toEqual({ ok: false, error: 'Wrong PIN' });
    expect(await gate.tryUnlock('4821')).toEqual({ ok: true });
  });

  it('refuses no PIN at all (VexLock.unlock() from the console) and anything not a PIN', async () => {
    const gate = createLockGate({ readRecord: () => { throw new Error('must not be read'); } });
    for (const pin of [undefined, null, '', 'abcd', '123', '1'.repeat(13), 4821]) {
      expect((await gate.tryUnlock(pin)).ok).toBe(false);
    }
  });

  it('five wrong in a row: thirty seconds before main checks again, even the right PIN', async () => {
    const rec = await windowRecord('4821');
    let t = 1000000;
    const gate = createLockGate({ readRecord: () => rec, now: () => t });
    for (let i = 0; i < MAX_FAILS - 1; i++) expect((await gate.tryUnlock('0000')).error).toBe('Wrong PIN');
    expect((await gate.tryUnlock('0000')).error).toBe('Too many tries — wait 30 s');
    expect((await gate.tryUnlock('4821')).error).toMatch(/Too many tries — wait \d+ s/);
    t += 30001;
    expect(await gate.tryUnlock('4821')).toEqual({ ok: true });
  });

  it('says plainly when there is no PIN to check against', async () => {
    const gate = createLockGate({ readRecord: () => undefined });
    expect((await gate.tryUnlock('4821')).error).toMatch(/No PIN is saved/);
    expect(parseRecord(null)).toBe(null);
    expect(() => parseRecord('{nope')).toThrow('The stored PIN cannot be read');
  }, 20000);
});

describe('main.js', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const block = (start, len = 900) => MAIN.slice(MAIN.indexOf(start), MAIN.indexOf(start) + len);

  it('the window can say it locked, never that it unlocked', () => {
    const state = block("ipcMain.on('vex-lock:state'", 280);
    expect(state).toContain("if (locked !== true) { console.error('[Lock] refused");
    expect(state).not.toMatch(/_vexLocked\s*=\s*false/);
    const unlock = block("ipcMain.handle('vex-lock:unlock'");
    expect(unlock).toContain('await _lockGate.tryUnlock(pin)');
    expect(unlock.indexOf('if (!r.ok) return r;')).toBeLessThan(unlock.indexOf('_vexLocked = false'));
  });

  it('locking closes every DevTools, and DevTools opened while locked closes again', () => {
    expect(block('function _lockVex()')).toContain('if (!wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools();');
    expect(MAIN).toContain("contents.on('devtools-opened', () => {\n    if (_vexLocked && !contents.isDestroyed()) contents.closeDevTools();".replace(/\n/g, MAIN.includes('\r\n') ? '\r\n' : '\n'));
  });

  it('the DevTools keys and buttons do nothing while locked', () => {
    expect(block('function handleWindowKeys(')).toMatch(/event\.preventDefault\(\);\s+\/\/ No DevTools while Vex is locked[^\n]*\s+if \(_vexLocked\) return true;/);
    expect(block('function handleDevToolsShortcut(')).toContain('if (_vexLocked) return true;');
    for (const ch of ['devtools:toggle-host', 'devtools:toggle-webview', 'devtools:open-for-webcontents']) {
      expect(block("ipcMain.handle('" + ch + "'", 200)).toContain("if (_vexLocked) return { ok: false, error: 'Vex is locked' };");
    }
  });

  it('the stored PIN cannot be swapped while locked', () => {
    expect(block("ipcMain.handle('persist-set'", 200)).toContain('_refuseLockPinChange(key);');
    expect(block("ipcMain.handle('persist-delete'", 200)).toContain('_refuseLockPinChange(key);');
  });
});
