// @vitest-environment jsdom
// T3-116: the throwaway workspace: tabs sharing one in-memory session that is erased when the last closes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let G, tabs, created;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  document.body.innerHTML = '';
  ({ VexGuest: G } = fresh(JS + 'guest-session.js'));
  tabs = []; created = [];
  globalThis.TabManager = {
    get tabs() { return tabs; },
    createTab: vi.fn((url, activate, group, opts) => { const id = 't' + (tabs.length + 1 + created.length); created.push(id); tabs.push({ id, url: url || 'vex://start', partition: opts && opts.partition }); return id; }),
    closeTab: vi.fn((id) => { tabs = tabs.filter(t => t.id !== id); document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: id } })); }),
  };
  globalThis.VexModuleCommands = { set: vi.fn() };
  window.vexConfirm = vi.fn(async () => true);
});

describe('throwaway workspace', () => {
  it('is refused while guest sessions are off', () => {
    expect(() => G.startThrowaway()).toThrow(/switched off/);
  });
  it('opens tabs that all share one otr-throwaway partition, never persisted', () => {
    G.setEnabled(true);
    G.startThrowaway('https://a.com/');
    G.startThrowaway('https://b.com/');
    G.newThrowawayTab();
    expect(TabManager.createTab).toHaveBeenCalledTimes(3);
    const parts = new Set(tabs.map(t => t.partition));
    expect(parts.size).toBe(1);
    expect([...parts][0]).toMatch(/^otr-throwaway-[a-z0-9]+$/);
    expect(G.throwawayTabs()).toHaveLength(3);
    expect(document.querySelectorAll('#vex-throwaway-badge')).toHaveLength(1);
    expect(document.querySelector('#vex-throwaway-badge .vex-tw-text').textContent).toMatch(/3 tabs/);
  });
  it('shows a receipt and closes every tab of it, and only of it', async () => {
    G.setEnabled(true);
    TabManager.createTab('https://mine.com/', true, null, { partition: 'persist:main' });
    G.startThrowaway('https://a.com/x');
    G.newThrowawayTab('https://www.b.org/y');
    const lines = G.twReceipt();
    expect(lines[0]).toBe('2 open tabs');
    expect(lines[1]).toBe('2 sites visited in this workspace');
    expect(lines.join(' ')).toMatch(/Nothing from it was saved/);
    expect(await G.eraseThrowaway()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(tabs.map(t => t.url)).toEqual(['https://mine.com/']);
    expect(G.throwawayActive()).toBe(false);
    expect(document.getElementById('vex-throwaway-badge')).toBe(null);
  });
  it('keeps everything when the receipt is declined', async () => {
    G.setEnabled(true);
    G.startThrowaway('https://a.com/');
    window.vexConfirm = vi.fn(async () => false);
    expect(await G.eraseThrowaway()).toBe(false);
    expect(G.throwawayTabs()).toHaveLength(1);
  });
  it('ends by itself when the last tab is closed by hand', async () => {
    G.setEnabled(true);
    G.init();
    G.startThrowaway('https://a.com/');
    TabManager.closeTab(tabs[0].id);
    await new Promise(r => setTimeout(r, 5));
    expect(G.throwawayActive()).toBe(false);
    expect(document.getElementById('vex-throwaway-badge')).toBe(null);
  });
  it('is offered in Ctrl+K only when guest sessions are on', () => {
    G.registerCommands();
    expect(VexModuleCommands.set).toHaveBeenLastCalledWith('guest:', []);
    G.setEnabled(true);
    const list = VexModuleCommands.set.mock.calls.at(-1)[1];
    expect(list.map(c => c.id)).toContain('guest:throwaway');
  });
  it('refuses inside a window that is already private', () => {
    G.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => G.startThrowaway()).toThrow(/already private/);
    delete window.VexTabPolicy;
  });
});
