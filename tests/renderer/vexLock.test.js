// @vitest-environment jsdom
//
// Lock Vex: a PIN kept only as a salted hash; locked, the pages are hidden
// and a PIN screen covers the window; a wrong PIN is refused, five in a row
// wait thirty seconds.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
const { VexLock: L } = require('../../src/renderer/js/vex-lock.js');

const submit = async (pin) => {
  const form = document.querySelector('.vex-lock-screen form');
  form.querySelector('input').value = pin;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
};

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; L.unlock(); L._waitUntil = 0; window.showToast = vi.fn(); });

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
    await submit('4821');
    expect(L.locked()).toBe(true);
  });
});
