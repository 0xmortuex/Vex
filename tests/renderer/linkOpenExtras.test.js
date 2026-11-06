// @vitest-environment jsdom
// More ways to open a link (js/link-open-extras.js): split view, another container, a private window, the background.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexLinkOpen } = require('../../src/renderer/js/link-open-extras.js');
const RealSplit = require('../../src/renderer/js/split.js').SplitScreen;
const RealIncognito = require('../../src/renderer/js/incognito.js').VexIncognito;

const wv = (partition, tabId = '1') => ({ dataset: { tabId }, getAttribute: () => partition });
let created;
beforeEach(() => {
  created = [];
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: (w) => !String(w.getAttribute() || '').startsWith('temp') };
  globalThis.TabManager = {
    tabs: [{ id: '1', groupId: 'g', partition: 'persist:main' }],
    getActiveTab() { return this.tabs[0]; },
    createTab: vi.fn((url, activate, group, opts) => { const t = { id: 'n' + (created.length + 2), url, groupId: group, partition: opts && opts.partition }; created.push({ url, activate, group, opts }); return t; }),
  };
  globalThis.VexContainerMemory = { choices: () => [
    { name: 'Main', partition: 'persist:main' }, { name: 'Banking', partition: 'persist:container-banking' }, { name: 'Alt', partition: 'persist:container-alt' }] };
  globalThis.SplitScreen = { active: false, panes: [], restore: vi.fn(() => true), addPane: vi.fn() };
});

describe('pure parts', () => {
  it('plans the split: start with two, add to a running split, refuse a full one', () => {
    expect(VexLinkOpen.planSplit({ active: false, panes: [], fromId: 'a', newId: 'b' })).toEqual({ action: 'start', panes: ['a', 'b'] });
    expect(VexLinkOpen.planSplit({ active: true, panes: ['a', 'b'], fromId: 'a', newId: 'c' })).toEqual({ action: 'add', panes: ['a', 'b', 'c'] });
    expect(VexLinkOpen.planSplit({ active: true, panes: ['a', 'b', 'c', 'd'], fromId: 'a', newId: 'e' })).toEqual({ action: 'full' });
  });
  it('offers every container but the one the tab is in', () => {
    const c = VexLinkOpen.containerChoices(VexContainerMemory.choices(), 'persist:container-banking');
    expect(c.map(x => x.name)).toEqual(['Main', 'Alt']);
  });
  it('only web links', () => {
    expect(VexLinkOpen.webLink('https://a.test/')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'mailto:a@b.c', 'file:///C:/x', '', null]) expect(VexLinkOpen.webLink(bad)).toBe(false);
    expect(VexLinkOpen.menuItems('mailto:a@b.c', wv('persist:main'), true)).toEqual([]);
  });
});

describe('the rows', () => {
  it('has the container submenu first, then split, private window, background', () => {
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('persist:main'), true);
    expect(rows.map(r => r.label)).toEqual(['Open Link in Container', 'Open Link in Split View', 'Open Link in Private Window', 'Open Link in Background']);
    expect(rows[0].sub.map(r => r.label)).toEqual(['Banking', 'Alt']);
  });
  it('leaves out the container row when there is no other container', () => {
    globalThis.VexContainerMemory = { choices: () => [{ name: 'Main', partition: 'persist:main' }] };
    expect(VexLinkOpen.menuItems('https://a.test/', wv('persist:main'), true).map(r => r.label)).not.toContain('Open Link in Container');
  });
  it('still builds the menu when the container list cannot be read, and says so', () => {
    globalThis.VexContainerMemory = { choices: () => { throw new Error('corrupt'); } };
    window.VexProblems = { note: vi.fn() };
    const rows = VexLinkOpen.menuItems('https://a.test/', wv('persist:main'), true);
    expect(rows.length).toBe(3);
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
});

describe('actions', () => {
  it('background: a tab that is not activated, in the same container and group', async () => {
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('persist:main'), true);
    rows.find(r => r.label === 'Open Link in Background').action();
    await new Promise(r => setTimeout(r, 0));
    expect(created[0].activate).toBe(false);
    expect(created[0].group).toBe('g');
    expect(created[0].opts.partition).toBe('persist:main');
  });
  it('container: an activated tab in that container', async () => {
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('persist:main'), true);
    rows[0].sub[0].action();
    await new Promise(r => setTimeout(r, 0));
    expect(created[0].activate).toBe(true);
    expect(created[0].opts.partition).toBe('persist:container-banking');
  });
  it('split: starts a split of the tab in front and the new one', async () => {
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('persist:main'), true);
    rows.find(r => r.label === 'Open Link in Split View').action();
    await new Promise(r => setTimeout(r, 0));
    expect(created[0].activate).toBe(false);
    expect(globalThis.SplitScreen.restore).toHaveBeenCalledWith(['1', 'n2'], 0.5);
  });
  it('split: adds to a running split, and opens nothing when it is full', async () => {
    globalThis.SplitScreen.active = true; globalThis.SplitScreen.panes = ['1', 'x'];
    VexLinkOpen.openInSplit('https://a.test/', TabManager.tabs[0]);
    expect(globalThis.SplitScreen.addPane).toHaveBeenCalledWith('n2');
    globalThis.SplitScreen.panes = ['1', 'x', 'y', 'z']; created.length = 0;
    VexLinkOpen.openInSplit('https://a.test/', TabManager.tabs[0]);
    expect(created).toEqual([]);
    expect(window.showToast).toHaveBeenCalledWith('Split view is full (4 panes); close one first', 'error');
  });
  it('private window: hands the link to the opener', async () => {
    globalThis.VexIncognito = { open: vi.fn(async () => true) };
    await VexLinkOpen.openInPrivateWindow('https://a.test/p');
    expect(globalThis.VexIncognito.open).toHaveBeenCalledWith('https://a.test/p');
  });
  it('asks before taking a link out of a Tor, proxy or disposable tab, and does nothing on No', async () => {
    window.vexConfirm = vi.fn(async () => false);
    globalThis.VexIncognito = { open: vi.fn(async () => true) };
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('temp-burner'), true);
    rows.find(r => r.label === 'Open Link in Private Window').action();
    rows[0].sub[0].action();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);
    expect(globalThis.VexIncognito.open).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });
  it('does not ask for the rows that stay in the same container', async () => {
    const rows = VexLinkOpen.menuItems('https://a.test/x', wv('temp-burner'), true);
    rows.find(r => r.label === 'Open Link in Background').action();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(created.length).toBe(1);
  });
});

describe('the pieces it relies on', () => {
  it('SplitScreen.addPane puts one more pane in a running split and refuses otherwise', () => {
    const S = { ...globalThis.SplitScreen, MAX_PANES: 4, active: true, panes: ['a', 'b'], applySplit: vi.fn() };
    const real = RealSplit;
    globalThis.TabManager.tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    real.addPane.call(S, 'c');
    expect(S.panes).toEqual(['a', 'b', 'c']);
    expect(S.applySplit).toHaveBeenCalled();
    expect(() => real.addPane.call({ ...S, active: false }, 'c')).toThrow(/not split/);
    expect(() => real.addPane.call({ ...S, panes: ['a', 'b', 'c', 'd'] }, 'c')).toThrow(/full/);
    expect(() => real.addPane.call({ ...S, panes: ['a'] }, 'zzz')).toThrow(/not open/);
  });
  it('VexIncognito.open passes a web link to the window opener and ignores anything else', async () => {
    window.vex = { openPrivateWindow: vi.fn(async () => true) };
    await RealIncognito.open('https://a.test/q');
    expect(window.vex.openPrivateWindow.mock.calls[0][2]).toBe('https://a.test/q');
    await RealIncognito.open({ type: 'click' });
    expect(window.vex.openPrivateWindow.mock.calls[1][2]).toBeUndefined();
    await RealIncognito.open('javascript:alert(1)');
    expect(window.vex.openPrivateWindow.mock.calls[2][2]).toBeUndefined();
  });
  it('the link menu uses it and keeps the container row in the main list', () => {
    const web = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
    expect(web).toMatch(/VexLinkOpen\.menuItems\(e\.params\.linkURL, webview, isTab\)/);
    expect(web).toMatch(/it\.label === 'Open Link in Container'/);
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/lazy-boot.js'), 'utf8')).toContain("'js/link-open-extras.js'");
  });
});
