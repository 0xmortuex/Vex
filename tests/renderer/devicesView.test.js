// @vitest-environment jsdom
//
// The Devices view (js/devices-view.js): every device with its tabs, one click
// to open a tab here, a button to send it to one device, "Continue where I
// left off", and nothing from a title or name reaching the page as markup.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const Live = require('../../src/renderer/js/live-session.js');
window.VexLiveSession = Live;

const NOW = Date.now();
const view = [
  { deviceId: 'a'.repeat(32), name: 'Desk', kind: 'computer', self: true, lastSeen: NOW, lastActive: NOW - 3600000, stale: false, tabCount: 1, cut: 0,
    tabs: [{ id: 't1', url: 'https://here.test/', title: 'Here', pinned: false, scroll: 0, lastActive: NOW - 3600000, active: true }] },
  { deviceId: 'b'.repeat(32), name: '<b>Laptop</b>', kind: 'computer', self: false, lastSeen: NOW - 60000, lastActive: NOW - 120000, stale: false, tabCount: 2, cut: 3,
    tabs: [
      { id: 'x1', url: 'https://there.test/a', title: '<img src=x onerror=alert(1)>', pinned: true, group: 'Work', scroll: 0, lastActive: NOW - 120000, active: true, favicon: 'https://there.test/i.png' },
      { id: 'x2', url: 'https://there.test/b', title: 'B', pinned: false, scroll: 0, lastActive: NOW - 500000, active: false },
    ] },
  { deviceId: 'c'.repeat(32), name: 'Pixel 9', kind: 'phone', self: false, lastSeen: NOW - 900000, lastActive: 0, stale: false, tabCount: 0, cut: 0, tabs: [] },
];
let DevicesView, engine;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.showToast = vi.fn();
  engine = { isEnabled: () => true, devicesView: () => view, listDevices: vi.fn(async () => []), syncTypes: () => [{ id: 'liveTabs', on: true }] };
  globalThis.SyncEngine = window.SyncEngine = engine;
  globalThis.TabManager = window.TabManager = { tabs: [], createTab: vi.fn() };
  globalThis.Handoff = window.Handoff = { send: vi.fn(async () => ({ ok: true })), _human: e => e.message };
  delete require.cache[require.resolve('../../src/renderer/js/devices-view.js')];
  ({ DevicesView } = require('../../src/renderer/js/devices-view.js'));
});

describe('Devices view', () => {
  it('draws every device and escapes what other devices wrote', async () => {
    await DevicesView.open();
    const names = [...document.querySelectorAll('.dv-device-name')].map(n => n.textContent.trim());
    expect(names[0]).toContain('Desk');
    expect(names).toContain('<b>Laptop</b>');
    expect(document.querySelector('.dv-card img[src="x"]')).toBeNull();
    expect(document.querySelector('.dv-more').textContent).toContain('3 more');
    expect(document.querySelector('.dv-group').textContent).toBe('Work');
    expect(engine.listDevices).toHaveBeenCalled();
  });

  it('opens a tab here with one click, and sends one to a single device', async () => {
    await DevicesView.open();
    document.querySelector('.dv-tab[data-device="' + 'b'.repeat(32) + '"][data-tab="1"] [data-act="open"]').click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://there.test/b', true);
    expect(document.querySelector('.dv-overlay')).toBeNull();
    await DevicesView.open();
    const send = document.querySelector('.dv-tab[data-device="' + 'b'.repeat(32) + '"][data-tab="0"] [data-act="send"][data-to="' + 'c'.repeat(32) + '"]');
    expect(send.getAttribute('aria-label')).toBe('Send to Pixel 9');
    send.click();
    await Promise.resolve(); await Promise.resolve();
    expect(Handoff.send).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://there.test/a' }), 'c'.repeat(32));
  });

  it('offers to continue where you left off, and opens the other device\'s tabs', async () => {
    await DevicesView.open();
    expect(document.querySelector('.dv-continue').textContent).toContain('Continue where you left off');
    document.querySelector('[data-act="continue"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(TabManager.createTab.mock.calls.map(c => c[0])).toEqual(['https://there.test/a', 'https://there.test/b']);
  });

  it('says once per use of the other device, only with Live tabs on', () => {
    expect(DevicesView.maybeOffer(NOW)).not.toBeNull();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(DevicesView.maybeOffer(NOW)).toBeNull();
    localStorage.clear();
    engine.syncTypes = () => [{ id: 'liveTabs', on: false }];
    expect(DevicesView.maybeOffer(NOW)).toBeNull();
  });

  it('says what is off when Live tabs is off', async () => {
    engine.syncTypes = () => [{ id: 'liveTabs', on: false }];
    await DevicesView.open();
    expect(document.querySelector('.dv-note').textContent).toContain('Live tabs is off');
  });
});
