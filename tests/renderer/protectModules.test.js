// @vitest-environment jsdom
// The renderer halves of the privacy report card, extension audit, crash-proof
// tabs and quiet hours: each injects its own Settings group and talks only to
// the (stubbed) preload bridge. The breach API is never involved here.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { ProtectSettings } = require('../../src/renderer/js/protect-settings.js');
const { PrivacyReportCard } = require('../../src/renderer/js/privacy-report-card.js');
const { ExtensionAuditView } = require('../../src/renderer/js/extension-audit-view.js');
const { TabSnapshots, vexSnapshotCapture, vexSnapshotApply } = require('../../src/renderer/js/tab-snapshots.js');
const { QuietHoursUI } = require('../../src/renderer/js/quiet-hours-ui.js');

// jsdom has no CSS.escape; the page script runs in Chromium, which does.
if (!globalThis.CSS || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c) };

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"><div class="setting-group"><div id="settings-version">v</div></div></div></div>';
  localStorage.clear();
  globalThis.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
  window.vex = {};
});

describe('settings groups', () => {
  it('are injected once, above About, with their own heading', () => {
    const a = ProtectSettings.group({ id: 'settings-x', title: 'Quiet hours' });
    const b = ProtectSettings.group({ id: 'settings-x', title: 'Quiet hours' });
    expect(a).toBe(b);
    const groups = [...document.querySelectorAll('.settings-content > .setting-group')];
    expect(groups.map(g => g.id)).toEqual(['settings-x', '']);
    expect(groups[0].querySelector('.setting-label').textContent).toBe('Quiet hours');
  });
});

describe('privacy report card', () => {
  const report = {
    stored: { total: 5, trackerCookies: 3, sites: [{ domain: 'track.net', count: 3, tracker: true, longLived: 1 }, { domain: 'big.org', count: 20, tracker: false, longLived: 0 }] },
    setThisWeek: { total: 7, perDay: [], top: [{ domain: 'track.net', count: 7, tracker: true }] },
    fingerprinting: { detectable: false, why: 'Nothing is counted for it.' },
  };
  it('shows the report, says fingerprinting is not counted, and cleans after confirmation', async () => {
    window.vex.privacyReport = vi.fn(async () => report);
    window.vex.privacyReportClean = vi.fn(async () => ({ removed: 3, failed: [], sites: ['track.net'] }));
    await PrivacyReportCard.open();
    const root = document.getElementById('vex-privacy-report');
    expect(root.textContent).toContain('Nothing is counted for it.');
    expect(root.textContent).toContain('track.net');
    // Trackers are pre-selected, a merely big site is not.
    expect([...root.querySelectorAll('.prc-pick:checked')].map(c => c.value)).toEqual(['track.net']);
    root.querySelector('#prc-clean').click();
    await tick();
    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(window.vex.privacyReportClean).toHaveBeenCalledWith(['track.net']);
  });

  it('does not clean when the confirmation is declined', async () => {
    globalThis.vexConfirm = vi.fn(async () => false);
    window.vex.privacyReport = vi.fn(async () => report);
    window.vex.privacyReportClean = vi.fn();
    await PrivacyReportCard.open();
    document.querySelector('#prc-clean').click();
    await tick();
    expect(window.vex.privacyReportClean).not.toHaveBeenCalled();
  });

  it('says so when the report cannot be read', async () => {
    window.vex.privacyReport = vi.fn(async () => { throw new Error('Vex is locked'); });
    await PrivacyReportCard.open();
    expect(document.querySelector('#prc-body').textContent).toContain('Vex is locked');
  });

  it('nudges weekly only when switched on, and only once a week', async () => {
    expect(await PrivacyReportCard.maybeNudge()).toBe(false);
    localStorage.setItem(PrivacyReportCard.WEEKLY_KEY, 'true');
    expect(await PrivacyReportCard.maybeNudge()).toBe(true);
    expect(await PrivacyReportCard.maybeNudge()).toBe(false);
  });
});

describe('extension audit view', () => {
  const list = [
    { folder: 'dark', name: 'Dark', version: '1', enabled: true, audit: { weight: 5, reach: { says: 'Can read every page', level: 'all', hosts: [] }, powers: [{ says: 'Read your history', heavy: true }] } },
    { folder: 'old', name: 'Old tool', version: '2', enabled: true, audit: { weight: 1, reach: { says: 'Cannot read pages', level: 'none', hosts: [] }, powers: [] } },
  ];
  const usage = [
    { folder: 'dark', lastUsed: null, lastUpdated: Date.now() - 3 * 86400000, passive: true, usageKnown: false, unused: null },
    { folder: 'old', lastUsed: null, lastUpdated: Date.now() - 100 * 86400000, passive: false, usageKnown: true, unused: true },
  ];
  it('shows reach, update, use and unused, and disables on one click after confirming', async () => {
    window.vex.extensionsList = vi.fn(async () => list);
    window.vex.extensionsUsageAudit = vi.fn(async () => usage);
    window.vex.extensionsSetEnabled = vi.fn(async () => ({ ok: true, enabled: false }));
    await ExtensionAuditView.open();
    const text = document.getElementById('vex-ext-audit').textContent;
    expect(text).toContain('Can read every page');
    expect(text).toContain('Works in the background');
    expect(text).toContain('Not used since it was installed');
    expect(text).toContain('Unused 30+ days');
    const rows = document.querySelectorAll('.eaud-row');
    expect(rows).toHaveLength(2);
    rows[1].querySelector('.eaud-off').click();
    await tick();
    expect(window.vex.extensionsSetEnabled).toHaveBeenCalledWith('old', false);
  });

  it('the passive extension is never labelled unused', () => {
    expect(ExtensionAuditView.usedText({ usage: usage[0] })).toContain('background');
  });
});

describe('crash-proof tabs: what the page script takes', () => {
  const capture = (forms = true) => vexSnapshotCapture({ forms });
  it('takes plain text and textarea values, and never a password, card, email or login form', () => {
    document.body.innerHTML = `
      <form><textarea id="comment">half a comment</textarea><input id="title" type="text" value="My title"></form>
      <form id="login"><input name="user" type="text" value="alice"><input type="password" name="pw" value="hunter2"></form>
      <input name="ccnumber" type="text" value="4111111111111111">
      <input name="mail" type="email" value="a@b.c">
      <input name="zip" type="text" autocomplete="cc-csc" value="123">
      <input name="note" type="text" value="">`;
    const out = capture();
    const values = out.fields.map(f => f.v);
    expect(values).toEqual(['half a comment', 'My title']);
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('4111');
    expect(JSON.stringify(out)).not.toContain('alice');
  });

  it('takes only the scroll position when form text is switched off', () => {
    document.body.innerHTML = '<textarea id="c">text</textarea>';
    expect(capture(false).fields).toEqual([]);
  });

  it('on a page with a password box outside any form, skips plain inputs too', () => {
    document.body.innerHTML = '<input name="who" type="text" value="alice"><input type="password" value="x">';
    expect(capture().fields).toEqual([]);
  });

  it('restores only into empty boxes and fires input events', () => {
    document.body.innerHTML = '<textarea id="c"></textarea><textarea id="d">typed since</textarea>';
    const seen = vi.fn();
    document.getElementById('c').addEventListener('input', seen);
    const r = vexSnapshotApply({ fields: [{ s: '#c', i: 0, v: 'back' }, { s: '#d', i: 0, v: 'old' }], scroll: { x: 0, y: 0 } });
    expect(r.fields).toBe(1);
    expect(document.getElementById('c').value).toBe('back');
    expect(document.getElementById('d').value).toBe('typed since');
    expect(seen).toHaveBeenCalled();
  });
});

describe('crash-proof tabs: sampling and policy', () => {
  it('samples only tabs the tab policy allows, and sends empty snapshots too', async () => {
    const wvFor = (cap) => ({ isLoading: () => false, executeJavaScript: vi.fn(async () => cap), getAttribute: () => 'persist:main' });
    const normal = wvFor({ scroll: { x: 0, y: 400 }, fields: [] });
    const priv = wvFor({ scroll: { x: 0, y: 900 }, fields: [] });
    globalThis.TabManager = { tabs: [{ id: 't1', url: 'https://a.example/x#h', partition: 'persist:main' }, { id: 't2', url: 'https://secret.example/', partition: 'tor-1' }] };
    globalThis.WebviewManager = { webviews: new Map([['t1', normal], ['t2', priv]]) };
    window.VexTabPolicy = { canPersist: (t) => t.partition.startsWith('persist:'), canReadWebview: (wv) => wv === normal };
    window.vex.tabSnapshots = { save: vi.fn(async () => ({ ok: true, formsKept: true })), load: vi.fn(async () => ({ entries: [], formsKept: true })) };
    TabSnapshots._restore = null; TabSnapshots._busy = false;
    await TabSnapshots.tick();
    const sent = window.vex.tabSnapshots.save.mock.calls[0][0];
    expect(sent.entries.map(e => e.url)).toEqual(['https://a.example/x']);
    expect(priv.executeJavaScript).not.toHaveBeenCalled();
    expect(sent.keepUrls).toContain('https://secret.example/');
  });

  it('puts a saved snapshot back into its restored page once, then samples it', async () => {
    const wv = { isLoading: () => false, executeJavaScript: vi.fn(async (code) => (/vexSnapshotApply/.test(code) ? { fields: 1, scrolled: true } : { scroll: { x: 0, y: 0 }, fields: [] })), getAttribute: () => 'persist:main' };
    globalThis.TabManager = { tabs: [{ id: 't9', url: 'https://a.example/x', title: 'A page' }] };
    globalThis.WebviewManager = { webviews: new Map([['t9', wv]]) };
    window.VexTabPolicy = { canPersist: () => true, canReadWebview: () => true };
    window.vex.tabSnapshots = {
      save: vi.fn(async () => ({ ok: true, formsKept: true })),
      load: vi.fn(async () => ({ entries: [{ url: 'https://a.example/x', scroll: { x: 0, y: 700 }, fields: [{ s: '#c', i: 0, v: 'draft' }] }], formsKept: true })),
    };
    TabSnapshots._restore = null; TabSnapshots._busy = false;
    await TabSnapshots.tick();
    const applies = wv.executeJavaScript.mock.calls.filter(c => /vexSnapshotApply/.test(c[0]));
    expect(applies).toHaveLength(1);
    expect(applies[0][0]).toContain('draft');
    expect(window.showToast).toHaveBeenCalled();
    await TabSnapshots.tick();
    expect(wv.executeJavaScript.mock.calls.filter(c => /vexSnapshotApply/.test(c[0]))).toHaveLength(1);
  });

  it('does nothing when switched off', async () => {
    localStorage.setItem(TabSnapshots.ON_KEY, 'false');
    window.vex.tabSnapshots = { save: vi.fn(), load: vi.fn() };
    TabSnapshots._busy = false;
    expect(await TabSnapshots.tick()).toBe(null);
    expect(window.vex.tabSnapshots.save).not.toHaveBeenCalled();
  });
});

describe('quiet hours settings', () => {
  it('reads the saved settings and saves a change through quiet:set', async () => {
    window.vex.quiet = {
      get: vi.fn(async () => ({ enabled: false, start: '22:00', end: '07:00', digestTimes: [], vip: ['mail.example.com'], inWindow: false, held: 2 })),
      set: vi.fn(async () => ({})), release: vi.fn(async () => ({ released: 2 })), drop: vi.fn(async () => ({ dropped: 2 })), held: vi.fn(),
    };
    const body = QuietHoursUI.mountSettings();
    await tick();
    expect(body.querySelector('textarea').value).toBe('mail.example.com');
    expect(body.textContent).toContain('2 notifications held');
    const cb = body.querySelector('input[type="checkbox"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await tick();
    expect(window.vex.quiet.set).toHaveBeenCalledWith({ enabled: true });
  });
});
