// @vitest-environment jsdom
// Turn off the microphone and camera in one press (js/capture-mute.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
const { VexCaptureMute } = require('../../src/renderer/js/capture-mute.js');

let sent, live;
beforeEach(() => {
  localStorage.clear();
  sent = [];
  live = [
    { where: 'tab', id: 't1', label: 'Meet', mic: true, camera: true },
    { where: 'tab', id: 't2', label: 'Share only', mic: false, camera: false },
    { where: 'panel', id: 'discord', label: 'Discord', mic: true, camera: false },
  ];
  window.showToast = vi.fn();
  globalThis.TabManager = { activeTabId: 't1' };
  globalThis.PermissionsSettings = { liveCaptures: () => live };
  globalThis.WebviewManager = { webviews: new Map([['t1', { send: (...a) => sent.push(['t1', ...a]) }]]) };
  globalThis.SidebarManager = { panelWebviews: { discord: { send: (...a) => sent.push(['discord', ...a]) } } };
});

describe('which captures a scope covers', () => {
  it('this tab is the active tab only; all is every mic or camera user, not a share-only tab', () => {
    expect(VexCaptureMute.entries('tab', live, 't1').map(e => e.id)).toEqual(['t1']);
    expect(VexCaptureMute.entries('tab', live, 't2')).toEqual([]);
    expect(VexCaptureMute.entries('all', live).map(e => e.id)).toEqual(['t1', 'discord']);
    expect(() => VexCaptureMute.entries('some', live)).toThrow(/this tab or all tabs/);
  });
});

describe('stopping', () => {
  it('asks the page in front to stop everything, and only that page', () => {
    expect(VexCaptureMute.stop('tab')).toBe(1);
    expect(sent).toEqual([['t1', 'vex-stop-capture', 'all']]);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });
  it('all tabs asks every page that is capturing, panels too', () => {
    expect(VexCaptureMute.stop('all')).toBe(2);
    expect(sent.map(s => s[0]).sort()).toEqual(['discord', 't1']);
  });
  it('says so when nothing is capturing, and sends nothing', () => {
    live = [];
    expect(VexCaptureMute.stop('all')).toBe(0);
    expect(sent).toEqual([]);
  });
  it('reports a page that is not loaded any more instead of pretending', () => {
    WebviewManager.webviews.clear();
    expect(() => VexCaptureMute.stop('tab')).toThrow(/not loaded/);
  });
  it('a click on one tab icon stops that tab only', () => {
    expect(VexCaptureMute.stopTab('t1')).toBe(true);
    expect(VexCaptureMute.stopTab('t2')).toBe(false);
    expect(sent).toEqual([['t1', 'vex-stop-capture', 'all']]);
  });
});

describe('the tab icon click is opt-in', () => {
  it('is off by default and the switch is stored under its own key', () => {
    expect(VexCaptureMute.badgeOn()).toBe(false);
    VexCaptureMute.setBadge(true);
    expect(localStorage.getItem('vex.captureMute.badge')).toBe('on');
    expect(VexCaptureMute.badgeOn()).toBe(true);
  });
  it('tabs.js only reacts to the icon when the switch is on, and loads the module lazily', () => {
    const tabs = read('src/renderer/js/tabs.js');
    expect(tabs).toMatch(/closest\('\.tab-capture'\) && localStorage\.getItem\('vex\.captureMute\.badge'\) === 'on'/);
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/src: 'js\/capture-mute\.js'/);
    expect(read('src/renderer/index.html')).not.toMatch(/capture-mute\.js/);
  });
  it('the page-side hook it relies on exists in the guest preload', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'latin1')).toContain("ipcRenderer.on('vex-stop-capture'");
  });
});
