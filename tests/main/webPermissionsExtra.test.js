// The rules for keyboardLock, window-management and idle-detection
// (src/main/web-permissions-extra.js). Pure functions: no Electron, no clock, no network.
import { describe, it, expect } from 'vitest';
const extra = require('../../src/main/web-permissions-extra.js');

describe('what each request is, and under which key it is kept', () => {
  const top = 'https://app.example.com/page';
  const base = (permission, over = {}) => ({
    permission, topUrl: top, tracker: false, fullscreen: true,
    details: { isMainFrame: true, requestingUrl: top }, ...over,
  });

  it('the three that belong to the page are kept under the page origin and their own name', () => {
    for (const p of ['keyboardLock']) {
      expect(extra.planExtra(base(p)), p).toEqual({ origin: 'https://app.example.com', part: p });
    }
  });

  it('a frame inside the page can never ask for those three', () => {
    for (const p of ['keyboardLock']) {
      expect(extra.planExtra(base(p, { details: { isMainFrame: false, requestingUrl: 'https://ads.example/x' } })).deny, p).toBeTruthy();
      expect(extra.planExtra(base(p, { details: { isMainFrame: true, requestingUrl: 'https://other.example/' } })).deny, p + ' other origin').toBeTruthy();
      expect(extra.planExtra(base(p, { details: { isMainFrame: false, requestingUrl: top } })).deny, p + ' frame of the same origin').toBeTruthy();
    }
  });

  it('keyboardLock only while the page is in full screen', () => {
    expect(extra.planExtra(base('keyboardLock', { fullscreen: true })).deny).toBeUndefined();
    expect(extra.planExtra(base('keyboardLock', { fullscreen: false })).deny).toBeTruthy();
    expect(extra.planExtra(base('keyboardLock', { fullscreen: undefined })).deny).toBeTruthy();
  });

  it('refuses anything that is not a web page or not one of the four', () => {
    expect(extra.planExtra(base('keyboardLock', { topUrl: 'file:///C:/a.html', details: { isMainFrame: true, requestingUrl: 'file:///C:/a.html' } })).deny).toBeTruthy();
    for (const p of ['top-level-storage-access', 'openExternal', 'fileSystem', 'speaker-selection', 'unknown', 'camera', undefined]) {
      expect(extra.planExtra(base(p)).deny, String(p)).toBeTruthy();
    }
    expect(extra.planExtra(undefined).deny).toBeTruthy();
  });
});

describe('what to do with a plan', () => {
  it.each([
    ['allow', false, 'allow'], ['deny', false, 'deny'], [null, false, 'ask'], [undefined, false, 'ask'],
    // a private, Tor or burner window asks every time and ignores whatever sits in its in-memory store
    ['allow', true, 'ask'], ['deny', true, 'ask'], [null, true, 'ask'],
  ])('saved %s, private %s -> %s', (saved, priv, verdict) => {
    expect(extra.resolveExtra(saved, priv)).toBe(verdict);
  });
});

