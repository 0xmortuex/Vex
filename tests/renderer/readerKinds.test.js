// @vitest-environment jsdom
//
// Recipe, trip and docs layouts for reader view: recognised by schema.org
// JSON-LD, a checklist on top of the ordinary reader document.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
const { VexReaderKinds: K } = require('../../src/renderer/js/reader-kinds.js');
const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');

const ld = (o) => JSON.stringify(o);
const P = (nodes, headings = []) => ({ ld: nodes.map(ld), headings });
const esc = (s) => ReadingMode._esc(s);

beforeEach(() => { localStorage.clear(); delete globalThis.VexReaderKinds; });

describe('durations', () => {
  it('reads ISO 8601, and shows anything else as written', () => {
    expect(K.duration('PT1H30M')).toBe('1 h 30 min');
    expect(K.duration('PT45M')).toBe('45 min');
    expect(K.duration('P1DT2H')).toBe('1 d 2 h');
    expect(K.duration('about an hour')).toBe('about an hour');
    expect(K.duration(undefined)).toBe('');
  });
});

describe('recognising a page', () => {
  it('a recipe: ingredients, method steps (strings, HowToStep, HowToSection), times and servings', () => {
    const s = K.parse(P([{ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, { '@type': 'Recipe', name: 'Flatbread',
      recipeIngredient: ['2 cups flour', ' 1 tsp salt ', ''], prepTime: 'PT10M', cookTime: 'PT20M', recipeYield: ['4', '4 servings'],
      nutrition: { calories: '320 kcal' },
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix.' }, { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', name: 'Knead' }, 'Rest'] }] }] }]));
    expect(s.kind).toBe('recipe');
    expect(s.name).toBe('Flatbread');
    expect(s.facts).toEqual([{ label: 'Prep', value: '10 min' }, { label: 'Cook', value: '20 min' }, { label: 'Serves', value: '4' }, { label: 'Calories', value: '320 kcal' }]);
    expect(s.lists[0]).toMatchObject({ heading: 'Ingredients', ordered: false });
    expect(s.lists[0].items.map(i => i.text)).toEqual(['2 cups flour', '1 tsp salt']);
    expect(s.lists[1].items.map(i => i.text)).toEqual(['Mix.', 'Knead', 'Rest']);
  });

  it('a recipe whose instructions are one block of lines', () => {
    const s = K.parse(P([{ '@type': 'Recipe', name: 'Toast', recipeIngredient: ['bread'], recipeInstructions: 'Slice.\nToast.\n\nButter.' }]));
    expect(s.lists[1].items.map(i => i.text)).toEqual(['Slice.', 'Toast.', 'Butter.']);
  });

  it('a trip: the itinerary in position order, or the places when there is none', () => {
    const t = K.parse(P([{ '@type': 'TouristTrip', name: 'Lisbon in 3 days', touristType: ['Families'],
      itinerary: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 2, item: { name: 'Belem Tower', description: 'Morning' } }, { '@type': 'ListItem', position: 1, name: 'Alfama walk' }] } }]));
    expect(t.kind).toBe('travel');
    expect(t.lists[0]).toMatchObject({ heading: 'Itinerary', ordered: true });
    expect(t.lists[0].items.map(i => i.text)).toEqual(['Alfama walk', 'Belem Tower — Morning']);
    expect(t.facts).toEqual([{ label: 'For', value: 'Families' }]);
    const places = K.parse(P([{ '@type': 'TouristDestination', name: 'Porto', includesAttraction: [{ name: 'Ribeira' }, { name: 'Livraria Lello' }] }]));
    expect(places.lists[0]).toMatchObject({ heading: 'Places to see', ordered: false });
    expect(places.lists[0].items).toHaveLength(2);
  });

  it('documentation: steps, what you need and the page outline', () => {
    const d = K.parse(P([{ '@type': 'HowTo', name: 'Install', step: [{ text: 'Download' }, { text: 'Run' }], supply: ['A PC'] }],
      [{ level: 2, text: 'Overview' }, { level: 3, text: 'Requirements' }, { level: 2, text: 'Install' }]));
    expect(d.kind).toBe('docs');
    expect(d.lists.map(l => l.heading)).toEqual(['Steps', 'You need', 'On this page']);
    expect(d.lists[2].items[1]).toEqual({ text: 'Requirements', level: 3 });
    const api = K.parse(P([{ '@type': 'TechArticle', headline: 'API' }], [{ level: 2, text: 'A' }, { level: 2, text: 'B' }, { level: 2, text: 'C' }]));
    expect(api.lists.map(l => l.heading)).toEqual(['On this page']);
  });

  it('is nothing for an article, a recipe with nothing in it, broken JSON, or a kind that is switched off', () => {
    expect(K.parse(P([{ '@type': 'NewsArticle', headline: 'x' }]))).toBeNull();
    expect(K.parse(P([{ '@type': 'Recipe', name: 'Empty' }]))).toBeNull();
    expect(K.parse({ ld: ['{nope'], headings: [] })).toBeNull();
    expect(K.parse(null)).toBeNull();
    expect(K.parse(P([{ '@type': 'Recipe', recipeIngredient: ['a'] }]), { recipe: false })).toBeNull();
  });
});

describe('drawing it', () => {
  const recipe = { kind: 'recipe', name: 'Flatbread', facts: [{ label: 'Prep', value: '10 min' }],
    lists: [{ heading: 'Ingredients', ordered: false, items: [{ text: '2 cups <b>flour</b>' }] }, { heading: 'Method', ordered: true, items: [{ text: 'Mix.' }] }] };

  it('escapes everything the page said', () => {
    const r = K.render(recipe, esc);
    expect(r.html).toContain('2 cups &lt;b&gt;flour&lt;/b&gt;');
    expect(r.html).not.toContain('<b>flour');
    expect(r.html).toContain('<ol class="vk-check">');
    expect(r.html).toContain('type="checkbox"');
    expect(K.render({ kind: 'recipe', lists: [] }, esc)).toBeNull();
    expect(K.render({ kind: 'bogus', lists: [{ items: [{ text: 'x' }] }] }, esc)).toBeNull();
  });

  it('goes above the article in reader view, with the article folded under it', () => {
    globalThis.VexReaderKinds = K;
    const html = ReadingMode.buildHtml({ title: 'Flatbread', blocks: [{ tag: 'P', runs: [{ t: 'My grandmother made this every Sunday.' }] }], structured: recipe },
      'https://food.test/flatbread', {}, { bg: '#fff', text: '#000', muted: '#555', link: '#06c', code: '#eee', border: '#ccc', accent: '#06c', dark: false });
    expect(html.indexOf('<section class="vk-card"')).toBeGreaterThan(html.indexOf('<main'));
    expect(html.indexOf('<section class="vk-card"')).toBeLessThan(html.indexOf('My grandmother'));
    expect(html).toContain('<details class="vk-more">');
    expect(html).toContain('.vk-card{');
    expect(html.match(/<script>/g).length).toBe(2);
  });

  it('leaves out the folded article when asked, and still works with no article text', () => {
    globalThis.VexReaderKinds = K;
    K.savePrefs({ keepArticle: false });
    const html = ReadingMode.buildHtml({ title: 'Flatbread', blocks: [{ tag: 'P', runs: [{ t: 'Story.' }] }], structured: recipe }, 'https://food.test/f', {}, null);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Story.');
    const bare = ReadingMode.buildHtml({ title: 'Flatbread', blocks: [], structured: recipe }, 'https://food.test/f', {}, null);
    expect(bare).toContain('vk-card');
  });

  it('a page without structured data is built exactly as before', () => {
    globalThis.VexReaderKinds = K;
    const html = ReadingMode.buildHtml({ title: 'T', blocks: [{ tag: 'P', runs: [{ t: 'Body.' }] }] }, 'https://x.test/', {}, null);
    expect(html).not.toContain('vk-card');
    expect(html.match(/<script>/g).length).toBe(1);
  });

  it('the checklist script ticks and counts', () => {
    document.body.innerHTML = K.render(recipe, esc).html;
    (0, eval)(K.SCRIPT);
    const boxes = document.querySelectorAll('input[type=checkbox]');
    expect(document.querySelector('.vk-progress').textContent).toBe('0 of 2 done');
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    expect(document.querySelector('.vk-progress').textContent).toBe('1 of 2 done');
    expect(boxes[0].closest('li').classList.contains('vk-done')).toBe(true);
    document.querySelector('.vk-reset').click();
    expect(document.querySelector('.vk-progress').textContent).toBe('0 of 2 done');
  });
});

describe('the page probe', () => {
  it('returns the JSON-LD and the visible headings only', () => {
    document.documentElement.innerHTML = `<head><script type="application/ld+json">{"@type":"HowTo"}</script></head><body><main><h2>One</h2><h3 style="display:none">Hidden</h3><h4>Two</h4></main></body>`;
    const out = (0, eval)(K.PROBE_SCRIPT);
    expect(out.ld).toEqual(['{"@type":"HowTo"}']);
    expect(out.headings).toEqual([{ level: 2, text: 'One' }, { level: 4, text: 'Two' }]);
  });
});
