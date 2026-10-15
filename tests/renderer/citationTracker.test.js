// Citations tracker: opt-in, memory only, matches the paste event's own text.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  globalThis.window = { escapeHtml: (s) => String(s), showToast: vi.fn() };
});
const { CitationTracker: C } = require('../../src/renderer/js/citation-tracker.js');

describe('citation tracker', () => {
  it('is off until asked, and records nothing while off', () => {
    C.recent = [];
    expect(C.enabled()).toBe(false);
    expect(C.record({ text: 'a long enough quote', url: 'https://a.test', title: 'A' })).toBe(false);
    expect(C.recent).toHaveLength(0);
  });

  it('finds the source of a pasted quote, ignoring whitespace differences', () => {
    C.recent = [];
    C.setEnabled(true);
    C.record({ text: 'The quick  brown\nfox jumps', url: 'https://a.test/p', title: 'Fox' });
    expect(C.find('The quick brown fox jumps')).toMatchObject({ url: 'https://a.test/p' });
    expect(C.find('something else entirely')).toBeNull();
  });

  it('ignores copies from non-web pages and tiny copies', () => {
    C.recent = [];
    C.setEnabled(true);
    expect(C.record({ text: 'long enough text here', url: 'file:///c:/x.html' })).toBe(false);
    expect(C.record({ text: 'tiny', url: 'https://a.test' })).toBe(false);
  });

  it('turning it off forgets what was held', () => {
    C.setEnabled(true);
    C.record({ text: 'a long enough quote', url: 'https://a.test', title: 'A' });
    C.setEnabled(false);
    expect(C.recent).toEqual([]);
  });

  it('forgets an old copy', () => {
    C.recent = [];
    C.setEnabled(true);
    C.record({ text: 'an old enough quote', url: 'https://a.test', title: 'A' });
    expect(C.find('an old enough quote', Date.now() + C.MAX_AGE_MS + 1000)).toBeNull();
  });

  it('writes the link after the pasted text in the editor', () => {
    const ta = {
      value: 'intro the pasted quote', selectionEnd: 22,
      setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); },
      dispatchEvent: vi.fn(),
    };
    globalThis.Event = globalThis.Event || class {};
    expect(C._afterPaste(ta, 'the pasted quote', { url: 'https://a.test/p', title: 'Fox [page]' })).toBe(true);
    expect(ta.value).toBe('intro the pasted quote ([Fox page](https://a.test/p))');
    expect(ta.dispatchEvent).toHaveBeenCalled();
  });

  it('does nothing when the pasted text is not what sits before the caret', () => {
    const ta = { value: 'different', selectionEnd: 9, setRangeText: vi.fn(), dispatchEvent: vi.fn() };
    expect(C._afterPaste(ta, 'the pasted quote', { url: 'https://a.test', title: 'x' })).toBe(false);
    expect(ta.setRangeText).not.toHaveBeenCalled();
  });

  it('only acts on the note editor', () => {
    C.setEnabled(true);
    C.record({ text: 'a long enough quote', url: 'https://a.test', title: 'A' });
    const spy = vi.spyOn(globalThis, 'setTimeout');
    C.onPaste({ target: { id: 'some-other-box' }, clipboardData: { getData: () => 'a long enough quote' } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
