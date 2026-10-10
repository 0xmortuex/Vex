// @vitest-environment jsdom
//
// Audit B21 (2026-10-10): Ctrl+K "Clear This Site's Data & Reload" said
// "Cleared — reloading" whatever main answered. A failure is said instead.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');
window.escapeHtml = (s) => String(s);

const cmd = (id) => CommandBar.commands.find(c => c.id === id);
let wv;
beforeEach(() => {
  window.showToast = vi.fn();
  wv = { getURL: () => 'https://news.example/a', reloadIgnoringCache: vi.fn() };
  globalThis.TabManager = { activeTabId: 't1', getActiveTab: () => ({ id: 't1', url: 'https://news.example/a', partition: 'persist:main' }) };
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
});

describe("Clear This Site's Data & Reload", () => {
  it('says what failed and does not claim it cleared', async () => {
    window.vex = { clearSiteData: vi.fn(async () => ({ ok: false, error: 'Not everything was cleared: its cookies (session gone)' })) };
    await cmd('clearsite').action();
    expect(window.vex.clearSiteData).toHaveBeenCalledWith({ partition: 'persist:main', url: 'https://news.example/a' });
    expect(window.showToast).toHaveBeenCalledWith('That did not work: Not everything was cleared: its cookies (session gone)', 'error');
    expect(window.showToast).not.toHaveBeenCalledWith('Cleared — reloading', 'success');
    expect(wv.reloadIgnoringCache).not.toHaveBeenCalled();
  });

  it('says it cleared only when main says so', async () => {
    window.vex = { clearSiteData: vi.fn(async () => ({ ok: true, cookies: 3 })) };
    await cmd('clearsite').action();
    expect(window.showToast).toHaveBeenCalledWith('Cleared — reloading', 'success');
    expect(wv.reloadIgnoringCache).toHaveBeenCalled();
  });
});
