// @vitest-environment jsdom
//
// Search suggestions. The engine sees what you are typing before you press go,
// so most of what matters here is when they must NOT happen: a private tab, a
// setting that is off, something that is already an address. The parsing matters
// too, because no two engines answer in the same shape.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
let activeTab = null;
window.VexTabStore = { active: () => activeTab };

let lastUrl = '';
let reply = { ok: true, status: 200, body: '["hey",["hey arnold","hey jude"]]' };
window.VexBridge = {
  fetchText: vi.fn(async url => { lastUrl = url; return reply; })
};

const { VexSearch } = require('../../mobile/www/js/search.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  activeTab = { id: 't', url: 'https://example.com/', incognito: false };
  reply = { ok: true, status: 200, body: '["hey",["hey arnold","hey jude"]]' };
  lastUrl = '';
  window.VexBridge.fetchText.mockClear();
  VexSearch.forgetSuggestions();
});

describe('when they happen', () => {
  it('asks the engine for a plain query', async () => {
    expect(await VexSearch.remoteSuggest('hey')).toEqual(['hey arnold', 'hey jude']);
    expect(lastUrl).toContain('duckduckgo.com/ac/');
    expect(lastUrl).toContain('q=hey');
  });

  it('uses the engine you chose', async () => {
    await VexStore.set('vex.searchEngine', 'google');
    await VexSearch.remoteSuggest('hey');
    expect(lastUrl).toContain('suggestqueries.google.com');
  });

  it('remembers an answer rather than asking twice', async () => {
    await VexSearch.remoteSuggest('hey');
    await VexSearch.remoteSuggest('hey');
    expect(window.VexBridge.fetchText).toHaveBeenCalledTimes(1);
  });
});

describe('when they must not happen', () => {
  it('never in a private tab', async () => {
    activeTab = { id: 't', url: 'https://example.com/', incognito: true };
    expect(await VexSearch.remoteSuggest('hey')).toEqual([]);
    expect(window.VexBridge.fetchText).not.toHaveBeenCalled();
  });

  it('not when the setting is off', async () => {
    await VexStore.set('vex.searchSuggestions', false);
    expect(await VexSearch.remoteSuggest('hey')).toEqual([]);
    expect(window.VexBridge.fetchText).not.toHaveBeenCalled();
  });

  it('not for something that is already an address', async () => {
    expect(await VexSearch.remoteSuggest('news.ycombinator.com')).toEqual([]);
    expect(await VexSearch.remoteSuggest('https://example.com/x')).toEqual([]);
    expect(window.VexBridge.fetchText).not.toHaveBeenCalled();
  });

  it('not for one letter, and not for an essay', async () => {
    expect(await VexSearch.remoteSuggest('h')).toEqual([]);
    expect(await VexSearch.remoteSuggest('x'.repeat(200))).toEqual([]);
  });

  it('not for something with a password in it', async () => {
    expect(await VexSearch.remoteSuggest('my password: hunter2')).toEqual([]);
    expect(window.VexBridge.fetchText).not.toHaveBeenCalled();
  });
});

describe('the shapes engines answer in', () => {
  it('reads the OpenSearch pair', async () => {
    reply = { ok: true, status: 200, body: '["hey",["one","two"]]' };
    expect(await VexSearch.remoteSuggest('hey')).toEqual(['one', 'two']);
  });

  it('reads an object with a suggestions list', async () => {
    reply = { ok: true, status: 200, body: '{"query":"hey","suggestions":["one","two"]}' };
    expect(await VexSearch.remoteSuggest('hey')).toEqual(['one', 'two']);
  });

  it('reads a list of phrase objects', async () => {
    reply = { ok: true, status: 200, body: '[{"phrase":"one"},{"phrase":"two"}]' };
    expect(await VexSearch.remoteSuggest('hey')).toEqual(['one', 'two']);
  });

  it('treats nonsense as no suggestions rather than an error', async () => {
    reply = { ok: true, status: 200, body: '<html>nope</html>' };
    expect(await VexSearch.remoteSuggest('hey')).toEqual([]);
  });

  it('treats a failed request the same way', async () => {
    reply = { ok: false, status: 503, body: '' };
    expect(await VexSearch.remoteSuggest('hey')).toEqual([]);
  });
});

describe('completing an address as you type (the desktop’s v19 address bar)', () => {
  const day = 86400000;
  const visits = rows => { window.VexHistory = { recent: () => rows }; };

  it('completes the site you use most whose name starts with what you typed', () => {
    const now = Date.now();
    visits([
      { url: 'https://github.blog/post', at: now - day },
      { url: 'https://github.com/a', at: now - 2 * day },
      { url: 'https://github.com/b', at: now - 3 * day },
      { url: 'https://www.github.com/c', at: now - 4 * day }
    ]);
    expect(VexSearch.completion('gith')).toEqual({ text: 'github.com', url: 'https://github.com/' });
    expect(VexSearch.completion('Gith').text).toBe('Github.com');
    expect(VexSearch.completion('github.b')).toEqual({ text: 'github.blog', url: 'https://github.blog/' });
  });

  it('a site visited often long ago loses to one visited this week', () => {
    const now = Date.now();
    visits([
      { url: 'https://news.example/', at: now - day },
      { url: 'https://news.example/2', at: now - 2 * day },
      ...Array.from({ length: 6 }, (_, i) => ({ url: 'https://newsold.example/' + i, at: now - 120 * day }))
    ]);
    expect(VexSearch.completion('new').text).toBe('news.example');
  });

  it('completes a path you have been to, and never a sentence or something already whole', () => {
    visits([{ url: 'https://github.com/0xmortuex/vex', at: Date.now() }]);
    expect(VexSearch.completion('github.com/0x').text).toBe('github.com/0xmortuex/vex');
    expect(VexSearch.completion('gith hub')).toBe(null);
    expect(VexSearch.completion('github.com')).toBe(null);
    expect(VexSearch.completion('')).toBe(null);
  });

  it('ranks matching history by how often and how recently, sites that start with it first', () => {
    const now = Date.now();
    visits([
      { url: 'https://blog.example/github-tips', title: 'Github tips', at: now - 1000 },
      { url: 'https://github.com/x', title: 'x', at: now - 5 * day },
      { url: 'https://github.com/x', title: 'x', at: now - 6 * day },
      { url: 'https://github.com/y', title: 'y', at: now - 7 * day }
    ]);
    const urls = VexSearch.suggest('github').filter(row => row.kind === 'history').map(row => row.url);
    expect(urls).toEqual(['https://github.com/x', 'https://github.com/y', 'https://blog.example/github-tips']);
  });
});
