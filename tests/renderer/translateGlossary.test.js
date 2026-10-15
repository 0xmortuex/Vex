// Translation glossary: terms are swapped for placeholders before the
// translator and put back after; a mangled placeholder never reaches the page.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  globalThis.window = { escapeHtml: (s) => String(s), showToast: vi.fn(), vex: { translateText: vi.fn(async (t) => t.toUpperCase()) } };
});
const { GlossaryTranslate: G } = require('../../src/renderer/js/translate-glossary.js');

describe('terms', () => {
  it('adds, replaces and removes a term per host', () => {
    G.addTerm('a.test', 'Bridge', '');
    G.addTerm('a.test', 'bridge', 'Köprü');
    expect(G.list('a.test')).toEqual([{ term: 'bridge', to: 'Köprü' }]);
    expect(G.removeTerm('a.test', 'BRIDGE')).toBe(true);
    expect(G.list('a.test')).toEqual([]);
  });

  it('site terms win over all-sites terms', () => {
    G.addTerm('*', 'Vex', '');
    G.addTerm('a.test', 'vex', 'VEX!');
    const t = G.termsFor('a.test');
    expect(t).toHaveLength(1);
    expect(t[0].to).toBe('VEX!');
    expect(G.termsFor('b.test')[0].term).toBe('Vex');
  });

  it('refuses a term with nothing open', () => {
    expect(() => G.addTerm('', 'x')).toThrow(/web page/);
    expect(() => G.addTerm('a.test', '   ')).toThrow(/term first/);
  });
});

describe('protecting', () => {
  it('swaps whole-word terms only, longest first', () => {
    const p = G.protect('New York City and New Yorker and New York', [{ term: 'New York', to: '' }, { term: 'New York City', to: '' }]);
    expect(p.found).toEqual(['New York City', 'New York']);
    expect(p.text).toContain('New Yorker');
  });

  it('puts the terms back, and a chosen word wins', () => {
    const p = G.protect('Use Bridge in Ollama', [{ term: 'Bridge', to: 'Köprü' }, { term: 'Ollama', to: '' }]);
    expect(G.restore(p.text, p.found)).toBe('Use Köprü in Ollama');
  });

  it('reports a lost placeholder as null', () => {
    const p = G.protect('Use Ollama', [{ term: 'Ollama', to: '' }]);
    expect(G.restore('USE', p.found)).toBeNull();
  });
});

describe('translate', () => {
  it('sends text without the term, and returns it with the term', async () => {
    G.addTerm('a.test', 'Ollama', '');
    const out = await G.translate('run Ollama now', 'tr', 'a.test');
    const sent = window.vex.translateText.mock.calls[0][0];
    expect(sent).not.toContain('Ollama');
    expect(out).toContain('Ollama');
  });

  it('with no terms, sends the text untouched', async () => {
    await G.translate('hello world', 'tr', 'none.test');
    expect(window.vex.translateText).toHaveBeenCalledWith('hello world', 'tr');
  });

  it('a mangled placeholder is not translated again: the paragraph is marked, and counted', async () => {
    G.stats.unprotected = 0;
    G.addTerm('a.test', 'Ollama', '');
    window.vex.translateText = vi.fn(async (t) => (t.includes('ZXQ') ? 'garbled' : 'clean ' + t));
    const out = await G.translate('run Ollama now', 'tr', 'a.test');
    // one request only: the term was never sent in the clear
    expect(window.vex.translateText).toHaveBeenCalledTimes(1);
    expect(window.vex.translateText.mock.calls[0][0]).not.toContain('Ollama');
    expect(out.startsWith(G.NOT_APPLIED)).toBe(true);
    expect(G.stats.unprotected).toBe(1);
  });

  it('keeps the terms that did survive and drops the broken token', async () => {
    G.stats.unprotected = 0;
    G.addTerm('a.test', 'Ollama', '');
    G.addTerm('a.test', 'Vex', '');
    window.vex.translateText = vi.fn(async (t) => t.replace(/ZXQ1QXZ/g, 'broken'));
    const out = await G.translate('Ollama and Vex', 'tr', 'a.test');
    expect(out).toContain('Ollama');
    expect(out).not.toMatch(/ZXQ|QXZ/);
    expect(out.startsWith(G.NOT_APPLIED)).toBe(true);
  });
});
