// @vitest-environment jsdom
//
// "What do you want to do?" in the Library (js/feature-intents.js + js/feature-library.js): every catalogue entry is
// filed under exactly one of twelve intents, the tiles carry names and counts, Simple mode opens six of them and
// Developer mode all twelve, a tile opens a list with "Show all N", and the old areas are still there as "By area".
// What it looks like is checked in the real app.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { FeatureLibrary } = require('../../src/renderer/js/feature-library.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { FeatureIntents } = require('../../src/renderer/js/feature-intents.js');
const { VexFeatureIntentsTr } = require('../../src/renderer/js/feature-intents-tr.js');
const { FeatureDetails } = require('../../src/renderer/js/feature-details.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

globalThis.ThemeManager = require('../../src/renderer/js/theme-manager.js').ThemeManager;

let simple = false;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  globalThis.VexFeatures = VexFeatures;
  globalThis.FeatureDetails = FeatureDetails;
  globalThis.FeatureLibrary = FeatureLibrary;
  globalThis.FeatureIntents = FeatureIntents;
  globalThis.VexIcons = VexIcons;
  globalThis.CommandBar = { commands: [] };
  simple = false;
  globalThis.VexSimpleMode = { isSimple: () => simple };
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  Object.assign(FeatureLibrary, { _query: '', _cat: null, _view: null, _intent: null, _showAll: false, _moreTiles: false });
});

const host = () => document.getElementById('host');
const open = () => { FeatureLibrary.render(host()); return host(); };

describe('every feature has exactly one intent', () => {
  it('every catalogue entry resolves to one known intent', () => {
    const known = new Set(FeatureIntents.INTENTS.map(i => i.id));
    expect(known.size).toBe(12);
    for (const f of VexFeatures.ITEMS) expect(known.has(FeatureIntents.intentOf(f)), f.id).toBe(true);
  });

  it('the counts of the twelve add up to the whole catalogue', () => {
    const total = FeatureIntents.INTENTS.reduce((n, i) => n + FeatureIntents.byIntent(i.id).length, 0);
    expect(total).toBe(VexFeatures.ITEMS.length);
  });

  it('no intent is empty, and no id is listed under two intents or under none that exists', () => {
    for (const i of FeatureIntents.INTENTS) expect(FeatureIntents.byIntent(i.id).length, i.id).toBeGreaterThan(0);
    const seen = new Map();
    const ids = new Set(VexFeatures.ITEMS.map(f => f.id));
    for (const [intent, list] of Object.entries(FeatureIntents.OVERRIDE)) {
      expect(FeatureIntents.get(intent), 'unknown intent ' + intent).toBeTruthy();
      for (const id of list) {
        expect(seen.has(id), id + ' is under two intents').toBe(false);
        expect(ids.has(id), id + ' is not a catalogue id').toBe(true);
        seen.set(id, intent);
      }
    }
    for (const [, intent] of FeatureIntents.PREFIX) expect(FeatureIntents.get(intent)).toBeTruthy();
    for (const intent of Object.values(FeatureIntents.CAT_DEFAULT)) expect(FeatureIntents.get(intent)).toBeTruthy();
    for (const c of VexFeatures.CATS) expect(FeatureIntents.CAT_DEFAULT[c.id], 'area ' + c.id).toBeTruthy();
  });

  it('the old ids resolve to the intent of the entry they were folded into', () => {
    for (const [old, now] of Object.entries(VexFeatures.ALIASES)) expect(FeatureIntents.intentOf(old)).toBe(FeatureIntents.intentOf(now));
    expect(() => FeatureIntents.intentOf('no-such-feature')).toThrow(/no such feature/);
  });

  it('puts study, game and the apps where they belong', () => {
    expect(FeatureIntents.intentOf('study-block')).toBe('study');
    expect(FeatureIntents.intentOf('exam-planner')).toBe('study');
    expect(FeatureIntents.intentOf('game-mode')).toBe('game');
    expect(FeatureIntents.intentOf('game-control-center')).toBe('game');
    expect(FeatureIntents.intentOf('panel-discord')).toBe('chat');
    expect(FeatureIntents.intentOf('adblock')).toBe('safe');
    expect(FeatureIntents.intentOf('toolbox')).toBe('build');
    expect(FeatureIntents.intentOf('sync')).toBe('data');
  });

  it('six intents are the Simple set, all of them real', () => {
    expect(FeatureIntents.SIMPLE.length).toBe(6);
    for (const id of FeatureIntents.SIMPLE) expect(FeatureIntents.get(id)).toBeTruthy();
  });
});

describe('Turkish', () => {
  it('has the name and blurb of every intent and the words around the tiles', () => {
    for (const i of FeatureIntents.INTENTS) {
      expect(VexFeatureIntentsTr[i.name], i.name).toBeTruthy();
      expect(VexFeatureIntentsTr[i.blurb], i.blurb).toBeTruthy();
    }
    for (const k of ['What do you want to do?', 'By area', 'features', 'Show all', 'More areas', 'Fewer areas', 'Back to what you want to do', 'Choose what you want to do']) {
      expect(VexFeatureIntentsTr[k], k).toBeTruthy();
    }
  });

  it('adds nothing that the main table already answers differently', () => {
    const tr = VexI18nUI.TABLE.tr;
    // loaded as a file it joins the table; an existing, different entry would be silently replaced
    const fresh = Object.keys(VexFeatureIntentsTr).filter(k => tr[k] !== undefined && tr[k] !== VexFeatureIntentsTr[k]);
    expect(fresh).toEqual([]);
  });

  it('has no emoji', () => {
    const all = Object.entries(VexFeatureIntentsTr).concat(FeatureIntents.INTENTS.map(i => [i.name, i.blurb])).flat().join(' ');
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('the front door', () => {
  it('Developer mode shows twelve tiles, each a button with a name and a count', () => {
    const h = open();
    const tiles = h.querySelectorAll('.flib-tile');
    expect(tiles.length).toBe(12);
    for (const t of tiles) {
      expect(t.tagName).toBe('BUTTON');
      expect(document.getElementById(t.getAttribute('aria-labelledby').split(' ')[0]).textContent.trim()).not.toBe('');
      const n = Number(t.querySelector('.flib-tile-count b').textContent);
      expect(n).toBe(FeatureIntents.byIntent(t.dataset.intent).length);
    }
    expect(h.querySelector('[data-tiles-more]')).toBeNull();
    expect(h.querySelector('.flib-chip')).toBeNull();
  });

  it('Simple mode shows six tiles first, and "More areas" shows all twelve', () => {
    simple = true;
    const h = open();
    expect(h.querySelectorAll('.flib-tile').length).toBe(6);
    expect([...h.querySelectorAll('.flib-tile')].map(t => t.dataset.intent)).toEqual(FeatureIntents.SIMPLE);
    h.querySelector('[data-tiles-more]').click();
    expect(host().querySelectorAll('.flib-tile').length).toBe(12);
    expect(host().querySelector('[data-tiles-more]').getAttribute('aria-expanded')).toBe('true');
    host().querySelector('[data-tiles-more]').click();
    expect(host().querySelectorAll('.flib-tile').length).toBe(6);
  });

  it('a tile opens its list with Show all N, and Back returns focus to that tile', () => {
    const h = open();
    h.querySelector('.flib-tile[data-intent="safe"]').click();
    const total = FeatureIntents.byIntent('safe').length;
    expect(total).toBeGreaterThan(FeatureLibrary.INTENT_PREVIEW);
    expect(h.querySelectorAll('.flib-card').length).toBe(FeatureLibrary.INTENT_PREVIEW);
    const all = h.querySelector('[data-show-all]');
    expect(all.textContent.replace(/\s+/g, ' ').trim()).toBe('Show all ' + total);
    expect(h.querySelector('#flib-intent-h').textContent).toContain(String(total));
    all.click();
    expect(host().querySelectorAll('.flib-card').length).toBe(total);
    expect(host().querySelector('[data-show-all]')).toBeNull();
    host().querySelector('[data-intent-back]').click();
    expect(host().querySelectorAll('.flib-tile').length).toBe(12);
    expect(document.activeElement).toBe(host().querySelector('.flib-tile[data-intent="safe"]'));
  });

  it('every card in a tile belongs to that intent', () => {
    const h = open();
    h.querySelector('.flib-tile[data-intent="game"]').click();
    h.querySelector('[data-show-all]')?.click();
    for (const c of host().querySelectorAll('.flib-card')) expect(FeatureIntents.intentOf(c.dataset.id)).toBe('game');
  });

  it('search still looks through everything, whatever tile is open', () => {
    const h = open();
    h.querySelector('.flib-tile[data-intent="game"]').click();
    const q = host().querySelector('#flib-q');
    q.value = 'tor'; q.dispatchEvent(new Event('input'));
    expect(host().querySelector('.flib-tiles')).toBeNull();
    expect([...host().querySelectorAll('.flib-card')].some(c => FeatureIntents.intentOf(c.dataset.id) !== 'game')).toBe(true);
    q.value = ''; q.dispatchEvent(new Event('input'));
    expect(host().querySelector('#flib-intent-h')).toBeTruthy();
  });

  it('"By area" brings back the original chips and areas, and "What do you want to do?" the tiles', () => {
    const h = open();
    h.querySelector('[data-view="area"]').click();
    expect(host().querySelector('[data-view="area"]').getAttribute('aria-pressed')).toBe('true');
    expect(host().querySelectorAll('.flib-chip').length).toBeGreaterThanOrEqual(VexFeatures.CATS.length + 1);
    expect(host().querySelector('.flib-tiles')).toBeNull();
    expect(host().querySelectorAll('.flib-card').length).toBe(VexFeatures.ITEMS.length);
    host().querySelector('[data-view="intent"]').click();
    expect(host().querySelectorAll('.flib-tile').length).toBe(12);
    expect(host().querySelector('.flib-chip')).toBeNull();
  });
});

describe('before the intent data has loaded', () => {
  it('shows the areas, then the tiles once the lazy loader has delivered the data', async () => {
    delete globalThis.FeatureIntents;
    const ensure = vi.fn(async (src) => { if (src === 'js/feature-intents.js') globalThis.FeatureIntents = FeatureIntents; return true; });
    window.VexLazy = { ensure };
    FeatureLibrary.render(host());
    expect(host().querySelector('.flib-tile')).toBeNull();
    expect(host().querySelector('.flib-chip')).toBeTruthy();
    await vi.waitFor(() => expect(host().querySelector('.flib-tile')).toBeTruthy());
    expect(ensure).toHaveBeenCalledWith('js/feature-intents.js');
    expect(ensure).toHaveBeenCalledWith('js/feature-intents-tr.js');
    delete window.VexLazy;
  });

  it('is not an index.html script (it loads lazily)', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/index.html'), 'utf8');
    expect(html).not.toMatch(/feature-intents/);
  });
});
