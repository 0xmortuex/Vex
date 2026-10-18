// @vitest-environment jsdom
//
// Weather places by postcode. With Türkiye selected, "34852" found nothing (Open-Meteo matches names only), and
// searching the neighbourhood name found a different Zümrütevler, in Bursa. A postcode is now looked up on its
// own, in the chosen country, at OpenStreetMap's Nominatim, and every coordinate is sanity-checked.
// The fixtures are real answers, captured 2026-10-18: Nominatim for postalcode=34852&country=tr, and
// Zippopotam.us for tr/34852, whose coordinates are wrong (a point near Çankırı) and must never be used.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexGeo } = require('../../src/renderer/js/geo-search.js');

const MALTEPE = {
  place_id: 378009357, osm_type: 'relation', lat: '40.9407685', lon: '29.1504298', category: 'boundary', type: 'postal_code',
  name: '34852', display_name: '34852, Zümrütevler Mahallesi, Maltepe, İstanbul, Marmara Bölgesi, Türkiye',
  address: { postcode: '34852', suburb: 'Zümrütevler Mahallesi', town: 'Maltepe', province: 'İstanbul', 'ISO3166-2-lvl4': 'TR-34', region: 'Marmara Bölgesi', country: 'Türkiye', country_code: 'tr' },
  boundingbox: ['40.9258822', '40.9517378', '29.1298703', '29.1709113'],
};
const ZIPPOPOTAM_STYLE_WRONG_POINT = { ...MALTEPE, lat: '40.1537', lon: '33.1779' };   // outside its own bounding box

let calls;
function reply(body, { ok = true, status = 200 } = {}) {
  return vi.fn(async (url) => { calls.push(String(url)); return { ok, status, json: async () => body }; });
}
beforeEach(() => {
  calls = [];
  VexGeo._cache.clear();
  VexGeo._lastRequestAt = 0;
  VexGeo.MIN_GAP_MS = 0;
  delete window.VexNet;
});

describe('which text is a postcode', () => {
  it('recognises postcodes of several countries and leaves names alone', () => {
    for (const ok of ['34852', '34750', 'SW1A 1AA', 'M1 1AE', 'K1A 0B1', '1012 AB', '75008', '10115', '100-0001']) expect(VexGeo.looksLikePostcode(ok), ok).toBe(true);
    for (const no of ['Springfield', 'Zümrütevler', 'Istanbul', 'Ataşehir', '', '12', 'x'.repeat(11), 'Paris 8e', '34852 Maltepe']) expect(VexGeo.looksLikePostcode(no), no).toBe(false);
  });
});

describe('searching 34852 in Türkiye', () => {
  it('finds Zümrütevler Mahallesi, Maltepe, İstanbul with a usable point, and asks only for that postcode in that country', async () => {
    globalThis.fetch = reply([MALTEPE]);
    const r = await VexGeo.search('34852', { country: 'TR', lang: 'tr' });
    expect(r.postcode).toBe('34852');
    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0];
    expect(VexGeo.label(hit)).toBe('Zümrütevler Mahallesi · Maltepe · İstanbul · Türkiye  [34852]');
    expect(hit.latitude).toBeCloseTo(40.9408, 3);
    expect(hit.longitude).toBeCloseTo(29.1504, 3);
    expect(VexGeo.toLocation(hit)).toEqual({ lat: hit.latitude, lon: hit.longitude, city: 'Zümrütevler Mahallesi, İstanbul, TR' });
    const url = new URL(calls[0]);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('postalcode')).toBe('34852');
    expect(url.searchParams.get('country')).toBe('tr');
    expect(url.searchParams.get('accept-language')).toBe('tr');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('is not special-cased: another postcode goes through the same path and gets its own answer', async () => {
    const atasehir = { ...MALTEPE, lat: '40.99', lon: '29.12', address: { postcode: '34750', suburb: 'Atatürk Mahallesi', town: 'Ataşehir', province: 'İstanbul', country: 'Türkiye', country_code: 'tr' }, boundingbox: ['40.97', '41.01', '29.10', '29.14'] };
    globalThis.fetch = reply([atasehir]);
    const r = await VexGeo.search('34750', { country: 'TR' });
    expect(VexGeo.label(r.hits[0])).toBe('Atatürk Mahallesi · Ataşehir · İstanbul · Türkiye  [34750]');
    expect(new URL(calls[0]).searchParams.get('postalcode')).toBe('34750');
  });

  it('shows the OpenStreetMap credit with those results', async () => {
    globalThis.fetch = reply([MALTEPE]);
    const r = await VexGeo.search('34852', { country: 'TR' });
    expect(VexGeo.attribution(r.hits)).toBe('© OpenStreetMap contributors');
    expect(VexGeo.attribution([{ name: 'x', source: undefined }])).toBe('');
  });
});

describe('coordinates are checked, not trusted', () => {
  it('drops a point outside its own bounding box (the wrong-coordinates case)', async () => {
    globalThis.fetch = reply([ZIPPOPOTAM_STYLE_WRONG_POINT]);
    const r = await VexGeo.search('34852', { country: 'TR' });
    expect(r.hits).toEqual([]);
  });
  it('drops a result in another country, a non-number point and a nameless one', async () => {
    const de = { ...MALTEPE, address: { ...MALTEPE.address, country_code: 'de', country: 'Deutschland' } };
    const nan = { ...MALTEPE, lat: 'abc' };
    const nameless = { ...MALTEPE, name: '34852', address: { postcode: '34852', country_code: 'tr' } };
    globalThis.fetch = reply([de, nan, nameless]);
    expect((await VexGeo.search('34852', { country: 'TR' })).hits).toEqual([]);
  });
  it('keeps several distinct places for one postcode as separate choices, without duplicates', async () => {
    const other = { ...MALTEPE, place_id: 2, address: { ...MALTEPE.address, suburb: 'Girne Mahallesi' } };
    globalThis.fetch = reply([MALTEPE, other, { ...MALTEPE, place_id: 3 }]);
    const r = await VexGeo.search('34852', { country: 'TR' });
    expect(r.hits.map(h => h.name)).toEqual(['Zümrütevler Mahallesi', 'Girne Mahallesi']);
  });
});

describe('clear errors', () => {
  it('no such postcode says so, with the country', async () => {
    globalThis.fetch = reply([]);
    const r = await VexGeo.search('99999', { country: 'TR' });
    expect(r.hits).toEqual([]);
    expect(VexGeo.noMatchMessage('99999', r, 'TR')).toMatch(/No place has the postcode “99999” in .*Check the number and the country/);
    expect(VexGeo.noMatchMessage('99999', r, '')).toMatch(/choose a country/);
  });
  it('a busy service, a server error, unreadable data and no network all throw different, readable errors', async () => {
    globalThis.fetch = reply([], { ok: false, status: 429 });
    await expect(VexGeo.search('34852', { country: 'TR' })).rejects.toThrow(/busy/);
    globalThis.fetch = reply([], { ok: false, status: 503 });
    await expect(VexGeo.search('34853', { country: 'TR' })).rejects.toThrow(/error \(503\).*district name/);
    globalThis.fetch = reply({ not: 'a list' });
    await expect(VexGeo.search('34854', { country: 'TR' })).rejects.toThrow(/could not read/);
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(VexGeo.search('34855', { country: 'TR' })).rejects.toThrow(/Could not reach the postcode service/);
  });
  it('a failed lookup is never cached as an empty answer', async () => {
    globalThis.fetch = reply([], { ok: false, status: 500 });
    await expect(VexGeo.search('34852', { country: 'TR' })).rejects.toThrow();
    globalThis.fetch = reply([MALTEPE]);
    expect((await VexGeo.search('34852', { country: 'TR' })).hits).toHaveLength(1);
  });
});

describe('manners towards the free service', () => {
  it('asks once for the same search and waits between different ones', async () => {
    globalThis.fetch = reply([MALTEPE]);
    await VexGeo.search('34852', { country: 'TR' });
    await VexGeo.search('34852', { country: 'TR' });
    expect(calls).toHaveLength(1);
    VexGeo.MIN_GAP_MS = 60;
    const t0 = Date.now();
    await VexGeo.search('34750', { country: 'TR' });
    await VexGeo.search('34751', { country: 'TR' });
    expect(calls).toHaveLength(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });
  it('sends no cookies and no referrer', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    globalThis.fetch = f;
    await VexGeo.search('34852', { country: 'TR' });
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});

describe('names still go to the name search', () => {
  it('Zümrütevler is not sent to the postcode service, and an HTTP error is reported', async () => {
    globalThis.fetch = reply({ results: [{ name: 'Zümrütevler', admin1: 'Bursa İli', country_code: 'TR', latitude: 40.17, longitude: 29.08 }] });
    const r = await VexGeo.search('Zümrütevler', { country: 'TR', lang: 'tr' });
    expect(r.hits).toHaveLength(1);
    expect(r.postcode).toBeUndefined();
    expect(calls[0]).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\//);
    globalThis.fetch = reply({}, { ok: false, status: 500 });
    await expect(VexGeo.search('Springfield', {})).rejects.toThrow(/error \(500\)/);
  });
});

describe('one lookup for the wizard, the start page and Settings', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', p), 'utf8');
  it('none of them has a private copy of the name search any more', () => {
    for (const f of ['js/app.js', 'js/onboarding.js', 'start.html']) {
      expect(read(f), f).not.toMatch(/geocoding-api\.open-meteo\.com/);
      expect(read(f), f).toMatch(/VexGeo\.search\(/);
    }
  });
  it('the Settings picker has a Country control the search reads', () => {
    expect(read('index.html')).toMatch(/id="setting-weather-country"/);
    expect(read('js/app.js')).toMatch(/getElementById\('setting-weather-country'\)/);
  });
});
