// @vitest-environment jsdom
//
// Wave 5, extra things remembered in Recall, in the window: nothing is added or searched while it is off, a selection is
// only remembered from a tab that may be read, the Recall panel shows what was added by hand first with its type label,
// and the page index (recall.json, through window.vex.recallSearch) is asked exactly as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const tab = (url, partition) => ({ __url: url, getAttribute: (name) => (name === 'partition' ? partition : null) });

let VexKept, X;
beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  fresh(JS + 'page-sensitivity.js');
  window.vexGuestUrl = (wv) => wv.__url;
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  globalThis.VexTr = require(JS + 'vex-tr.js').VexTr;
  window.VexExtrasCore = fresh(JS + 'evodata-extras-core.js');
  ({ VexKept } = fresh(JS + 'kept-common.js'));
  globalThis.VexKept = VexKept;
  ({ VexRecallExtras: X } = fresh(JS + 'recall-extras.js'));
  vi.spyOn(VexKept, 'call').mockResolvedValue({ ok: true });
});
afterEach(() => {
  for (const k of ['VexKept', 'VexTr', 'DownloadsPanel']) delete globalThis[k];
  delete window.vexPrompt; delete window.vexGuestEval; delete window.VexExtrasCore; delete window.VexRecallExtras; delete window.vex; delete window.VexProblems;
});

describe('while it is off (the default)', () => {
  it('is off, searches nothing and asks nobody', async () => {
    expect(X.enabled()).toBe(false);
    expect(await X.hits('anything')).toEqual([]);
    expect(X.selectionItems('some text', tab('https://example.com/a'))).toEqual([]);
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('refuses every way of adding', async () => {
    await expect(X.remember({ kind: 'note', text: 'x' })).rejects.toThrow(/switched off/);
    await expect(X.rememberSelection(tab('https://example.com/a'))).rejects.toThrow(/switched off/);
    await expect(X.rememberTyped('note')).rejects.toThrow(/switched off/);
    await expect(X.rememberDownload()).rejects.toThrow(/switched off/);
    expect(VexKept.call).not.toHaveBeenCalled();
  });
});

describe('remembering a selection', () => {
  beforeEach(() => { X.setEnabled(true); window.vexGuestEval = vi.fn().mockResolvedValue({ text: '  the picked sentence  ', title: 'A page' }); });

  it('sends the selected text with the title and the address of the page it came from', async () => {
    await X.rememberSelection(tab('https://example.com/article'));
    expect(VexKept.call).toHaveBeenCalledWith('extraAdd', { kind: 'clip', text: 'the picked sentence', title: 'A page', url: 'https://example.com/article' });
    expect(window.showToast).toHaveBeenCalledWith('Remembered. Recall search will find it.');
  });
  it('needs something selected', async () => {
    window.vexGuestEval.mockResolvedValue({ text: '   ', title: 'A page' });
    await expect(X.rememberSelection(tab('https://example.com/article'))).rejects.toThrow('Select some text on the page first');
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('never reads a private, Tor, routed or container tab, nor a bank or sign-in page', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    await expect(X.rememberSelection(tab('https://example.com/a'))).rejects.toThrow(/private, Tor, routed or container/);
    window.VexTabPolicy.isPrivateWindow = false;
    await expect(X.rememberSelection(tab('https://example.com/a', 'tor:identity1'))).rejects.toThrow(/private, Tor, routed or container/);
    await expect(X.rememberSelection(tab('https://www.paypal.com/'))).rejects.toThrow(/left alone/);
    await expect(X.rememberSelection(tab('https://example.com/login'))).rejects.toThrow(/left alone/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('offers "Remember this in Recall" in the page menu only for a selection on a tab that may be read', () => {
    const items = X.selectionItems('words', tab('https://example.com/a'));
    expect(items.map(i => i.label)).toEqual(['Remember this in Recall']);
    expect(X.selectionItems('', tab('https://example.com/a'))).toEqual([]);
    expect(X.selectionItems('words', tab('https://www.paypal.com/'))).toEqual([]);
    expect(X.selectionItems('words', tab('https://example.com/a', 'persist:container-work'))).toEqual([]);
    window.VexTabPolicy.isPrivateWindow = true;
    expect(X.selectionItems('words', tab('https://example.com/a'))).toEqual([]);
  });
});

describe('remembering typed words and a downloaded file name', () => {
  beforeEach(() => X.setEnabled(true));

  it('a note or a reminder is what the person types', async () => {
    window.vexPrompt = vi.fn().mockResolvedValue('buy a charger');
    await X.rememberTyped('reminder');
    expect(VexKept.call).toHaveBeenCalledWith('extraAdd', { kind: 'reminder', text: 'buy a charger' });
    await X.rememberTyped('note');
    expect(VexKept.call).toHaveBeenLastCalledWith('extraAdd', { kind: 'note', text: 'buy a charger' });
  });
  it('a cancelled or empty prompt remembers nothing', async () => {
    window.vexPrompt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('   ');
    await X.rememberTyped('note');
    await X.rememberTyped('note');
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('offers the newest finished downloads, not a running, private or unnamed one', () => {
    globalThis.DownloadsPanel = { downloads: [
      { filename: 'old.pdf', state: 'completed' }, { filename: 'running.zip', state: 'progressing' },
      { filename: 'private.png', state: 'completed', ephemeral: true }, { state: 'completed' }, { filename: 'new.txt', state: 'completed' },
    ] };
    expect(X.recentDownloads().map(d => d.filename)).toEqual(['new.txt', 'old.pdf']);
    expect(X.recentDownloads(1).map(d => d.filename)).toEqual(['new.txt']);
    delete globalThis.DownloadsPanel;
    expect(X.recentDownloads()).toEqual([]);
  });
  it('with no finished download there is nothing to pick', async () => {
    await expect(X.rememberDownload()).rejects.toThrow('There are no finished downloads to remember');
  });
});

describe('searching what was added', () => {
  beforeEach(() => {
    X.setEnabled(true);
    VexKept.call.mockResolvedValue({ ok: true, items: [
      { id: 'a', kind: 'clip', text: 'İstanbul ferry timetable', title: 'Ferries', url: 'https://example.com/f', at: 30 },
      { id: 'b', kind: 'file', text: 'invoice-2026-03.pdf', title: '', url: '', at: 20 },
    ] });
  });
  it('finds by every word, Turkish-aware, and labels the type', async () => {
    const hits = await X.hits('istanbul ferry');
    expect(hits.map(h => [h.extraId, h.label])).toEqual([['a', 'Clip']]);
    expect((await X.hits('invoice')).map(h => h.label)).toEqual(['Downloaded file']);
    expect(await X.hits('   ')).toEqual([]);
    expect(VexKept.call).toHaveBeenCalledWith('extraList');
  });
  it('only from a time on', async () => {
    expect((await X.hits('ferry', { since: 40 })).length).toBe(0);
    expect((await X.hits('ferry', { since: 10 })).length).toBe(1);
  });
  it('forgetting asks main to remove it', async () => {
    await X.forget('a');
    expect(VexKept.call).toHaveBeenCalledWith('extraRemove', 'a');
  });
});

describe('the Recall panel', () => {
  let Recall, container, searches;
  const pageHit = (i) => ({ url: 'https://a.example/' + i, title: 'Page ' + i, at: Date.now(), snippet: [['alpha page ' + i, false]], host: 'a.example', visits: 1 });
  const extraHit = () => window.VexExtrasCore.searchExtras([{ id: 'x1', kind: 'clip', text: 'alpha from a clip', title: '', url: '', at: Date.now() }], 'alpha')[0];
  const search = async (text) => {
    const input = container.querySelector('#recall-q');
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    window.escapeHtml = require(JS + 'vex-utils.js').escapeHtml;
    window.VexUI = require(JS + 'vex-utils.js').VexUI;
    globalThis.VexPlural = require(JS + 'vex-plural.js').VexPlural;
    searches = [];
    window.vex = {
      recallStats: async () => ({ pages: 1, bytes: 2048, newest: Date.now(), hosts: [] }),
      recallSearch: vi.fn(async (q, opts) => { searches.push(opts); return { total: 1, hits: [pageHit(1)], terms: ['alpha'], took: 1 }; }),
      recallForget: vi.fn(async () => ({ ok: true, removed: 1 })),
    };
    window.VexProblems = { note: vi.fn() };
    ({ Recall } = fresh(JS + 'recall.js'));
    container = document.createElement('div');
    document.body.append(container);
    Recall.renderPanel(container);
  });
  afterEach(() => { container.remove(); delete globalThis.VexPlural; });

  it('shows what was added by hand first, with its type, and then the pages', async () => {
    Recall.extraHits = vi.fn(async () => [extraHit()]);
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(2));
    const rows = [...container.querySelectorAll('.recall-hit')];
    expect(rows[0].dataset.extra).toBe('x1');
    expect(rows[0].querySelector('.recall-hit-visits').textContent).toBe('Clip');
    expect(rows[0].querySelector('img')).toBeNull();
    expect(rows[0].textContent).toContain('alpha from a clip');
    expect(rows[1].dataset.url).toBe('https://a.example/1');
    expect(rows[1].dataset.extra).toBeUndefined();
    expect(container.querySelector('.recall-count').textContent).toBe('2 matches');
    // the page index was asked exactly as before: this panel's own options, nothing about what was added by hand
    expect(searches[0].offset).toBe(0);
    expect(Recall.extraHits).toHaveBeenCalledWith('alpha', expect.objectContaining({ limit: 30 }));
  });
  it('is exactly the old panel when nothing was added (or the feature is off)', async () => {
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(1));
    expect(container.querySelector('[data-extra]')).toBeNull();
    expect(container.querySelector('.recall-count').textContent).toBe('1 match');
  });
  it('a failure searching what was added is reported and the pages still show', async () => {
    Recall.extraHits = vi.fn(async () => { throw new Error('the file could not be read'); });
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(1));
    expect(window.VexProblems.note).toHaveBeenCalledWith('Recall', 'Could not search what you added by hand', expect.any(Error));
  });
  it('"Show more" asks the page index for the next pages, not counting what was added', async () => {
    Recall.extraHits = vi.fn(async () => [extraHit()]);
    window.vex.recallSearch = vi.fn(async (q, opts) => { searches.push(opts); return { total: 60, hits: Array.from({ length: 30 }, (_, i) => pageHit(i)), terms: ['alpha'], took: 1 }; });
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelector('.recall-more')).toBeTruthy());
    expect(container.querySelector('.recall-count').textContent).toBe('Showing 31 of 61 matches');
    container.querySelector('.recall-more').click();
    await vi.waitFor(() => expect(searches.length).toBe(2));
    expect(searches[1].offset).toBe(30);
    expect(Recall.extraHits).toHaveBeenCalledTimes(1);
  });
  it('forgetting one removes it from its own file and leaves the page index alone', async () => {
    Recall.extraHits = vi.fn(async () => [extraHit()]);
    window.VexRecallExtras = { forget: vi.fn(async () => {}) };
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(2));
    container.querySelector('[data-extra] [data-act="forget"]').click();
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(1));
    expect(window.VexRecallExtras.forget).toHaveBeenCalledWith('x1');
    expect(window.vex.recallForget).not.toHaveBeenCalled();
  });
  it('copying one copies its text, not an address', async () => {
    Recall.extraHits = vi.fn(async () => [extraHit()]);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    await search('alpha');
    await vi.waitFor(() => expect(container.querySelectorAll('.recall-hit').length).toBe(2));
    container.querySelector('[data-extra] [data-act="copy"]').click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alpha from a clip'));
  });
});
