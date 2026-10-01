// @vitest-environment jsdom
//
// Read Later's reading-time check, Page Watch and the agent's read_url fetch a
// page from Vex's window, which goes out directly: a page of a site routed
// through Tor, a proxy or a container was fetched from the real address
// (found 2026-09-30). They now leave such sites alone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../src/renderer/js/collection-store.js';

let routed;
beforeEach(() => {
  localStorage.clear();
  routed = new Set(['routed.test']);
  globalThis.TabManager = {
    getActiveTab: () => null,
    windowMayAsk: () => true,
    mayAskSiteForIcon: (url) => !routed.has(new URL(url).hostname),
  };
  globalThis.AgentTools = { readUrl: vi.fn(async () => ({ text: 'one two three four five', title: 'T' })), _get: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  window.showToast = vi.fn();
});

describe('Read Later reading time', () => {
  it('does not fetch a routed site, or a page saved from a routed tab', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    ReadLater.init();
    ReadLater.items = [
      { id: 'r', url: 'https://routed.test/a', read: false },
      { id: 'o', url: 'https://plain.test/b', read: false, ownSession: true },
    ];
    expect(await ReadLater.measure('r')).toBeNull();
    expect(await ReadLater.measure('o')).toBeNull();
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('still measures an ordinary page', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    ReadLater.init();
    ReadLater.items = [{ id: 'p', url: 'https://plain.test/b', read: false }];
    expect(await ReadLater.measure('p')).toBe(1);
    expect(AgentTools.readUrl).toHaveBeenCalledWith('https://plain.test/b');
  });
});

describe('Page Watch', () => {
  it('refuses to check a routed site, and says why', async () => {
    const { PageWatch } = await import('../../src/renderer/js/page-watch.js');
    await expect(PageWatch.readValue({ url: 'https://routed.test/price' })).rejects.toThrow(/Tor, a proxy or a container/);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });
});

describe('the agent read_url tool', () => {
  it('does not read a routed site, and reads an ordinary one', async () => {
    const { AgentExecutor } = await import('../../src/renderer/js/agent-executor.js');
    const refused = await AgentExecutor.executeTool('read_url', { url: 'https://routed.test/' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/real connection/);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
    const ok = await AgentExecutor.executeTool('read_url', { url: 'https://plain.test/' });
    expect(ok.ok).toBe(true);
  });
});
