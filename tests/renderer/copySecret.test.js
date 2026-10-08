// @vitest-environment jsdom
//
// A password or a one-time code left in the clipboard goes into the next thing
// you paste into — a chat box, an address bar, a page listening for paste.
// One implementation for every secret Vex copies: the renderer hands it to the
// main process (main/secret-clipboard.js), which writes it with Electron's
// clipboard and empties it after 30 s if it is still there — even when Vex no
// longer has the focus, where the old in-page read-back was refused.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { createSecretClipboard } = require('../../src/main/secret-clipboard.js');
require('../../src/renderer/js/vex-utils.js');

let clip, service;
beforeEach(() => {
  vi.useFakeTimers();
  clip = { text: '', reads: 0 };
  const clipboard = {
    writeText: vi.fn((t) => { clip.text = t; }),
    readText: vi.fn(() => { clip.reads++; return clip.text; }),
    clear: vi.fn(() => { clip.text = ''; }),
  };
  service = createSecretClipboard({ clipboard });
  // What preload.js exposes: an IPC round trip to the main process.
  window.vex = { copySecret: vi.fn(async (text, seconds) => service.write(text, seconds)) };
  // The renderer's own clipboard is never used for a secret any more.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(), readText: vi.fn() } });
  window.showToast = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('copying a secret', () => {
  it('copies it through the main process, says when it will go, and empties the clipboard', async () => {
    await window.vexCopySecret('hunter2', 'Password copied');
    expect(window.vex.copySecret).toHaveBeenCalledWith('hunter2', 30);
    expect(clip.text).toBe('hunter2');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Password copied — clears in 30s if unchanged');
    await vi.advanceTimersByTimeAsync(29000);
    expect(clip.text).toBe('hunter2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(clip.text).toBe('');
  });

  it('leaves alone whatever the user copied since — overwriting that would be worse', async () => {
    await window.vexCopySecret('123456', 'Code copied');
    clip.text = 'something the user copied afterwards';
    await vi.advanceTimersByTimeAsync(30000);
    expect(clip.text).toBe('something the user copied afterwards');
  });

  it('a second secret copied before the first expires is cleared on its own clock', async () => {
    await window.vexCopySecret('first-secret', 'Copied');
    await vi.advanceTimersByTimeAsync(20000);
    await window.vexCopySecret('second-secret', 'Copied');
    await vi.advanceTimersByTimeAsync(10000); // the first timer: clipboard holds the second
    expect(clip.text).toBe('second-secret');
    await vi.advanceTimersByTimeAsync(20000);
    expect(clip.text).toBe('');
  });

  it('refuses to "copy" nothing', async () => {
    await expect(window.vexCopySecret('', 'x')).rejects.toThrow(/nothing to copy/);
    expect(() => service.write('')).toThrow(/nothing to copy/);
  });

  it('says so instead of copying nowhere when the bridge is missing', async () => {
    window.vex = {};
    await expect(window.vexCopySecret('x', 'Copied')).rejects.toThrow(/not available/);
  });

  it('both the vault and the authenticator go through it', () => {
    const fs = require('fs'), path = require('path');
    const pw = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/passwords.js'), 'utf8');
    const auth = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/authenticator.js'), 'utf8');
    expect(pw).toContain('window.vexCopySecret(password');
    expect(auth).toContain('window.vexCopySecret(code');
  });
});

describe('the main-process clipboard service', () => {
  it('keeps only a keyed hash of the secret while it waits', () => {
    service.write('do-not-keep-me');
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/main/secret-clipboard.js'), 'utf8');
    expect(src).toMatch(/const entry = \{ hash: digest\(secret\), timer: null \};/);
    expect(service.pendingCount()).toBe(1);
  });

  it('clears what is still waiting when Vex quits, and only if unchanged', () => {
    service.write('quit-secret');
    expect(service.flush()).toBe(1);
    expect(clip.text).toBe('');
    service.write('quit-secret-2');
    clip.text = 'mine';
    expect(service.flush()).toBe(0);
    expect(clip.text).toBe('mine');
    expect(service.pendingCount()).toBe(0);
  });

  it('accepts only a sensible wait', () => {
    expect(service.write('a', 2).seconds).toBe(30);
    expect(service.write('a', 60).seconds).toBe(60);
  });
});
