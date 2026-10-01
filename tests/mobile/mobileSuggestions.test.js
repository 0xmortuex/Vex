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
