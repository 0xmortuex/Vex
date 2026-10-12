// @vitest-environment jsdom
// Asking again before a secret is shown: the Vex PIN (checked by main) when one
// is set, otherwise a confirmation. Used before the sync recovery code is shown
// and before a saved password is revealed or copied.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexLock } = require('../../src/renderer/js/vex-lock.js');

describe('VexLock.recheck', () => {
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    window.vexConfirm = vi.fn(async () => true);
    window.vexPrompt = vi.fn(async () => '1234');
    window.vex = { verifyLockPin: vi.fn(async (pin) => (pin === '1234' ? { ok: true } : { ok: false, error: 'Wrong PIN' })) };
  });

  it('without a PIN asks for a confirmation', async () => {
    expect(await VexLock.recheck({ title: 'T', message: 'M' })).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledWith({ title: 'T', message: 'M', okLabel: 'Continue' });
    window.vexConfirm = vi.fn(async () => false);
    expect(await VexLock.recheck({ title: 'T', message: 'M' })).toBe(false);
    expect(window.vexPrompt).not.toHaveBeenCalled();
  });

  it('with a PIN asks for it in a hidden box and lets main check it', async () => {
    localStorage.setItem('vex.lockPin', JSON.stringify({ salt: 'AA==', hash: 'AA==' }));
    expect(await VexLock.recheck({ title: 'T', message: 'M.' })).toBe(true);
    expect(window.vexPrompt.mock.calls[0][0]).toMatchObject({ password: true, label: 'Vex PIN' });
    expect(window.vex.verifyLockPin).toHaveBeenCalledWith('1234');
    expect(window.vexConfirm).not.toHaveBeenCalled();

    window.vexPrompt = vi.fn(async () => '9999');
    expect(await VexLock.recheck({ title: 'T', message: 'M.' })).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Wrong PIN', 'error');

    window.vexPrompt = vi.fn(async () => null);
    window.vex.verifyLockPin.mockClear();
    expect(await VexLock.recheck({ title: 'T', message: 'M.' })).toBe(false);
    expect(window.vex.verifyLockPin).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
  it('the recovery code is shown only after the re-check', () => {
    const src = read('src/renderer/js/sync-settings.js');
    const at = src.indexOf("getElementById('btn-show-recovery')");
    const block = src.slice(at, at + 700);
    expect(block.indexOf('VexLock.recheck(')).toBeGreaterThan(-1);
    expect(block.indexOf('VexLock.recheck(')).toBeLessThan(block.indexOf('getRecoveryCode()'));
  });
  it('main checks the PIN with the lock gate and changes nothing else', () => {
    const main = read('src/main.js');
    const at = main.indexOf("ipcMain.handle('vex-lock:verify'");
    const block = main.slice(at, at + 400);
    expect(block).toContain('e.sender !== mainWindow.webContents');
    expect(block).toContain('return _lockGate.tryUnlock(pin);');
    expect(block).not.toContain('_vexLocked');
  });
});
