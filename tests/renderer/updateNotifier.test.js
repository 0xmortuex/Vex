// @vitest-environment jsdom
//
// The full-screen update cover (js/update-notifier.js): what it says, the
// download with progress and Cancel, failures in plain words, the keyboard
// (focus trapped, Enter = Update now, Escape = Later), release notes never
// parsed as HTML, and never in a private window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');

const info = { ok: true, hasUpdate: true, latest: '2.35.0', current: '2.34.5', size: 250 * 1024 * 1024, releaseUrl: 'https://github.com/0xmortuex/Vex/releases/tag/v2.35.0' };
let handlers, toasts;
const cover = () => document.getElementById('update-cover');
const button = act => cover().querySelector(`[data-act="${act}"]`);
const flush = () => new Promise(r => setTimeout(r, 0));
const key = (k, opts = {}) => {
  const target = opts.target || document.activeElement || document.body;
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, shiftKey: !!opts.shift });
  target.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  UpdateNotifier.close();
  document.body.innerHTML = '<button id="behind">behind</button>';
  localStorage.clear();
  toasts = [];
  handlers = {};
  window.showToast = (message, type, duration) => toasts.push({ message, type, duration });
  globalThis.VexProblems = { note: vi.fn() };
  delete window.VexTabPolicy;
  window.vex = {
    checkForUpdates: vi.fn(async () => info),
    openExternal: vi.fn(),
    updates: {
      upcomingNotes: vi.fn(async () => ({ ok: true, source: 'changelog', entries: [{ version: 'v2.35.0', name: 'v2.35.0 — New', body: '### Fixes\n- **Bold** fix with `code`\n- <img src=x onerror=alert(1)> stays text\n\nA [link](https://example.com) paragraph.' }] })),
      download: vi.fn(async () => ({ ok: true })),
      cancel: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      onProgress: (cb) => { handlers.progress = cb; },
      onInstallFailed: (cb) => { handlers.installFailed = cb; },
    },
  };
});
afterEach(() => { vi.useRealTimers(); });

describe('the cover', () => {
  it('says which version is out and which one you have, with three choices', async () => {
    UpdateNotifier.showCover(info);
    await flush();
    expect(cover().getAttribute('role')).toBe('dialog');
    expect(cover().getAttribute('aria-modal')).toBe('true');
    expect(cover().querySelector('#update-cover-title').textContent).toBe('Vex 2.35.0 is available');
    expect(cover().querySelector('#update-cover-sub').textContent).toBe('You have 2.34.5 · download 250 MB');
    expect([...cover().querySelectorAll('.update-cover-actions button')].map(b => b.textContent)).toEqual(['Update now', 'Later', 'Skip this version']);
    expect(document.activeElement).toBe(button('update'));
    // An icon, drawn by VexIcons, not an emoji.
    expect(cover().querySelector('.update-cover-icon svg')).not.toBe(null);
  });

  it('renders the release notes as text: a Markdown subset, never HTML', async () => {
    UpdateNotifier.showCover(info);
    await flush();
    const body = cover().querySelector('.update-cover-notes-body');
    expect(body.querySelector('h4').textContent).toBe('Fixes');
    expect(body.querySelector('li strong').textContent).toBe('Bold');
    expect(body.querySelector('li code').textContent).toBe('code');
    expect(body.querySelector('img')).toBe(null);
    expect(body.textContent).toContain('<img src=x onerror=alert(1)> stays text');
    expect(body.querySelector('a')).toBe(null);
    expect(body.textContent).toContain('A link paragraph.');
    expect(window.vex.updates.upcomingNotes).toHaveBeenCalledWith('2.35.0');
  });

  it('notes that cannot be loaded say so and point at the release page', async () => {
    window.vex.updates.upcomingNotes = vi.fn(async () => ({ ok: false, error: 'offline' }));
    UpdateNotifier.showCover(info);
    await flush();
    expect(cover().querySelector('.update-cover-notes-body').textContent).toMatch(/could not be loaded \(offline\)/);
    button('page').click();
    expect(window.vex.openExternal).toHaveBeenCalledWith(info.releaseUrl);
  });
});

describe('Update now', () => {
  it('downloads with progress, then installs', async () => {
    let finish;
    window.vex.updates.download = vi.fn(() => new Promise(r => { finish = r; }));
    UpdateNotifier.init();
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    expect(window.vex.updates.download).toHaveBeenCalledWith('2.35.0');
    expect(cover().dataset.phase).toBe('downloading');
    expect([...cover().querySelectorAll('.update-cover-actions button')].map(b => b.textContent)).toEqual(['Cancel']);
    handlers.progress({ received: 125 * 1024 * 1024, total: 250 * 1024 * 1024, percent: 50.4 });
    expect(cover().querySelector('.update-cover-bar').getAttribute('aria-valuenow')).toBe('50');
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe('Downloading Vex 2.35.0… 50% (125 MB of 250 MB)');
    handlers.progress({ received: 1, total: 1, percent: 100, verifying: true });
    expect(cover().dataset.phase).toBe('verifying');
    finish({ ok: true });
    await flush();
    expect(window.vex.updates.install).toHaveBeenCalledWith('2.35.0');
    expect(cover().dataset.phase).toBe('installing');
    expect(cover().querySelector('.update-cover-status-text').textContent).toMatch(/Your tabs are saved, and Vex opens again by itself/);
    // The notes were read in the cover; What's New stays quiet on the new version.
    expect(localStorage.getItem('vex.lastSeenVersion')).toBe('2.35.0');
  });

  it('a failed install puts the What\'s New marker back', async () => {
    localStorage.setItem('vex.lastSeenVersion', '2.34.5');
    window.vex.updates.download = vi.fn(async () => ({ ok: true }));
    window.vex.updates.install = vi.fn(async () => ({ ok: false, error: 'Tabs could not be saved' }));
    UpdateNotifier.init();
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush(); await flush();
    expect(localStorage.getItem('vex.lastSeenVersion')).toBe('2.34.5');
    expect(cover().dataset.phase).toBe('error');
  });

  it('Cancel stops the download and goes back to the choices', async () => {
    let finish;
    window.vex.updates.download = vi.fn(() => new Promise(r => { finish = r; }));
    window.vex.updates.cancel = vi.fn(async () => { finish({ ok: false, code: 'cancelled', error: 'Download cancelled.' }); return { ok: true }; });
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    button('cancel').click();
    await flush();
    expect(window.vex.updates.cancel).toHaveBeenCalled();
    expect(cover().dataset.phase).toBe('choose');
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe('Download cancelled.');
    expect(window.vex.updates.install).not.toHaveBeenCalled();
  });

  it('a refused download says why in plain words and offers Try again', async () => {
    window.vex.updates.download = vi.fn(async () => ({ ok: false, code: 'checksum', error: 'The download did not match the checksum its release gives, so Vex deleted it and did not install it.' }));
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    expect(cover().dataset.phase).toBe('error');
    expect(cover().querySelector('.update-cover-status').getAttribute('role')).toBe('alert');
    expect(cover().querySelector('.update-cover-status-text').textContent).toMatch(/did not match the checksum/);
    expect(button('update').textContent).toBe('Try again');
    expect(window.vex.updates.install).not.toHaveBeenCalled();
  });

  it('an install that could not close Vex is shown on the cover', async () => {
    UpdateNotifier.init();
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    handlers.installFailed({ error: 'Vex could not save your tabs, so it did not close to install the update.' });
    expect(cover().dataset.phase).toBe('error');
    expect(cover().querySelector('.update-cover-status-text').textContent).toMatch(/could not save your tabs/);
  });
});

describe('keyboard', () => {
  it('Enter is Update now, even from the notes', async () => {
    UpdateNotifier.showCover(info);
    await flush();
    cover().querySelector('.update-cover-notes-body').focus();
    key('Enter');
    await flush();
    expect(window.vex.updates.download).toHaveBeenCalledWith('2.35.0');
  });

  it('Escape is Later; while downloading it is Cancel', async () => {
    UpdateNotifier.showCover(info);
    key('Escape');
    expect(cover()).toBe(null);
    expect(document.activeElement.id === 'behind' || document.activeElement === document.body).toBe(true);

    window.vex.updates.download = vi.fn(() => new Promise(() => {}));
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    key('Escape');
    expect(window.vex.updates.cancel).toHaveBeenCalled();
    expect(cover()).not.toBe(null);
  });

  it('Tab stays inside the cover, both ways', () => {
    UpdateNotifier.showCover(info);
    const items = [...cover().querySelectorAll('button, [tabindex="0"]')];
    // jsdom has no layout, so every element counts as visible here.
    const real = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function () { return [1]; };
    try {
      items[items.length - 1].focus();
      key('Tab');
      expect(document.activeElement).toBe(items[0]);
      key('Tab', { shift: true });
      expect(document.activeElement).toBe(items[items.length - 1]);
    } finally { Element.prototype.getClientRects = real; }
  });

  it('focus that lands behind the cover comes back to it', () => {
    UpdateNotifier.showCover(info);
    document.getElementById('behind').focus();
    expect(cover().contains(document.activeElement)).toBe(true);
    UpdateNotifier.close();
    document.getElementById('behind').focus();
    expect(document.activeElement.id).toBe('behind');
  });

  it('is the whole window: the generic [role=dialog] size cap is lifted', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/update-notifier.css'), 'utf8');
    const cap = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/accessibility-ui.css'), 'utf8');
    expect(cap).toMatch(/\[role=dialog\],\.vex-dialog \{ max-width:95vw;max-height:90vh/);
    expect(css).toMatch(/\.update-cover\[role=dialog\] \{ max-width: none; max-height: none;/);
  });

  it('keys do not reach Vex behind the cover', () => {
    const behind = vi.fn();
    document.addEventListener('keydown', behind, true);
    UpdateNotifier.showCover(info);
    key('k');
    expect(behind).not.toHaveBeenCalled();
    UpdateNotifier.close();
    key('k', { target: document.body });
    expect(behind).toHaveBeenCalled();
    document.removeEventListener('keydown', behind, true);
  });
});

describe('where it shows', () => {
  it('never in a private window', async () => {
    vi.useFakeTimers();
    window.VexTabPolicy = { isPrivateWindow: true };
    UpdateNotifier.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    expect(await UpdateNotifier.checkManually()).toBe(null);
    expect(cover()).toBe(null);
  });

  it('Settings › Check for Updates opens the same cover, even for a skipped version', async () => {
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.35.0');
    const r = await UpdateNotifier.checkManually();
    expect(r).toBe(info);
    expect(cover()).not.toBe(null);
  });

  it('a manual check that is up to date or fails says so', async () => {
    window.vex.checkForUpdates = async () => ({ ok: true, hasUpdate: false });
    await UpdateNotifier.checkManually();
    expect(toasts.pop().message).toMatch(/latest version/);
    window.vex.checkForUpdates = async () => ({ ok: false, error: 'rate limited' });
    await UpdateNotifier.checkManually();
    const t = toasts.pop();
    expect(t.type).toBe('error');
    expect(t.message).toMatch(/rate limited/);
  });

  it('a second check while downloading leaves the download alone', async () => {
    window.vex.updates.download = vi.fn(() => new Promise(() => {}));
    UpdateNotifier.showCover(info);
    button('update').click();
    await flush();
    const el = cover();
    UpdateNotifier.showCover(info);
    expect(cover()).toBe(el);
    expect(el.dataset.phase).toBe('downloading');
  });
});
