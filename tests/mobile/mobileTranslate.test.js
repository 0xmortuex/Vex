// @vitest-environment jsdom
//
// Translating a page on the device. The loop is: collect the page's text nodes,
// identify the language, make sure the pair of models is here, send the text out
// in chunks and write each chunk back where it came from. What is worth pinning
// down is every way it declines — because each one is a sentence someone reads,
// not an exception — and that "show the original" really does.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = { 'vex.translateWifiOnly': true };
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};

// A stand-in page: the text nodes the collect script would have found, and the
// writes the apply script would have made.
let page = ['Guten Tag', 'Dies ist ein Absatz mit genug Text um die Sprache zu erkennen.', 'Noch einer'];
let written = null;
let evaluated = [];

window.VexBridge = {
  evaluate: vi.fn(async (id, code) => {
    evaluated.push(code);
    if (code.includes('__vexTranslate = {')) return { result: JSON.stringify(page) };
    if (code.includes('held.original[index]')) { written = 'restored'; return { result: '"ok"' }; }
    // The apply script carries the chunk it is writing, as JSON.
    const found = code.match(/var next = (\[[\s\S]*?\]);/);
    if (found) {
      const next = JSON.parse(found[1]);
      const at = Number(code.match(/held\.nodes\[(\d+) \+ index\]/)[1]);
      written = written === 'restored' || written === null ? [] : written;
      for (let index = 0; index < next.length; index++) written[at + index] = next[index];
      return { result: '"ok"' };
    }
    return { result: null };
  }),
  translateLanguages: vi.fn(async () => ({
    languages: [{ language: 'en', label: 'English', downloaded: true },
      { language: 'de', label: 'German', downloaded: false }]
  })),
  translateIdentify: vi.fn(async () => 'de'),
  translateEnsureModel: vi.fn(async () => ({ ready: true })),
  translateTexts: vi.fn(async (from, to, texts) => texts.map(text => '<' + to + '>' + text)),
  translateDeleteModel: vi.fn(async () => ({ deleted: true }))
};

const { VexTranslate } = require('../../mobile/www/js/translate.js');

const tab = () => ({ id: 't1', url: 'https://zeit.de/article', title: 'Ein Artikel' });

beforeEach(() => {
  store['vex.translateWifiOnly'] = true;
  page = ['Guten Tag', 'Dies ist ein Absatz mit genug Text um die Sprache zu erkennen.', 'Noch einer'];
  written = null;
  evaluated = [];
  VexTranslate.forget();
  for (const fn of Object.values(window.VexBridge)) if (fn.mockClear) fn.mockClear();
  window.VexBridge.translateIdentify.mockResolvedValue('de');
  window.VexBridge.translateEnsureModel.mockResolvedValue({ ready: true });
});

describe('translating the page', () => {
  it('writes every piece of text back where it came from', async () => {
    const result = await VexTranslate.page(tab(), 'en');
    expect(result.ok).toBe(true);
    expect(result.from).toBe('de');
    expect(result.nodes).toBe(3);
    expect(written).toEqual(['<en>Guten Tag',
      '<en>Dies ist ein Absatz mit genug Text um die Sprache zu erkennen.',
      '<en>Noch einer']);
    expect(VexTranslate.showing('t1')).toBe(true);
  });

  it('identifies the language from the longer paragraphs, not the headings', async () => {
    await VexTranslate.page(tab(), 'en');
    const sample = window.VexBridge.translateIdentify.mock.calls[0][0];
    expect(sample).toContain('Dies ist ein Absatz');
    expect(sample.length).toBeLessThanOrEqual(1200);
  });

  it('asks for the pair of models before sending any text', async () => {
    await VexTranslate.page(tab(), 'en');
    expect(window.VexBridge.translateEnsureModel).toHaveBeenCalledWith('de', 'en', true);
    const order = window.VexBridge.translateEnsureModel.mock.invocationCallOrder[0];
    expect(order).toBeLessThan(window.VexBridge.translateTexts.mock.invocationCallOrder[0]);
  });

  it('sends the text in chunks rather than one enormous call', async () => {
    page = Array.from({ length: 95 }, (_, index) => 'Ein Satz mit genug Text, Nummer ' + index + '.');
    const result = await VexTranslate.page(tab(), 'en');
    expect(result.nodes).toBe(95);
    expect(window.VexBridge.translateTexts.mock.calls.length).toBeGreaterThan(1);
    for (const [, , texts] of window.VexBridge.translateTexts.mock.calls) {
      expect(texts.length).toBeLessThanOrEqual(40);
    }
  });

  it('leaves a string the model could not do rather than putting a hole in it', async () => {
    window.VexBridge.translateTexts.mockResolvedValueOnce(['<en>Guten Tag', '', '<en>Noch einer']);
    await VexTranslate.page(tab(), 'en');
    // The apply script is given the empty string; the page keeps the original.
    expect(written[1]).toBe('');
    const applied = evaluated.find(code => code.includes('var next = '));
    expect(applied).toContain('if (node && next[index]) node.nodeValue = next[index];');
  });

  it('puts the original back', async () => {
    await VexTranslate.page(tab(), 'en');
    expect(await VexTranslate.original(tab())).toBe(true);
    expect(written).toBe('restored');
    expect(VexTranslate.showing('t1')).toBe(false);
  });

  it('forgets the page when the tab navigates', async () => {
    await VexTranslate.page(tab(), 'en');
    VexTranslate.forget('t1');
    expect(VexTranslate.showing('t1')).toBe(false);
  });
});

describe('the ways it declines', () => {
  it('a page with nothing on it', async () => {
    page = [];
    const result = await VexTranslate.page(tab(), 'en');
    expect(result).toEqual({ ok: false, why: 'There is no text on this page to translate' });
    expect(window.VexBridge.translateTexts).not.toHaveBeenCalled();
  });

  it('a blank tab', async () => {
    const result = await VexTranslate.page({ id: 't1', url: 'about:blank' }, 'en');
    expect(result.why).toBe('Open a page first');
  });

  it('a language it cannot identify', async () => {
    window.VexBridge.translateIdentify.mockResolvedValue('');
    const result = await VexTranslate.page(tab(), 'en');
    expect(result.why).toContain('could not tell what language');
  });

  it('a page already in that language', async () => {
    const result = await VexTranslate.page(tab(), 'de');
    expect(result.why).toContain('already in that language');
    expect(window.VexBridge.translateEnsureModel).not.toHaveBeenCalled();
  });

  it('a model that is not here, on a mobile connection', async () => {
    window.VexBridge.translateEnsureModel.mockRejectedValue(new Error('no wifi'));
    const result = await VexTranslate.page(tab(), 'en');
    expect(result.why).toContain('Wi-Fi');
    expect(result.why).toContain('Settings');

    // With the Wi-Fi rule off, the reason is the library's own.
    store['vex.translateWifiOnly'] = false;
    const second = await VexTranslate.page(tab(), 'en');
    expect(second.why).toBe('no wifi');
    expect(window.VexBridge.translateEnsureModel).toHaveBeenLastCalledWith('de', 'en', false);
  });

  it('two at once', async () => {
    const first = VexTranslate.page(tab(), 'en');
    const second = await VexTranslate.page(tab(), 'en');
    expect(second.why).toContain('Still translating');
    await first;
  });
});

describe('the models on the phone', () => {
  it('lists them, with which are downloaded', async () => {
    const languages = await VexTranslate.languages();
    expect(languages.map(entry => entry.language)).toEqual(['en', 'de']);
    expect(languages[0].downloaded).toBe(true);
  });

  it('answers with an empty list rather than throwing when there is no plugin', async () => {
    window.VexBridge.translateLanguages.mockRejectedValueOnce(new Error('no plugin'));
    expect(await VexTranslate.languages()).toEqual([]);
  });

  it('deletes one', async () => {
    await VexTranslate.deleteModel('de');
    expect(window.VexBridge.translateDeleteModel).toHaveBeenCalledWith('de');
  });
});
