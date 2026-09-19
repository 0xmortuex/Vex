// @vitest-environment jsdom
//
// History indexing runs the AI model for every page you visit. It is off
// unless you turn it on — and profiles that had it on by default are
// switched off once, while a later "on" is kept.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh copy each time, as at startup (the migration runs on load).
function load() {
  const file = require.resolve('../../src/renderer/js/history-indexer.js');
  delete require.cache[file];
  delete window.HistoryIndexer;
  require(file);
  return window.HistoryIndexer;
}

beforeEach(() => localStorage.clear());

describe('history indexing', () => {
  it('is off on a new profile', () => {
    expect(load().isEnabled()).toBe(false);
  });

  it('a profile that had it on (the old default) is switched off once', () => {
    localStorage.setItem('vex.aiIndexingEnabled', 'true');
    expect(load().isEnabled()).toBe(false);
  });

  it('turned on again afterwards, it stays on', () => {
    const idx = load();
    idx.setEnabled(true);
    expect(load().isEnabled()).toBe(true);
  });

  it('while off, nothing is queued — so the model never loads for a page', () => {
    const idx = load();
    window.VexTabPolicy = { canReadWebview: () => true };
    globalThis.AIRouter = { callAI: vi.fn() };
    idx.queueForIndexing({ id: 'h1', url: 'https://example.com/' }, { _navigationGeneration: 1 });
    expect(idx.getStats().queued).toBe(0);
    expect(AIRouter.callAI).not.toHaveBeenCalled();
  });
});
