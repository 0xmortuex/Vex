// @vitest-environment jsdom
//
// A password or a one-time code left in the clipboard goes into the next thing
// you paste into — a chat box, an address bar, a page listening for paste.
// Passwords already cleared after 30 seconds; the authenticator's codes did
// not. One implementation now, used by both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');

let clip;
beforeEach(() => {
  vi.useFakeTimers();
  clip = { text: '' };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (t) => { clip.text = t; }), readText: vi.fn(async () => clip.text) },
  });
  window.showToast = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('copying a secret', () => {
  it('copies it, says when it will go, and empties the clipboard', async () => {
    await window.vexCopySecret('hunter2', 'Password copied');
    expect(clip.text).toBe('hunter2');
    expect(window.showToast).toHaveBeenCalledWith('Password copied — clears in 30s if unchanged');
    await vi.advanceTimersByTimeAsync(30000);
    expect(clip.text).toBe('');
  });

  it('leaves alone whatever the user copied since — overwriting that would be worse', async () => {
    await window.vexCopySecret('123456', 'Code copied');
    clip.text = 'something the user copied afterwards';
    await vi.advanceTimersByTimeAsync(30000);
    expect(clip.text).toBe('something the user copied afterwards');
  });

  it('a permission that lapsed while Vex was unfocused is not an error', async () => {
    await window.vexCopySecret('x', 'Copied');
    navigator.clipboard.readText = vi.fn(async () => { throw new Error('NotAllowedError'); });
    await expect(vi.advanceTimersByTimeAsync(30000)).resolves.not.toThrow();
  });

  it('refuses to "copy" nothing', async () => {
    await expect(window.vexCopySecret('', 'x')).rejects.toThrow(/nothing to copy/);
  });

  it('both the vault and the authenticator go through it', () => {
    const fs = require('fs'), path = require('path');
    const pw = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/passwords.js'), 'utf8');
    const auth = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/authenticator.js'), 'utf8');
    expect(pw).toContain('window.vexCopySecret(password');
    expect(auth).toContain('window.vexCopySecret(code');
  });
});
