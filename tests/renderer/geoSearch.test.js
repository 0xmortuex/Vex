// @vitest-environment jsdom
//
// Place search for the weather location.
//
// The reported symptom was "it doesn't recognize some cities". The cause was
// not recognition at all: both pickers (the setup wizard and the start page's
// own "Change location") asked Open-Meteo for the FIVE best matches in
// TURKISH, whatever language the user had chosen. Manchester and Springfield
// have about a hundred matches each, so the right one usually wasn't in the
// five — and an English name searched against Turkish results often matched
// nothing at all.
//
// These pin the query that goes out, the country filter, and the labels that
// let you tell two places of the same name apart.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexGeo } = require('../../src/renderer/js/geo-search.js');

const hit = (over) => Object.assign({
  name: 'Manchester', latitude: 53.48, longitude: -2.24,
  country: 'United Kingdom', country_code: 'GB', admin1: 'England',
}, over);

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ results: [] }) }));
  delete window.VexNet;
});

describe('the query that actually goes out', () => {
  it('asks for a hundred matches in the language it was given — not five in Turkish', async () => {
    await VexGeo.search('Manchester', { lang: 'en' });
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('name=Manchester');
    expect(url).toContain('count=100');
    expect(url).toContain('language=en');
    expect(url).not.toContain('language=tr');
  });

  it('passes a postcode through untouched', async () => {
    await VexGeo.search('34750', { lang: 'en' });
    expect(fetch.mock.calls[0][0]).toContain('name=34750');
  });

  it('takes only the two-letter part of a language tag', async () => {
    await VexGeo.search('x', { lang: 'en-GB' });
    expect(fetch.mock.calls[0][0]).toContain('language=en');
  });

  it('does not call out at all for an empty query', async () => {
    expect(await VexGeo.search('   ', {})).toEqual({ hits: [], elsewhere: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('goes through VexNet when the app provides it', async () => {
    window.VexNet = { fetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ results: [] }) })) };
    await VexGeo.search('x', {});
    expect(window.VexNet.fetch).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  // A lookup that quietly returns nothing reads exactly like a place that does
  // not exist, which is how you end up "fixing" your spelling for ten minutes.
  it('throws on a network failure instead of returning no matches', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(VexGeo.search('Manchester', {})).rejects.toThrow('offline');
  });
});

describe('narrowing by country', () => {
  it('keeps only that country, and counts what it dropped', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ results: [
      hit(), hit({ country_code: 'US', admin1: 'New Hampshire' }), hit({ country_code: 'US', admin1: 'Connecticut' }),
    ] }) }));
    const found = await VexGeo.search('Manchester', { country: 'GB' });
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0].admin1).toBe('England');
    expect(found.elsewhere).toBe(2);
  });

  it('returns everything when no country is chosen', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ results: [hit(), hit({ country_code: 'US' })] }) }));
    const found = await VexGeo.search('Manchester', {});
    expect(found.hits).toHaveLength(2);
    expect(found.elsewhere).toBe(0);
  });

  it('reports "none here, some elsewhere" distinctly from "none anywhere"', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ results: [hit({ country_code: 'US' })] }) }));
    const found = await VexGeo.search('Manchester', { country: 'TR' });
    expect(found.hits).toHaveLength(0);
    expect(found.elsewhere).toBe(1);
  });
});

describe('telling two places of the same name apart', () => {
  it('writes a place out from the most specific part upwards', () => {
    expect(VexGeo.label(hit({ name: 'Ataşehir', admin1: 'Istanbul', country: 'Türkiye' })))
      .toBe('Ataşehir · Istanbul · Türkiye');
  });

  it('includes the district and province when the geocoder gives them', () => {
    expect(VexGeo.label(hit({ name: 'Kadıköy', admin2: 'Kadıköy District', admin1: 'Istanbul', country: 'Türkiye' })))
      .toContain('Kadıköy District');
  });

  it('does not repeat a name that appears at two levels', () => {
    const label = VexGeo.label(hit({ name: 'Istanbul', admin1: 'Istanbul', country: 'Türkiye' }));
    expect(label).toBe('Istanbul · Türkiye');
  });

  it('shows postcodes, which are often the only thing that separates two places', () => {
    expect(VexGeo.label(hit({ postcodes: ['M1', 'M2', 'M3'] }))).toContain('[M1, M2]');
  });

  it('stores a short name, and coordinates, for the weather card', () => {
    expect(VexGeo.short(hit())).toBe('Manchester, England, GB');
    expect(VexGeo.toLocation(hit())).toEqual({ lat: 53.48, lon: -2.24, city: 'Manchester, England, GB' });
  });
});

describe('the country picker', () => {
  it('offers every country, sorted by name, with "any" first', () => {
    const html = VexGeo.optionsHtml('GB');
    expect(html.indexOf('<option value="">')).toBe(0);
    expect(html).toContain('value="GB" selected');
    expect(VexGeo.COUNTRY_CODES.length).toBeGreaterThan(190);
    const names = VexGeo.countries().map(c => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('escapes a country name rather than pasting it into markup', () => {
    const spy = vi.spyOn(VexGeo, 'countryName').mockReturnValue('<script>x</script>');
    expect(VexGeo.optionsHtml('')).not.toContain('<script>x');
    spy.mockRestore();
  });

  it('guesses from the locale, and stays quiet when it cannot', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
    Object.defineProperty(navigator, 'language', { value: 'tr-TR', configurable: true });
    expect(VexGeo.guessCountry()).toBe('TR');
    Object.defineProperty(navigator, 'language', { value: 'xx', configurable: true });
    expect(VexGeo.guessCountry()).toBe('');
    Object.defineProperty(navigator, 'language', { value: 'en-ZZ', configurable: true });
    expect(VexGeo.guessCountry()).toBe('');   // not a country we know
    if (original) Object.defineProperty(Navigator.prototype, 'language', original);
  });
});

describe('both pickers use this one module', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', p), 'utf8');

  it('no page keeps its own geocoding call', () => {
    for (const file of ['start.html', 'js/onboarding.js']) {
      const src = read(file);
      expect(src, file).not.toMatch(/language=tr/);
      expect(src, file).not.toMatch(/geocoding-api\.open-meteo\.com/);
      expect(src, file).toMatch(/VexGeo/);
    }
  });

  it('is loaded by both pages', () => {
    for (const file of ['start.html', 'index.html']) {
      expect(read(file), file).toContain('js/geo-search.js');
    }
  });
});
