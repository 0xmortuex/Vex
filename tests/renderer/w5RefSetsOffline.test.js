// @vitest-environment jsdom
// T1-016: offline copies of every page of a reference set, and search scoped to a set.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let R, offline, tabs, front;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  ({ VexReferenceSets: R } = fresh(JS + 'reference-sets.js'));
  offline = new Set();
  tabs = [{ id: 'front', url: 'https://x.com/' }];
  front = 'front';
  let n = 0;
  globalThis.TabManager = {
    get tabs() { return tabs; },
    get activeTabId() { return front; },
    createTab: vi.fn((url) => { const id = 'n' + (++n); tabs.push({ id, url }); front = id; setTimeout(() => document.dispatchEvent(new CustomEvent('vex:tab-settled', { detail: { tabId: id } })), 0); return id; }),
    switchTab: vi.fn((id) => { front = id; }),
    closeTab: vi.fn((id) => { tabs = tabs.filter(t => t.id !== id); }),
  };
  globalThis.VexOfflinePages = {
    isOffline: (u) => offline.has(R.urlKey(u)),
    markActive: vi.fn(async () => { const t = tabs.find(x => x.id === front); if (t.url.includes('private')) throw new Error('Private, Tor and routed tabs are never archived'); offline.add(R.urlKey(t.url)); }),
  };
});

const mk = () => {
  const s = R.create('Docs');
  R.addPage(s.id, { url: 'https://docs.example.com/a', title: 'Page A' });
  R.addPage(s.id, { url: 'https://docs.example.com/b#intro', title: 'Page B' });
  R.addPage(s.id, { url: 'https://docs.example.com/private', title: 'Private one' });
  R.addSnippet(s.id, { text: 'qemu-system-x86_64 -bios OVMF.fd', title: 'run qemu' });
  return s;
};

describe('offline copies of a set', () => {
  it('counts what is kept and what is missing', () => {
    const s = mk();
    offline.add(R.urlKey('https://docs.example.com/a'));
    const st = R.offlineStatus(R.get(s.id));
    expect(st).toMatchObject({ total: 3, kept: 1 });
    expect(st.missing.map(m => m.title)).toEqual(['Page B', 'Private one']);
  });
  it('treats an address with a fragment or a trailing slash as the same page', () => {
    expect(R.urlKey('https://Docs.example.com/a/#top')).toBe(R.urlKey('https://docs.example.com/a'));
  });
  it('opens each missing page, keeps it, closes the tab it opened, and restores the tab in front', async () => {
    const s = mk();
    const progress = [];
    const r = await R.keepOffline(s.id, { onProgress: (n, of) => progress.push([n, of]) });
    expect(r.kept).toBe(2);
    expect(r.failed).toEqual([{ title: 'Private one', reason: 'Private, Tor and routed tabs are never archived' }]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(tabs.map(t => t.id)).toEqual(['front']);
    expect(front).toBe('front');
    expect(R.offlineStatus(R.get(s.id)).kept).toBe(2);
  });
  it('does not open a page that is already kept, and does not close a tab it did not open', async () => {
    const s = mk();
    offline.add(R.urlKey('https://docs.example.com/a'));
    offline.add(R.urlKey('https://docs.example.com/b'));
    const r = await R.keepOffline(s.id);
    expect(r.already).toBe(2);
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
  });
  it('says so when a page never finishes loading', async () => {
    const s = R.create('Slow');
    R.addPage(s.id, { url: 'https://slow.example.com/', title: 'Slow' });
    TabManager.createTab = vi.fn((url) => { const id = 'z'; tabs.push({ id, url }); front = id; return id; });
    const r = await R.keepOffline(s.id, { settleMs: 20 });
    expect(r.failed[0].reason).toMatch(/did not finish loading/);
    expect(tabs.map(t => t.id)).toEqual(['front']);
  });
  it('refuses in a private window and for an empty set', async () => {
    const s = R.create('Empty');
    await expect(R.keepOffline(s.id)).rejects.toThrow(/no pages yet/);
    window.VexTabPolicy = { isPrivateWindow: true };
    await expect(R.keepOffline(s.id)).rejects.toThrow(/private window/);
    delete window.VexTabPolicy;
  });
});

describe('search inside a set', () => {
  const hits = [
    { id: 'a'.repeat(16), url: 'https://docs.example.com/a', title: 'Page A', snippet: ['uses OVMF firmware'] },
    { id: 'b'.repeat(16), url: 'https://other.example.com/zzz', title: 'Not in the set', snippet: ['uses OVMF too'] },
  ];
  beforeEach(() => { window.vex = { pageArchiveSearch: vi.fn(async () => ({ ok: true, result: { hits } })) }; });
  it('keeps only hits from the pages of the set, adds matching snippets, and names the pages without a copy', async () => {
    const s = mk();
    offline.add(R.urlKey('https://docs.example.com/a'));
    const r = await R.searchSet(s.id, 'OVMF');
    expect(r.pages.map(p => p.title)).toEqual(['Page A']);
    expect(r.pages[0].snippet).toBe('uses OVMF firmware');
    expect(r.snippets.map(x => x.title)).toEqual(['run qemu']);
    expect(r.missing.map(m => m.title)).toEqual(['Page B', 'Private one']);
    expect(window.vex.pageArchiveSearch).toHaveBeenCalledWith('OVMF');
  });
  it('needs a query and reports a failed search', async () => {
    const s = mk();
    await expect(R.searchSet(s.id, '  ')).rejects.toThrow(/what to look for/);
    window.vex.pageArchiveSearch = vi.fn(async () => ({ ok: false, error: 'The archive library is busy' }));
    await expect(R.searchSet(s.id, 'x')).rejects.toThrow(/busy/);
  });
  it('requires every word for a snippet', () => {
    const s = mk();
    expect(R.searchSnippets(R.get(s.id), 'qemu bios')).toHaveLength(1);
    expect(R.searchSnippets(R.get(s.id), 'qemu nothing')).toHaveLength(0);
  });
});
