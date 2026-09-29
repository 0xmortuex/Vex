// @vitest-environment jsdom
// Escape closes every overlay the 2026-09-29 sweep found deaf to it, the same
// way its own close button does, and the keydown listener goes with it. An
// Escape meant for a Vex dialog on top is left to that dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every keydown listener added to a target and not yet removed.
function track(target) {
  const live = new Set();
  const add = target.addEventListener.bind(target);
  const rem = target.removeEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((t, fn, o) => { if (t === 'keydown') live.add(fn); return add(t, fn, o); });
  vi.spyOn(target, 'removeEventListener').mockImplementation((t, fn, o) => { if (t === 'keydown') live.delete(fn); return rem(t, fn, o); });
  return live;
}

function escape(target) {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  (target || document.activeElement || document.body).dispatchEvent(e);
  return e;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let live;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  window.VexIcons = globalThis.VexIcons;
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  live = track(document);
});
afterEach(() => { vi.restoreAllMocks(); });

// Open, press Escape, expect it gone and no keydown listener left.
async function closesOnEscape(open, sel) {
  await open();
  expect(document.querySelector(sel)).not.toBeNull();
  expect(live.size).toBeGreaterThan(0);
  const e = escape();
  expect(e.defaultPrevented).toBe(true);
  expect(document.querySelector(sel)).toBeNull();
  expect(live.size).toBe(0);
}

describe('modal overlays close on Escape', () => {
  it('theme picker', async () => {
    const { ThemePicker } = require('../../src/renderer/js/theme-picker.js');
    globalThis.ThemeManager = { getCurrentTheme: () => 'x' };
    vi.spyOn(ThemePicker, '_renderSections').mockImplementation(() => {});
    ThemePicker.open();
    expect(document.activeElement.classList.contains('vtp-close')).toBe(true);
    escape();
    expect(ThemePicker._overlay).toBeNull();
    expect(live.size).toBe(0);
    await sleep(200);
    expect(document.getElementById('vex-theme-picker-overlay')).toBeNull();
  });

  it('job setup', async () => {
    const { JobSetup } = require('../../src/renderer/js/job-setup.js');
    vi.spyOn(JobSetup, '_renderPick').mockImplementation(() => {});
    await closesOnEscape(() => JobSetup.open(), '#vex-jobsetup');
  });

  it('backup', async () => {
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    await closesOnEscape(() => VexBackup.open(), '#vex-backup');
  });

  it('speed reader, and its word timer stops', async () => {
    const { AccessibilityPack } = require('../../src/renderer/js/accessibility.js');
    globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: async () => 'one two three four five six seven eight nine ten eleven twelve' }) };
    await closesOnEscape(() => AccessibilityPack.rsvp(), '#vex-rsvp');
    const cleared = vi.spyOn(globalThis, 'setTimeout');
    await sleep(300);
    expect(cleared.mock.calls.length).toBe(1); // only the sleep itself; no tick re-armed
  });

  it('site settings', async () => {
    require('../../src/renderer/js/site-profiles.js');
    vi.spyOn(window.SiteProfiles, '_paint').mockImplementation(() => {});
    await closesOnEscape(() => window.SiteProfiles.open(), '#vex-siteprofiles');
  });

  it('logins hub, but not while Password Health is open on top of it', async () => {
    require('../../src/renderer/js/logins-hub.js');
    const { PasswordHealth } = require('../../src/renderer/js/password-health.js');
    vi.spyOn(window.LoginsHub, '_paint').mockImplementation(() => {});
    vi.spyOn(PasswordHealth, '_paint').mockImplementation(() => {});
    await window.LoginsHub.open();
    await PasswordHealth.open();
    escape();
    expect(document.getElementById('vex-pwhealth')).toBeNull();
    expect(document.getElementById('vex-loginshub')).not.toBeNull();
    escape();
    expect(document.getElementById('vex-loginshub')).toBeNull();
    expect(live.size).toBe(0);
  });

  it('password health', async () => {
    const { PasswordHealth } = require('../../src/renderer/js/password-health.js');
    vi.spyOn(PasswordHealth, '_paint').mockImplementation(() => {});
    await closesOnEscape(() => PasswordHealth.open(), '#vex-pwhealth');
  });

  it('auto-refresh, changing nothing', async () => {
    const { AutoReload } = require('../../src/renderer/js/auto-reload.js');
    const set = vi.spyOn(AutoReload, 'set');
    await closesOnEscape(() => AutoReload.open('t1'), '#vex-autoreload');
    expect(set).not.toHaveBeenCalled();
  });

  it('privacy report', async () => {
    const { PrivacyPack } = require('../../src/renderer/js/privacy-pack.js');
    window.vex = { privacyTrackerStats: async () => ({ total: 0, byHost: [], crossSite: [] }) };
    await closesOnEscape(() => PrivacyPack.showReport(), '#vex-privacy-report');
  });

  it('API client and Responsive Preview', async () => {
    const { JsonApiViewer, ResponsivePreview } = require('../../src/renderer/js/devtools-pack.js');
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/' }) };
    await closesOnEscape(() => JsonApiViewer.open(), '#vex-api');
    await closesOnEscape(() => ResponsivePreview.open('https://example.com/'), '#vex-responsive');
  });

  it('watches list, also after a watch is removed and the list redrawn', async () => {
    const { PageMonitor } = require('../../src/renderer/js/web-monitor.js');
    PageMonitor.watches = [{ id: 'w1', url: 'https://example.com/', title: 'Ex', intervalMin: 30 }];
    vi.spyOn(PageMonitor, 'remove').mockImplementation(function (id) { this.watches = this.watches.filter(w => w.id !== id); });
    PageMonitor.showManager();
    document.querySelector('#vex-watches [data-x]').click();
    expect(live.size).toBe(1); // the old list's listener went with it
    escape();
    expect(document.getElementById('vex-watches')).toBeNull();
    expect(live.size).toBe(0);
  });

  it('close button and backdrop remove the listener too', async () => {
    const { PasswordHealth } = require('../../src/renderer/js/password-health.js');
    vi.spyOn(PasswordHealth, '_paint').mockImplementation(() => {});
    await PasswordHealth.open();
    document.getElementById('pwh-close').click();
    expect(live.size).toBe(0);
    await PasswordHealth.open();
    document.getElementById('vex-pwhealth').click();
    expect(document.getElementById('vex-pwhealth')).toBeNull();
    expect(live.size).toBe(0);
  });

  it('leaves an Escape meant for a Vex dialog on top to that dialog', async () => {
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    VexBackup.open();
    const dlg = document.createElement('div');
    dlg.className = 'vex-dialog-overlay';
    document.body.appendChild(dlg);
    const e = escape(dlg);
    expect(e.defaultPrevented).toBe(false);
    expect(document.getElementById('vex-backup')).not.toBeNull();
    dlg.remove();
    escape();
    expect(document.getElementById('vex-backup')).toBeNull();
  });

  it('moves focus into the overlay so the key reaches Vex at all', async () => {
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    VexBackup.open();
    expect(document.activeElement.id).toBe('bk-close');
  });
});

describe('peek (window listener, already there)', () => {
  it('closes on Escape and focuses its close button', async () => {
    const { VexPeek } = require('../../src/renderer/js/peek.js');
    const wlive = track(window);
    VexPeek.open('https://example.com/');
    expect(document.activeElement.classList.contains('peek-close')).toBe(true);
    escape();
    expect(wlive.size).toBe(0);
    await sleep(200);
    expect(VexPeek.isOpen()).toBe(false);
  });
});

describe('sticky note', () => {
  it('Escape in the note saves and closes it; the listener goes with it', async () => {
    const { StickyNotes } = require('../../src/renderer/js/sticky-notes.js');
    const card = StickyNotes.open('example.com/page');
    const ta = card.querySelector('.vsn-text');
    expect(document.activeElement).toBe(ta);
    ta.value = 'remember this';
    escape(ta);
    expect(document.getElementById('vex-sticky')).toBeNull();
    expect(StickyNotes._load()['example.com/page'].text).toBe('remember this');
    expect(live.size).toBe(0);
  });

  it('an Escape with focus elsewhere leaves the note alone', async () => {
    const { StickyNotes } = require('../../src/renderer/js/sticky-notes.js');
    StickyNotes.open('example.com/page');
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    const e = escape(other);
    expect(e.defaultPrevented).toBe(false);
    expect(document.getElementById('vex-sticky')).not.toBeNull();
    document.getElementById('vex-sticky').remove();
    expect(live.size).toBe(0);
  });
});

describe('permission prompt', () => {
  const load = () => { require('../../src/renderer/js/permission-prompts.js'); return window.PermissionPrompts; };

  it('Escape blocks this once, remembering nothing', async () => {
    window.vex = { permissionRespond: vi.fn(async () => ({ ok: true })) };
    load().showPrompt({ id: 'p1', origin: 'https://example.com', permission: 'geolocation' });
    const e = escape(document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(window.vex.permissionRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', decision: 'deny', remember: false }));
    expect(live.size).toBe(0);
    await sleep(300);
    expect(document.querySelector('.permission-prompt')).toBeNull();
  });

  it('an Escape typed somewhere else (the command bar, say) is not taken', async () => {
    window.vex = { permissionRespond: vi.fn(async () => ({ ok: true })) };
    load().showPrompt({ id: 'p2', origin: 'https://example.com', permission: 'geolocation' });
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    escape(other);
    expect(window.vex.permissionRespond).not.toHaveBeenCalled();
    expect(document.querySelector('.permission-prompt')).not.toBeNull();
  });

  it('a button still answers, and takes the Escape listener with it', async () => {
    window.vex = { permissionRespond: vi.fn(async () => ({ ok: true })) };
    load().showPrompt({ id: 'p3', origin: 'https://example.com', permission: 'geolocation' });
    document.querySelector('.permission-prompt [data-remember="session"]').click();
    expect(window.vex.permissionRespond).toHaveBeenCalledWith(expect.objectContaining({ id: 'p3', decision: 'allow', remember: 'session' }));
    expect(live.size).toBe(0);
  });
});
