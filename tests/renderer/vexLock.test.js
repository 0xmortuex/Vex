// @vitest-environment jsdom
//
// Lock Vex: a PIN kept only as a salted hash; locked, the pages are hidden
// and a PIN screen covers the window; a wrong PIN is refused, five in a row
// wait thirty seconds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { VexLock: L } = require('../../src/renderer/js/vex-lock.js');

// Checking a PIN is deliberately slow (PBKDF2), and how slow depends on the
// machine — so wait for the answer to land rather than for a fixed moment.
const settled = async (done, ms = 5000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (done()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return done();
};

// `blocked` is a try made during the thirty-second wait: it is turned away
// without the PIN being checked at all, so there is nothing to wait for.
const submit = async (pin, { blocked = false } = {}) => {
  const form = document.querySelector('.vex-lock-screen form');
  const fails = L._fails;
  const waited = L._waitUntil;
  form.querySelector('input').value = pin;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  if (blocked) { await Promise.resolve(); return; }
  // The attempt is over when it opened, or when it was counted against us.
  await settled(() => !document.querySelector('.vex-lock-screen') || L._fails !== fails || L._waitUntil !== waited);
};

// Main's side of an unlock (src/main/lock-pin.js), checking the same stored
// hash the window wrote.
const { createLockGate } = require('../../src/main/lock-pin.js');
const mainUnlock = () => {
  const gate = createLockGate({ readRecord: () => localStorage.getItem(L.PIN_KEY) });
  return vi.fn((pin) => gate.tryUnlock(pin));
};

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; L._open(); L._waitUntil = 0; window.showToast = vi.fn(); window.vex = { setLockState: vi.fn(), unlockLock: mainUnlock() }; });

describe('VexLock', () => {
  it('will not lock without a PIN, and says where to set one', () => {
    expect(L.lock()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Set a PIN first/), 'error');
  });

  it('keeps only a salted hash, never the PIN', async () => {
    await L.setPin('4821');
    const raw = localStorage.getItem(L.PIN_KEY);
    expect(raw).not.toContain('4821');
    expect(await L.check('4821')).toBe(true);
    expect(await L.check('1111')).toBe(false);
    await expect(L.setPin('12a')).rejects.toThrow('4 to 12 digits');
  });

  it('locks over everything, refuses a wrong PIN, and opens for the right one', async () => {
    await L.setPin('4821');
    expect(L.lock()).toBe(true);
    expect(document.body.classList.contains('vex-locked')).toBe(true);
    await submit('0000');
    expect(L.locked()).toBe(true);
    expect(document.querySelector('.vex-lock-msg').textContent).toBe('Wrong PIN');
    await submit('4821');
    expect(L.locked()).toBe(false);
    expect(document.querySelector('.vex-lock-screen')).toBeNull();
  });

  it('five wrong in a row: a thirty-second wait, even for the right PIN', async () => {
    await L.setPin('4821');
    L.lock();
    for (let i = 0; i < 5; i++) await submit('0000');
    expect(document.querySelector('.vex-lock-msg').textContent).toMatch(/wait 30 s/);
    await submit('4821', { blocked: true });
    expect(L.locked()).toBe(true);
  });

  // Audit B1: VexLock.unlock() typed into DevTools' console opened Vex.
  it('VexLock.unlock() without the PIN leaves Vex locked; main is asked and says no', async () => {
    await L.setPin('4821');
    L.lock();
    await expect(L.unlock()).rejects.toThrow('Wrong PIN');
    await expect(L.unlock('0000')).rejects.toThrow('Wrong PIN');
    expect(L.locked()).toBe(true);
    expect(document.querySelector('.vex-lock-screen')).not.toBeNull();
    expect(window.vex.setLockState).not.toHaveBeenCalledWith(false);
    await L.unlock('4821');
    expect(L.locked()).toBe(false);
  });

  it('a PIN the window accepts but main refuses keeps the lock screen, and says why', async () => {
    await L.setPin('4821');
    L.lock();
    window.vex.unlockLock = vi.fn(async () => ({ ok: false, error: 'No PIN is saved, so Vex cannot check it. Restart Vex to open it.' }));
    const form = document.querySelector('.vex-lock-screen form');
    form.querySelector('input').value = '4821';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settled(() => window.vex.unlockLock.mock.calls.length > 0 && /No PIN is saved/.test(document.querySelector('.vex-lock-msg').textContent));
    expect(window.vex.unlockLock).toHaveBeenCalledWith('4821');
    expect(L.locked()).toBe(true);
    expect(document.querySelector('.vex-lock-msg').textContent).toMatch(/No PIN is saved/);
  });
});
