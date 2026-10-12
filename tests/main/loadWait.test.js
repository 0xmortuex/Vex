// "MaxListenersExceededWarning: 11 did-stop-loading listeners added to
// [WebContents]" on every boot (walkthrough L13, 2026-10-07): each
// executeJavaScript made while a page loads parked its own listener. Calls
// made during one load now share one.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { shareLoadWait } = require('../../src/main/load-wait.js');

function fakeGuest() {
  const wc = new EventEmitter();
  wc.loading = true;
  wc.ran = [];
  wc.isDestroyed = () => false;
  wc.getURL = () => 'file:///start.html';
  wc.isLoadingMainFrame = () => wc.loading;
  // What Electron does: wait for did-stop-loading per call while loading.
  wc.executeJavaScript = function (code) {
    if (wc.isLoadingMainFrame()) return new Promise(r => wc.once('did-stop-loading', () => { wc.ran.push(code); r(code); }));
    wc.ran.push(code);
    return Promise.resolve(code);
  };
  return wc;
}

describe('one load wait per page load', () => {
  it('twelve calls while loading park one listener, and all run in order once it stops', async () => {
    const wc = fakeGuest();
    const warn = vi.fn();
    process.on('warning', warn);
    shareLoadWait(wc);
    const calls = Array.from({ length: 12 }, (_, i) => wc.executeJavaScript('c' + i));
    expect(wc.listenerCount('did-stop-loading')).toBe(1);
    wc.loading = false;
    wc.emit('did-stop-loading');
    expect(await Promise.all(calls)).toEqual(calls.map((_, i) => 'c' + i));
    expect(wc.ran).toEqual(calls.map((_, i) => 'c' + i));
    expect(wc.listenerCount('did-stop-loading')).toBe(0);
    await new Promise(r => setTimeout(r, 0));
    process.off('warning', warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a page that is not loading runs at once; the next load gets a fresh wait', async () => {
    const wc = fakeGuest();
    shareLoadWait(wc);
    wc.loading = false;
    expect(await wc.executeJavaScript('now')).toBe('now');
    wc.loading = true;
    const later = wc.executeJavaScript('later');
    expect(wc.listenerCount('did-stop-loading')).toBe(1);
    wc.loading = false; wc.emit('did-stop-loading');
    expect(await later).toBe('later');
  });

  it('is installed once per WebContents', () => {
    const wc = fakeGuest();
    expect(shareLoadWait(wc)).toBe(true);
    expect(shareLoadWait(wc)).toBe(false);
  });

  it('main.js installs it for every guest page', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/main.js'), 'utf8');
    expect(src).toMatch(/app\.on\('web-contents-created', \(_e, wc\) => \{ if \(wc\.getType\(\) === 'webview'\) require\('\.\/main\/load-wait'\)\.shareLoadWait\(wc\); \}\);/);
  });
});
