// @vitest-environment jsdom
//
// The as-you-type place list under the weather location box (js/geo-search.js attachSuggest),
// shared by the setup wizard, Settings and the start page.
//
// What matters and is pinned here:
//   * names are suggested after a short pause, not on every key, and never for 0-1 characters;
//   * a postcode makes NO request while typing (OpenStreetMap's Nominatim forbids autocomplete),
//     the person is told to press Enter or Search instead;
//   * a place name is shown as text, never as markup;
//   * keyboard and mouse both work and Escape closes only the list;
//   * an answer to an older keystroke never replaces the answer to a newer one;
//   * a failed lookup says so instead of showing an empty list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexGeo } = require('../../src/renderer/js/geo-search.js');

const place = (name, over) => Object.assign({
  name, latitude: 41, longitude: 29, country: 'Türkiye', country_code: 'TR', admin1: 'Istanbul',
}, over);

let input;
let handle;
let picked;
let status;
let lang = 'en';

const type = (text) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (k) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
};
const settle = async () => { await vi.advanceTimersByTimeAsync(VexGeo.SUGGEST_DELAY_MS + 5); };
const list = () => document.querySelector('.vex-geo-suggest');
const rows = () => [...document.querySelectorAll('.vex-geo-suggest [role=option]')];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<input id="city" type="text">';
  input = document.getElementById('city');
  picked = [];
  status = [];
  lang = 'en';
  VexGeo._suggestCache.clear();
  handle = VexGeo.attachSuggest(input, {
    getCountry: () => 'TR',
    getLang: () => lang,
    onPick: (hit) => picked.push(hit),
    onStatus: (t) => status.push(t),
  });
  input.focus();    // the list only appears for the box the person is in
});

afterEach(() => {
  handle.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('when suggestions are asked for', () => {
  it('waits for a pause, then asks once with the country and language it was given', async () => {
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ataşehir')], elsewhere: 0 });
    type('At'); type('Ata'); type('Atas');
    expect(search).not.toHaveBeenCalled();
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Atas', { country: 'TR', lang: 'en' });
    expect(rows()).toHaveLength(1);
    expect(list().hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('does nothing for fewer than two characters', async () => {
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('X')], elsewhere: 0 });
    type('A');
    await settle();
    expect(search).not.toHaveBeenCalled();
    expect(list().hidden).toBe(true);
  });

  it('makes no request for a postcode and says what to press', async () => {
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [], elsewhere: 0 });
    type('34750');
    await settle();
    expect(search).not.toHaveBeenCalled();
    expect(list().hidden).toBe(true);
    expect(status.at(-1)).toMatch(/Enter or Search/);
  });

  it('asks again once for the same words (cached), but again for another country', async () => {
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Manchester')], elsewhere: 0 });
    type('Manc'); await settle();
    type('Manc'); await settle();
    expect(search).toHaveBeenCalledTimes(1);
    handle.destroy();
    handle = VexGeo.attachSuggest(input, { getCountry: () => 'GB', getLang: () => 'tr', onPick: () => {} });
    type('Manc'); await settle();
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('what is shown', () => {
  it('shows at most eight places and drops repeats of the same label', async () => {
    const hits = [];
    for (let i = 0; i < 12; i++) hits.push(place('Springfield', { admin1: 'State ' + i }));
    hits.splice(2, 0, place('Springfield', { admin1: 'State 0' }));   // a repeat of the first
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits, elsewhere: 0 });
    type('Spring'); await settle();
    expect(rows()).toHaveLength(VexGeo.SUGGEST_MAX);
    const labels = rows().map((r) => r.textContent);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('writes a place name as text, never as markup', async () => {
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('<img src=x onerror="window.__pwned=1">')], elsewhere: 0 });
    type('Evil'); await settle();
    expect(list().querySelector('img')).toBeNull();
    expect(rows()[0].textContent).toContain('<img');
    expect(window.__pwned).toBeUndefined();
  });

  it('says so when the lookup fails, instead of showing nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(VexGeo, 'search').mockRejectedValue(new Error('no connection'));
    type('Ankara'); await settle();
    const note = list().querySelector('[role=alert]');
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/not available.*Search/);
    expect(warn).toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it('ignores the answer to an older keystroke', async () => {
    let first;
    const search = vi.spyOn(VexGeo, 'search')
      .mockImplementationOnce(() => new Promise((res) => { first = res; }))
      .mockResolvedValueOnce({ hits: [place('Izmir')], elsewhere: 0 });
    type('Iz'); await settle();            // request 1 is waiting
    type('Izm'); await settle();           // request 2 answers at once
    expect(rows().map((r) => r.textContent)[0]).toContain('Izmir');
    first({ hits: [place('Wrong Old Answer')], elsewhere: 0 });
    await vi.advanceTimersByTimeAsync(5);
    expect(rows().map((r) => r.textContent).join('|')).not.toContain('Wrong Old Answer');
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('picking', () => {
  beforeEach(async () => {
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ataşehir'), place('Ataköy')], elsewhere: 0 });
    type('Ata'); await settle();
  });

  it('moves with the arrow keys, wraps round, and Enter picks the marked place', () => {
    key('ArrowDown');
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(rows()[0].id);
    key('ArrowDown');
    key('ArrowDown');                                   // wraps back to the first
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');                                     // and backwards to the last
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(picked).toHaveLength(1);
    expect(picked[0].name).toBe('Ataköy');
    expect(input.value).toBe('Ataköy');
    expect(list().hidden).toBe(true);
  });

  it('leaves Enter alone when nothing is marked, so the Search it belongs to still runs, and closes the list', () => {
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(picked).toHaveLength(0);
    expect(list().hidden).toBe(true);
  });

  it('picks with a click, and a click does not take the focus out of the box', () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    rows()[0].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    rows()[0].click();
    expect(picked[0].name).toBe('Ataşehir');
  });

  it('Escape closes only the list; the next Escape reaches whatever is behind', () => {
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    const first = key('Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(list().hidden).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    key('Escape');
    expect(behind).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', behind);
  });
});

describe('the person leaving the box', () => {
  it('shows no list for an answer that arrives after the focus has moved on', async () => {
    let answer;
    vi.spyOn(VexGeo, 'search').mockImplementation(() => new Promise((res) => { answer = res; }));
    type('Ankara'); await settle();               // asked, waiting
    document.body.insertAdjacentHTML('beforeend', '<button id="go">Search</button>');
    document.getElementById('go').focus();        // pressed Search
    answer({ hits: [place('Ankara')], elsewhere: 0 });
    await vi.advanceTimersByTimeAsync(5);
    expect(list().hidden).toBe(true);
  });

  it('Enter with nothing marked drops a suggestion that was still on its way', async () => {
    let answer;
    vi.spyOn(VexGeo, 'search').mockImplementation(() => new Promise((res) => { answer = res; }));
    type('Ankara'); await settle();
    key('Enter');
    answer({ hits: [place('Ankara')], elsewhere: 0 });
    await vi.advanceTimersByTimeAsync(5);
    expect(list().hidden).toBe(true);
  });

  it('shows the suggestions again when the box gets the focus back (after a country was chosen)', async () => {
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ankara')], elsewhere: 0 });
    type('Ank'); await settle();
    input.blur();
    expect(list().hidden).toBe(true);
    input.focus();
    await settle();
    expect(list().hidden).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);      // from the cache, no second request
  });
});

describe('for screen readers and the Turkish app', () => {
  const liveText = () => document.querySelector('.vex-geo-live').textContent;

  it('announces how many places were found, and clears it when the list closes', async () => {
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ataşehir'), place('Ataköy'), place('Atakent')], elsewhere: 0 });
    type('Ata'); await settle();
    const region = document.querySelector('.vex-geo-live');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(liveText()).toBe('3 places found');
    key('Escape');
    expect(liveText()).toBe('');
  });

  it('says one place, not "1 places"', async () => {
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ataşehir')], elsewhere: 0 });
    type('Ata'); await settle();
    expect(liveText()).toBe('One place found');
  });

  it('speaks Turkish when given Turkish: the count, the postcode hint and the failure row', async () => {
    lang = 'tr';
    const search = vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Ataşehir'), place('Ataköy')], elsewhere: 0 });
    type('Ata'); await settle();
    expect(liveText()).toBe('2 yer bulundu');
    type('34750'); await settle();
    expect(status.at(-1)).toBe('Bu posta kodunu aramak için Enter’a veya Ara’ya basın.');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    search.mockRejectedValue(new Error('offline'));
    type('Ankara'); await settle();
    expect(list().querySelector('[role=alert]').textContent).toBe('Öneriler alınamıyor. Yeniden denemek için Ara’ya basın.');
  });

  it('every phrase it can say has a Turkish line, and the app dictionary has the same ones', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    for (const [en, tr] of Object.entries(VexGeo.SUGGEST_TR)) {
      expect(tr, en).toBeTruthy();
      const key = en.replace('{n}', '{1}');
      expect(VexI18nUI.TABLE.tr[key], key).toBe(tr.replace('{n}', '{1}'));
    }
  });
});

describe('the layer register of the app window', () => {
  afterEach(() => { delete globalThis.VexLayer; });

  it('is in the register while open (menu tier, own z-index kept) and out of it when closed or destroyed', async () => {
    const layers = new Set();
    globalThis.VexLayer = {
      track: vi.fn((el, o) => { layers.add(el); expect(o.tier).toBe('menu'); expect(typeof o.close).toBe('function'); return el; }),
      close: vi.fn((el) => { if (!layers.has(el)) return false; layers.delete(el); [...document.querySelectorAll('.vex-geo-suggest')].find((n) => n === el).hidden = true; return true; }),
    };
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Bursa')], elsewhere: 0 });
    type('Bur'); await settle();
    expect(VexLayer.track).toHaveBeenCalledWith(list(), expect.objectContaining({ tier: 'menu' }));
    expect(layers.has(list())).toBe(true);
    expect(list().style.zIndex).toBe('');            // the stylesheet's z-index stays: it sits above the setup wizard
    key('Escape');
    expect(layers.has(list())).toBe(false);
    expect(list().hidden).toBe(true);
    type('Burs'); await settle();
    expect(layers.has(list())).toBe(true);
    handle.destroy();
    expect(layers.size).toBe(0);
  });

  it('works where there is no register (the start page)', async () => {
    expect(typeof VexLayer).toBe('undefined');
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Bursa')], elsewhere: 0 });
    type('Bur'); await settle();
    expect(list().hidden).toBe(false);
    key('Escape');
    expect(list().hidden).toBe(true);
  });
});

describe('cleaning up', () => {
  it('destroy removes the list and the accessibility attributes', async () => {
    vi.spyOn(VexGeo, 'search').mockResolvedValue({ hits: [place('Bursa')], elsewhere: 0 });
    type('Bur'); await settle();
    expect(list()).not.toBeNull();
    handle.destroy();
    expect(list()).toBeNull();
    expect(document.querySelector('.vex-geo-live')).toBeNull();
    expect(input.hasAttribute('role')).toBe(false);
    expect(input.hasAttribute('aria-controls')).toBe(false);
    type('Burs');
    await settle();
    expect(list()).toBeNull();
  });

  it('wants an input and an onPick', () => {
    expect(() => VexGeo.attachSuggest(null, { onPick() {} })).toThrow(TypeError);
    expect(() => VexGeo.attachSuggest(input, {})).toThrow(TypeError);
  });
});
