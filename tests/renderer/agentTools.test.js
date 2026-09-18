// @vitest-environment jsdom
//
// The agent's tools that need no page (js/agent-tools.js). Before these, the
// agent could only act on the page in front — so "research X" meant driving a
// search engine one click at a time, and a note, a reminder, a bookmark or a
// tab group was out of reach.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { AgentTools } = require('../../src/renderer/js/agent-tools.js');

const DDG = `<html><body>
  <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">An ad</a></div>
  <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freleases.electronjs.org%2F&amp;rut=abc">Electron Releases</a></h2><a class="result__snippet">All stable, beta and nightly releases.</a></div>
  <div class="result"><h2><a class="result__a" href="https://example.org/direct">Direct link</a></h2><a class="result__snippet">No wrapper here.</a></div>
</body></html>`;
const BING = `<html><body><ol><li class="b_algo"><h2><a href="https://www.electronjs.org/blog">Electron Blog</a></h2><div class="b_caption"><p>News from the team.</p></div></li></ol></body></html>`;
const page = (body, type = 'text/html; charset=utf-8', status = 200) => ({ ok: true, status, headers: { 'content-type': type }, body });

beforeEach(() => { localStorage.clear(); window.vex = {}; });

describe('web_search', () => {
  it('reads DuckDuckGo results, unwraps the redirect links and skips the ads', () => {
    expect(AgentTools.parseDuckDuckGo(DDG)).toEqual([
      { title: 'Electron Releases', url: 'https://releases.electronjs.org/', snippet: 'All stable, beta and nightly releases.' },
      { title: 'Direct link', url: 'https://example.org/direct', snippet: 'No wrapper here.' },
    ]);
  });

  it('falls back to Bing when DuckDuckGo gives nothing, and says which engine answered', async () => {
    window.vex.apiRequest = vi.fn(async ({ url }) => page(/duckduckgo/.test(url) ? '<html><body>challenge</body></html>' : BING));
    const r = await AgentTools.webSearch('electron latest', 5);
    expect(r).toEqual({ query: 'electron latest', engine: 'Bing', results: [{ title: 'Electron Blog', url: 'https://www.electronjs.org/blog', snippet: 'News from the team.' }] });
    expect(window.vex.apiRequest).toHaveBeenCalledTimes(2);
  });

  it('says why when every engine fails, and needs a query', async () => {
    window.vex.apiRequest = vi.fn(async () => ({ ok: false, error: 'net::ERR_INTERNET_DISCONNECTED' }));
    await expect(AgentTools.webSearch('x')).rejects.toThrow(/Search failed — DuckDuckGo: net::ERR_INTERNET_DISCONNECTED; Bing: net::ERR/);
    await expect(AgentTools.webSearch('  ')).rejects.toThrow(/needs a query/);
  });
});

describe('read_url', () => {
  it('returns the readable text: article over chrome, paragraphs kept apart', async () => {
    const html = '<html><head><title>Guide</title><style>p{}</style></head><body><nav>Home About</nav><article><h1>Heading</h1><p>First paragraph with enough words to count as the real content of this page, repeated. '.padEnd(500, 'x') + '</p><p>Second.</p></article><footer>Copyright</footer><script>evil()</script></body></html>';
    window.vex.apiRequest = vi.fn(async () => page(html));
    const r = await AgentTools.readUrl('https://docs.example.com/guide');
    expect(r.title).toBe('Guide');
    expect(r.text).toMatch(/^Heading\nFirst paragraph/);
    expect(r.text).toContain('\nSecond.');
    expect(r.text).not.toMatch(/Home About|Copyright|evil/);
  });

  it('refuses this machine, the local network, and anything that is not a web page', async () => {
    window.vex.apiRequest = vi.fn();
    for (const url of ['http://localhost:3000/', 'http://127.0.0.1/admin', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.20.1.1/', 'http://router.local/', 'http://[::1]/']) {
      await expect(AgentTools.readUrl(url), url).rejects.toThrow(/this machine or the local network/);
    }
    await expect(AgentTools.readUrl('file:///C:/secret.txt')).rejects.toThrow(/Only http and https/);
    await expect(AgentTools.readUrl('not a url')).rejects.toThrow(/Not a valid URL/);
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
    expect(AgentTools.isPrivateHost('172.32.0.1')).toBe(false);
    expect(AgentTools.isPrivateHost('example.com')).toBe(false);
  });

  it('says what to do about a file, an error status, and a page built by JavaScript', async () => {
    window.vex.apiRequest = vi.fn(async () => page('%PDF-1.7', 'application/pdf'));
    await expect(AgentTools.readUrl('https://x.example/a.pdf')).rejects.toThrow(/application\/pdf, not a page — open it in a tab/);
    window.vex.apiRequest = vi.fn(async () => page('nope', 'text/html', 404));
    await expect(AgentTools.readUrl('https://x.example/missing')).rejects.toThrow(/HTTP 404 from x\.example/);
    window.vex.apiRequest = vi.fn(async () => page('<html><body><div id="root"></div></body></html>'));
    expect((await AgentTools.readUrl('https://spa.example/')).note).toMatch(/builds itself with JavaScript.*new_tab.*extract_text/);
  });

  it('truncates a long page and says so', async () => {
    window.vex.apiRequest = vi.fn(async () => page('<html><body><article><p>' + 'word '.repeat(6000) + '</p></article></body></html>'));
    const r = await AgentTools.readUrl('https://long.example/');
    expect(r.text.length).toBe(AgentTools.MAX_TEXT);
    expect(r.truncated).toBe(true);
  });
});

describe("Vex's own features", () => {
  it('saves a note at the top of the Notes panel, tagged as the agent\'s', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'old', title: 'Old' }]));
    globalThis.NotesPanel = { reloadSyncedState: vi.fn() };
    const note = AgentTools.saveNote('Electron versions', '## Findings\n- 44.4.2', 'https://releases.electronjs.org/');
    const stored = JSON.parse(localStorage.getItem('vex.notes'));
    expect(stored.map(n => n.title)).toEqual(['Electron versions', 'Old']);
    expect(stored[0]).toMatchObject({ content: '## Findings\n- 44.4.2', tags: ['agent'], sourceUrl: 'https://releases.electronjs.org/' });
    expect(NotesPanel.reloadSyncedState).toHaveBeenCalled();
    expect(note.id).toMatch(/^note_/);
    expect(() => AgentTools.saveNote('', '  ')).toThrow(/needs a title or some content/);
    delete globalThis.NotesPanel;
  });

  it('bookmarks a page once', () => {
    globalThis.Bookmarks = { items: [], has(u) { return this.items.some(b => b.url === u); }, save: vi.fn() };
    expect(AgentTools.addBookmark('https://a.example/x', 'A')).toEqual({ url: 'https://a.example/x', already: false });
    expect(Bookmarks.items[0]).toMatchObject({ url: 'https://a.example/x', title: 'A', folder: '' });
    expect(Bookmarks.save).toHaveBeenCalledTimes(1);
    expect(AgentTools.addBookmark('https://a.example/x').already).toBe(true);
    expect(() => AgentTools.addBookmark('javascript:alert(1)')).toThrow(/Not a web address/);
    delete globalThis.Bookmarks;
  });

  it('searches history by every word, in the title, address or summary', () => {
    localStorage.setItem('vex.history', JSON.stringify([
      { url: 'https://docs.electronjs.org/webview', title: 'webview tag', time: 1789300000000, summary: 'Embedding guest pages' },
      { url: 'https://news.example/', title: 'News', time: 1789300000001 },
    ]));
    expect(AgentTools.searchHistory('electron guest').map(h => h.url)).toEqual(['https://docs.electronjs.org/webview']);
    expect(AgentTools.searchHistory('nothing-here')).toEqual([]);
  });

  it('sets a reminder from plain words, or for the next visit to a site', async () => {
    const at = new Date(Date.now() + 3600000);
    globalThis.VexQuickReminder = { parseTrigger: vi.fn((t) => /github/.test(t) ? { site: 'github.com' } : { at }), create: vi.fn(async () => ({ id: 'r1' })) };
    const made = await AgentTools.createReminder('Call Dana', 'in 1 hour');
    expect(VexQuickReminder.create).toHaveBeenCalledWith('Call Dana', at, undefined);
    expect(made).toMatchObject({ id: 'r1', message: 'Call Dana', when: at.toLocaleString() });
    expect((await AgentTools.createReminder('Check PRs', 'when on github.com')).when).toBe('next visit to github.com');
    expect(VexQuickReminder.create).toHaveBeenLastCalledWith('Check PRs', { site: 'github.com' }, undefined);
    delete globalThis.VexQuickReminder;
  });

  it('puts tabs into a new group, and refuses ids that do not exist', () => {
    globalThis.VexStorage = { saveGroups: vi.fn() };
    globalThis.TabManager = { tabs: [{ id: 't1' }, { id: 't2' }], groups: [], _setTabGroup: vi.fn(), rebuildAllTabs: vi.fn(), persistTabs: vi.fn(), _themeGroupPalette: () => [{ ref: 'var(--x)' }] };
    const made = AgentTools.groupTabs('Research', ['t1', 'ghost', 't2']);
    expect(made).toMatchObject({ name: 'Research', tabs: 2 });
    expect(TabManager.groups[0]).toMatchObject({ name: 'Research', color: 'var(--x)' });
    expect(TabManager._setTabGroup.mock.calls.map(c => c[0])).toEqual(['t1', 't2']);
    expect(() => AgentTools.groupTabs('X', ['ghost'])).toThrow(/list_tabs gives the ids/);
    expect(() => AgentTools.groupTabs('  ', ['t1'])).toThrow(/needs a name/);
    delete globalThis.TabManager; delete globalThis.VexStorage;
  });
});
