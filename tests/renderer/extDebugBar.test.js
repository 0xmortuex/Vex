// @vitest-environment jsdom
//
// The bar over a tab an extension controls (js/ext-debug-bar.js), 2026-10-28: drawn by Vex's own window, so a page cannot hide, fake or press it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexExtDebugBar } = require('../../src/renderer/js/ext-debug-bar.js');

let wcId, stopped;
beforeEach(() => {
  document.body.innerHTML = '<div id="webviews-container"></div>';
  wcId = 6; stopped = [];
  VexExtDebugBar._rows = []; VexExtDebugBar._bar = null;
  globalThis.TabManager = { activeTabId: 't1' };
  globalThis.WebviewManager = { webviews: new Map([['t1', { getWebContentsId: () => wcId }]]) };
  window.vex = { extensionsDebugStop: vi.fn(async (r) => { stopped.push(r); }) };
  window.showToast = vi.fn();
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.WebviewManager; delete window.vex; delete window.showToast; });

describe('which rows are for the tab in front', () => {
  it('picks the rows of that web contents only', () => {
    const rows = [{ tabId: 6, extId: 'a', name: 'Claude' }, { tabId: 9, extId: 'b', name: 'Other' }];
    expect(VexExtDebugBar.forTab(rows, 6)).toEqual([rows[0]]);
    expect(VexExtDebugBar.forTab(rows, 3)).toEqual([]);
    expect(VexExtDebugBar.forTab(null, 6)).toEqual([]);
  });
});

describe('the bar', () => {
  it('appears over the tab in front when an extension holds it, naming the extension, and has a Stop button', () => {
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }]);
    const bar = document.getElementById('ext-debug-bar');
    expect(bar).toBeTruthy();
    expect(bar.querySelector('.ext-debug-bar-text').textContent).toBe('Claude is controlling this tab');
    expect(bar.querySelector('.ext-debug-bar-stop').textContent).toBe('Stop');
    expect(bar.getAttribute('role')).toBe('status');
  });
  it('names two extensions once each, and says "are"', () => {
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }, { tabId: 6, extId: 'b', name: 'Other' }, { tabId: 6, extId: 'c', name: 'Other' }]);
    expect(document.querySelector('.ext-debug-bar-text').textContent).toBe('Claude, Other are controlling this tab');
  });
  it('is not there when the tab in front is not held, and goes when the person switches to a free tab', () => {
    VexExtDebugBar.set([{ tabId: 9, extId: 'a', name: 'Claude' }]);
    expect(document.getElementById('ext-debug-bar')).toBeNull();
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }]);
    expect(document.getElementById('ext-debug-bar')).toBeTruthy();
    wcId = 9;
    VexExtDebugBar.refresh();
    expect(document.getElementById('ext-debug-bar')).toBeNull();
  });
  it('goes when the extension lets go', () => {
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }]);
    VexExtDebugBar.set([]);
    expect(document.getElementById('ext-debug-bar')).toBeNull();
  });
  it('is one bar, not one per update', () => {
    for (let i = 0; i < 4; i++) VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }]);
    expect(document.querySelectorAll('#ext-debug-bar').length).toBe(1);
  });
  it('Stop asks main to let go of that tab for that extension, for every extension holding it', async () => {
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }, { tabId: 6, extId: 'b', name: 'Other' }]);
    document.querySelector('.ext-debug-bar-stop').click();
    await new Promise(r => setTimeout(r, 0));
    expect(stopped).toEqual([{ tabId: 6, extId: 'a' }, { tabId: 6, extId: 'b' }]);
  });
  it('says so when main could not stop it', async () => {
    window.vex.extensionsDebugStop = vi.fn(async () => { throw new Error('gone'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: 'Claude' }]);
    document.querySelector('.ext-debug-bar-stop').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('Could not stop it: gone', 'error');
  });
  it('a name that came from an extension is text, never markup', () => {
    VexExtDebugBar.set([{ tabId: 6, extId: 'a', name: '<img src=x onerror=alert(1)>' }]);
    expect(document.querySelector('#ext-debug-bar img')).toBeNull();
    expect(document.querySelector('.ext-debug-bar-text').textContent).toContain('<img src=x');
  });
});

// An extension that drives a tab with the switch off is asked about in Vex's own box (main sends extensions:grant-ask); only Allow turns it on.
describe('asking to let an extension control tabs', () => {
  it('Allow turns the debugger switch on for that extension and says so', async () => {
    window.vexConfirm = vi.fn(async () => true);
    window.vex.extensionsSetGrant = vi.fn(async () => ({ ok: true }));
    await VexExtDebugBar.ask({ folder: 'claude-1', grant: 'debugger', name: 'Claude' });
    expect(window.vexConfirm.mock.calls[0][0].title).toContain('Claude');
    expect(window.vex.extensionsSetGrant).toHaveBeenCalledWith({ folder: 'claude-1', grant: 'debugger', on: true });
    expect(window.showToast.mock.calls[0][1]).toBe('success');
    delete window.vexConfirm;
  });
  it('declining changes nothing, and a request for anything else is ignored', async () => {
    window.vexConfirm = vi.fn(async () => false);
    window.vex.extensionsSetGrant = vi.fn(async () => ({ ok: true }));
    await VexExtDebugBar.ask({ folder: 'claude-1', grant: 'debugger', name: 'Claude' });
    await VexExtDebugBar.ask({ folder: 'claude-1', grant: 'nativeMessaging', name: 'Claude' });
    await VexExtDebugBar.ask(null);
    expect(window.vex.extensionsSetGrant).not.toHaveBeenCalled();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    delete window.vexConfirm;
  });
  it('a failure to save is shown, never silent', async () => {
    window.vexConfirm = vi.fn(async () => true);
    window.vex.extensionsSetGrant = vi.fn(async () => ({ ok: false, error: 'disk' }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await VexExtDebugBar.ask({ folder: 'claude-1', grant: 'debugger', name: 'Claude' });
    expect(window.showToast.mock.calls[0][1]).toBe('error');
    err.mockRestore();
    delete window.vexConfirm;
  });
});
