// @vitest-environment jsdom
//
// Unit coverage for the Release-1 reading modules:
//   - Annotations: URL-key normalization, add/remove/count over the local store
//   - Recall: enabled flag persistence + the "too thin to index" guard
// Both are pure-logic paths that don't need a real <webview>; the DOM-touching
// methods (applyTo/highlight/renderPanel) are exercised by the app at runtime.

import { describe, it, expect, beforeEach, vi } from 'vitest';
// annotations.js resolves window.CollectionStore, which index.html loads first.
import '../../src/renderer/js/collection-store.js';

const { Annotations } = require('../../src/renderer/js/annotations.js');
const { Recall } = require('../../src/renderer/js/recall.js');

beforeEach(() => {
  localStorage.clear();
  Annotations.store = {};
  // Minimal globals the modules reference.
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.TabManager = { tabs: [], getActiveTab: () => null };
  globalThis.window.showToast = vi.fn();
});

describe('Annotations store', () => {
  it('normalizes URLs to an origin+path key (drops trailing slash, hash, query)', () => {
    const a = Annotations._key('https://ex.com/post/');
    const b = Annotations._key('https://ex.com/post');
    expect(a).toBe(b);
    expect(a).toBe('https://ex.com/post');
  });

  it('counts highlights across pages and removes by id', async () => {
    Annotations.store = {
      'https://a.com/x': [{ id: 'h1', text: 'one', color: 'yellow', at: 1 }],
      'https://b.com/y': [{ id: 'h2', text: 'two', color: 'green', at: 2 }, { id: 'h3', text: 'three', color: 'pink', at: 3 }],
    };
    expect(Annotations.count()).toBe(3);
    expect(Annotations.forUrl('https://a.com/x/').length).toBe(1);

    await Annotations.remove('https://b.com/y', 'h2');
    expect(Annotations.count()).toBe(2);
    // Empties get pruned from the store entirely.
    await Annotations.remove('https://a.com/x', 'h1');
    expect(Annotations.store['https://a.com/x']).toBeUndefined();
  });

  it('persists to localStorage under vex.annotations', () => {
    Annotations.store = { 'https://c.com': [{ id: 'h', text: 't', color: 'blue', at: 1 }] };
    Annotations.save();
    const raw = JSON.parse(localStorage.getItem('vex.annotations'));
    expect(raw['https://c.com'][0].id).toBe('h');
  });
});

describe('Recall', () => {
  const page = (text, title) => ({ title: title || 'Extracted', text });

  it('defaults to enabled and round-trips the flag', () => {
    expect(Recall.enabled()).toBe(true);
    Recall.setEnabled(false);
    expect(Recall.enabled()).toBe(false);
    expect(localStorage.getItem('vex.recall.enabled')).toBe('false');
  });

  it('skips indexing when disabled or when there is no bridge', async () => {
    Recall.setEnabled(false);
    globalThis.window.vex = { recallIndex: vi.fn() };
    await Recall.indexPage({ executeJavaScript: async () => page('x'.repeat(500)) }, 'https://ex.com', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('does not index a page too thin to be worth recalling', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn() };
    const wv = { getURL: () => 'https://ex.com/a', executeJavaScript: async () => page('too short') };
    await Recall.indexPage(wv, 'https://ex.com/a', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('indexes a substantial page through the bridge, preferring the live title', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn(async () => ({ ok: true })) };
    const wv = { getURL: () => 'https://ex.com/a', executeJavaScript: async () => page('word '.repeat(100), 'Live title') };
    await Recall.indexPage(wv, 'https://ex.com/a', 'Tab title');
    expect(globalThis.window.vex.recallIndex).toHaveBeenCalledOnce();
    const arg = globalThis.window.vex.recallIndex.mock.calls[0][0];
    expect(arg.url).toBe('https://ex.com/a');
    expect(arg.title).toBe('Live title');
    expect(arg.text.length).toBeGreaterThan(Recall.MIN_TEXT);
  });

  it('never indexes an ephemeral (private / Tor / identity) partition', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn() };
    for (const partition of ['tor-abc123', 'vexid-abc123', 'persist:container-work']) {
      const wv = {
        getURL: () => 'https://ex.com/a',
        getAttribute: (name) => (name === 'partition' ? partition : null),
        executeJavaScript: async () => page('word '.repeat(100)),
      };
      await Recall.indexPage(wv, 'https://ex.com/a', 'T');
    }
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('never indexes non-http pages', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn() };
    for (const url of ['file:///c:/secret.html', 'vex://start', 'about:blank', 'data:text/html,hi']) {
      await Recall.indexPage({ getURL: () => url, executeJavaScript: async () => page('word '.repeat(100)) }, url, 'T');
    }
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('drops the result when the tab navigated away mid-extraction', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn() };
    let current = 'https://ex.com/a';
    const wv = {
      getURL: () => current,
      executeJavaScript: async () => { current = 'https://ex.com/b'; return page('word '.repeat(100)); },
    };
    await Recall.indexPage(wv, 'https://ex.com/a', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('honours the per-site exclusion list, subdomains included', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    Recall.setExcluded(['bank.example']);
    expect(Recall.isExcluded('https://bank.example/accounts')).toBe(true);
    expect(Recall.isExcluded('https://secure.bank.example/x')).toBe(true);
    expect(Recall.isExcluded('https://notbank.example/x')).toBe(false);
    globalThis.window.vex = { recallIndex: vi.fn(), recallForget: vi.fn(async () => ({ removed: 3 })) };
    const wv = { getURL: () => 'https://bank.example/a', executeJavaScript: async () => page('word '.repeat(100)) };
    await Recall.indexPage(wv, 'https://bank.example/a', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
    // Excluding a host also purges what is already remembered about it.
    Recall.unexcludeHost('bank.example');
    expect(Recall.excluded()).toEqual([]);
    expect(await Recall.excludeHost('www.Other.Example')).toBe(3);
    expect(globalThis.window.vex.recallForget).toHaveBeenCalledWith({ host: 'other.example' });
    expect(Recall.excluded()).toContain('other.example');
  });

  it('turns engine snippet pairs into escaped HTML with <mark>', () => {
    globalThis.window.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = Recall.snippetHtml([['a & ', false], ['<b>', true], [' z', false]]);
    expect(html).toBe('a &amp; <mark>&lt;b&gt;</mark> z');
    expect(Recall.snippetHtml([])).toBe('');
  });
});
