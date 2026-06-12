// @vitest-environment jsdom
//
// Unit coverage for the Release-1 reading modules:
//   - Annotations: URL-key normalization, add/remove/count over the local store
//   - Recall: enabled flag persistence + the "too thin to index" guard
// Both are pure-logic paths that don't need a real <webview>; the DOM-touching
// methods (applyTo/highlight/renderPanel) are exercised by the app at runtime.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  it('defaults to enabled and round-trips the flag', () => {
    expect(Recall.enabled()).toBe(true);
    Recall.setEnabled(false);
    expect(Recall.enabled()).toBe(false);
    expect(localStorage.getItem('vex.recall.enabled')).toBe('false');
  });

  it('skips indexing when disabled or when there is no bridge', async () => {
    Recall.setEnabled(false);
    globalThis.window.vex = { recallIndex: vi.fn() };
    await Recall.indexPage({ executeJavaScript: async () => 'x'.repeat(500) }, 'https://ex.com', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('does not index thin pages (<200 chars of text)', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn() };
    const wv = { executeJavaScript: async () => 'too short' };
    await Recall.indexPage(wv, 'https://ex.com/a', 'T');
    expect(globalThis.window.vex.recallIndex).not.toHaveBeenCalled();
  });

  it('indexes a substantial page through the bridge', async () => {
    Recall.setEnabled(true);
    globalThis.isStartPage = () => false;
    globalThis.window.vex = { recallIndex: vi.fn(async () => ({ ok: true })) };
    const wv = { executeJavaScript: async () => 'word '.repeat(100) };
    await Recall.indexPage(wv, 'https://ex.com/a', 'Title');
    expect(globalThis.window.vex.recallIndex).toHaveBeenCalledOnce();
    const arg = globalThis.window.vex.recallIndex.mock.calls[0][0];
    expect(arg.url).toBe('https://ex.com/a');
    expect(arg.title).toBe('Title');
  });
});
