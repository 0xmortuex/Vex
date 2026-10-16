// @vitest-environment jsdom
//
// js/scroll-memory.js (T3-003): a page is put back where it was read, once, on the
// page it was taken on, never over what the person already scrolled, never from a
// private tab.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexScrollMemory, vexScrollSample, vexScrollRestore } = require('../../src/renderer/js/scroll-memory.js');

const URL1 = 'https://news.example/article/1';
const setScrollY = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

function install(tabOver = {}) {
  const wv = { isConnected: true };
  const tab = { id: 'a', url: URL1, scrollPosition: null, ...tabOver };
  globalThis.TabManager = { tabs: [tab], activeTabId: 'a', persistTabs: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['a', wv]]) };
  window.VexTabPolicy = { canReadWebview: vi.fn(() => true) };
  return { wv, tab };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  setScrollY(0);
  VexScrollMemory._handled = new WeakSet();
  window.vexGuestEval = vi.fn(async () => 'offset');
});

describe('keeping the position', () => {
  it('stores x, y, the address and the text at the top, and writes the session only for a real move', () => {
    const { tab } = install();
    expect(VexScrollMemory.note(tab, { x: 0, y: 900, anchor: 'The second paragraph', off: 14 })).toBe(true);
    expect(tab.scrollPosition).toEqual({ x: 0, y: 900, url: URL1, anchor: 'The second paragraph', off: 14 });
    // 20 px further on the same paragraph: not worth a write.
    expect(VexScrollMemory.note(tab, { x: 0, y: 920, anchor: 'The second paragraph', off: 34 })).toBe(false);
    expect(tab.scrollPosition.y).toBe(900);
    // A new paragraph is.
    expect(VexScrollMemory.note(tab, { x: 0, y: 960, anchor: 'Another paragraph here', off: 3 })).toBe(true);
  });

  it('forgets the position when the page is back at the top', () => {
    const { tab } = install({ scrollPosition: { x: 0, y: 500, url: URL1, anchor: '', off: 0 } });
    expect(VexScrollMemory.note(tab, { x: 0, y: 0, anchor: '', off: 0 })).toBe(true);
    expect(tab.scrollPosition).toBe(null);
    expect(VexScrollMemory.note(tab, { x: 0, y: 0, anchor: '', off: 0 })).toBe(false);
  });

  it('refuses a reading that is not numbers', () => {
    const { tab } = install();
    expect(VexScrollMemory.note(tab, { x: 'a', y: 5 })).toBe(false);
    expect(VexScrollMemory.note(tab, null)).toBe(false);
  });
});

describe('putting it back', () => {
  it('runs the restore script once, on the first settled page, with the saved place', async () => {
    const { tab } = install({ scrollPosition: { x: 0, y: 900, url: URL1, anchor: 'Hello there world', off: 10 } });
    expect(await VexScrollMemory.restoreOnce('a')).toBe('offset');
    const code = window.vexGuestEval.mock.calls[0][1];
    expect(code).toContain('vexScrollRestore');
    expect(code).toContain('"anchor":"Hello there world"');
    expect(code).toContain('"y":900');
    // A second page load in the same tab is left alone.
    expect(await VexScrollMemory.restoreOnce('a')).toBe(null);
    expect(window.vexGuestEval).toHaveBeenCalledTimes(1);
    expect(tab.scrollPosition.y).toBe(900);
  });

  it('does nothing for a position taken on another address, or one a sleep left (no address)', async () => {
    install({ scrollPosition: { x: 0, y: 900, url: 'https://news.example/article/2', anchor: '', off: 0 } });
    expect(await VexScrollMemory.restoreOnce('a')).toBe(null);
    VexScrollMemory._handled = new WeakSet();
    install({ scrollPosition: { x: 0, y: 900 } });
    expect(await VexScrollMemory.restoreOnce('a')).toBe(null);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('ignores a #fragment, but not a different query', () => {
    expect(VexScrollMemory._samePage(URL1, URL1 + '#part-2')).toBe(true);
    expect(VexScrollMemory._samePage(URL1 + '?page=2', URL1 + '?page=3')).toBe(false);
  });

  it('never reads a private or Tor tab', async () => {
    const { wv } = install({ scrollPosition: { x: 0, y: 900, url: URL1, anchor: '', off: 0 } });
    window.VexTabPolicy.canReadWebview.mockReturnValue(false);
    expect(await VexScrollMemory.restoreOnce('a')).toBe(null);
    expect(await VexScrollMemory.read('a')).toBe(null);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(wv.isConnected).toBe(true);
  });

  it('says so when the page does not answer, instead of swallowing it', async () => {
    install({ scrollPosition: { x: 0, y: 900, url: URL1, anchor: '', off: 0 } });
    window.VexProblems = { note: vi.fn() };
    window.vexGuestEval = vi.fn(async () => { throw new Error('The page did not answer'); });
    expect(await VexScrollMemory.restoreOnce('a')).toBe(null);
    expect(window.VexProblems.note).toHaveBeenCalledWith('Scroll memory', expect.any(String), expect.any(Error));
    delete window.VexProblems;
  });
});

describe('sampling', () => {
  it('reads the tab in front once it has settled and saves the session', async () => {
    const { tab } = install();
    await VexScrollMemory.restoreOnce('a');                         // settled: nothing saved to restore
    window.vexGuestEval = vi.fn(async () => ({ x: 0, y: 1200, h: 9000, vh: 800, anchor: 'Some paragraph text', off: 5 }));
    expect(await VexScrollMemory.sample('a')).toBe(true);
    expect(tab.scrollPosition).toMatchObject({ y: 1200, url: URL1, anchor: 'Some paragraph text' });
    expect(TabManager.persistTabs).toHaveBeenCalledTimes(1);
  });

  it('does not read a page that has not settled yet (it would overwrite the saved place with the top)', async () => {
    install({ scrollPosition: { x: 0, y: 900, url: URL1, anchor: '', off: 0 } });
    expect(await VexScrollMemory.sample('a')).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(TabManager.tabs[0].scrollPosition.y).toBe(900);
  });
});

describe('inside the page', () => {
  function para(text, top) {
    const p = document.createElement('p');
    p.textContent = text;
    p.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20 });
    document.body.appendChild(p);
    return p;
  }

  it('the sample names the paragraph at the top of the view and how far past it', () => {
    setScrollY(1400);
    const p = para('It was the best of times, it was the worst of times.', -37);
    document.elementFromPoint = () => p;
    const s = vexScrollSample();
    expect(s.y).toBe(1400);
    expect(s.anchor).toBe('It was the best of times, it was the worst of times.');
    expect(s.off).toBe(37);
  });

  it('reports no anchor at the top of the page', () => {
    para('Whatever text this is here.', 10);
    document.elementFromPoint = () => document.body;
    expect(vexScrollSample().anchor).toBe('');
  });

  it('the restore goes to the paragraph with the same words, wherever the layout moved it', async () => {
    para('Something else entirely', 100);
    para('It was the best of times, it was the worst of times.', 640);
    window.scrollTo = vi.fn();
    const r = await vexScrollRestore({ x: 0, y: 5000, anchor: 'It was the best of times, it was the worst of times.', off: 37 });
    expect(r).toBe('anchor');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 677);        // 0 + 640 + 37
  });

  it('the restore falls back to the pixel position when the page is tall enough', async () => {
    window.scrollTo = vi.fn();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
    expect(await vexScrollRestore({ x: 0, y: 2500, anchor: '', off: 0 })).toBe('offset');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 2500);
  });

  it('the restore leaves a page alone that the person has already scrolled', async () => {
    setScrollY(300);
    window.scrollTo = vi.fn();
    expect(await vexScrollRestore({ x: 0, y: 2500, anchor: '', off: 0 })).toBe('moved');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('the restore waits for a page that is still growing, then goes as far as it can', async () => {
    vi.useFakeTimers();
    try {
      window.scrollTo = vi.fn();
      Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1000, configurable: true });
      const pending = vexScrollRestore({ x: 0, y: 99999, anchor: '', off: 0 });
      await vi.advanceTimersByTimeAsync(500 * 14);
      expect(await pending).toBe('short');
      expect(window.scrollTo).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
