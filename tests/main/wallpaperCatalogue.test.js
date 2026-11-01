// The hosted wallpaper list (src/main/wallpaper-catalogue.js): what is accepted, what is dropped and why.
import { describe, it, expect } from 'vitest';

const { validateCatalogue, checkEntry, httpsUrl, LICENCES } = require('../../src/main/wallpaper-catalogue.js');

const good = () => ({
  id: 'mist-valley', title: 'Mist in the valley', author: 'Jane Example', licence: 'CC0-1.0',
  sourceUrl: 'https://example.com/photos/mist', thumbUrl: 'https://example.com/t/mist.jpg', fullUrl: 'https://example.com/f/mist.jpg',
  tags: ['Mist', 'green'], category: 'nature', dominant: '#4A6B5C', width: 3840, height: 2160,
});
const doc = (entries) => ({ schema: 1, name: 'Test list', updated: '2026-10-31', entries });

describe('one entry', () => {
  it('a full one is accepted and tidied (tags lowercased, colour lowercased, unknown fields dropped)', () => {
    const r = checkEntry({ ...good(), extra: 'x' });
    expect(r.problem).toBeUndefined();
    expect(r.entry.tags).toEqual(['mist', 'green']);
    expect(r.entry.dominant).toBe('#4a6b5c');
    expect(r.entry).not.toHaveProperty('extra');
  });
  it('the optional parts may be left out', () => {
    const { tags, width, height, ...rest } = good();
    const r = checkEntry(rest);
    expect(r.entry.tags).toEqual([]);
    expect(r.entry).not.toHaveProperty('width');
  });
  it('every licence that lets anyone use a picture is accepted', () => {
    for (const l of Object.keys(LICENCES)) expect(checkEntry({ ...good(), licence: l }).entry.licence).toBe(l);
    expect(Object.keys(LICENCES)).toEqual(['CC0-1.0', 'PDM-1.0', 'Pexels', 'Unsplash', 'Own']);
  });
  it.each([
    ['a licence it does not know', { licence: 'All rights reserved' }, /licence/],
    ['no licence', { licence: undefined }, /licence/],
    ['no author', { author: ' ' }, /author/],
    ['no title', { title: '' }, /title/],
    ['a bad id', { id: 'Bad Id!' }, /id/],
    ['a short id', { id: 'ab' }, /id/],
    ['an http picture', { fullUrl: 'http://example.com/f.jpg' }, /fullUrl/],
    ['an address with a password in it', { thumbUrl: 'https://user:pw@example.com/t.jpg' }, /thumbUrl/],
    ['a file: address', { sourceUrl: 'file:///C:/x.html' }, /sourceUrl/],
    ['a javascript: address', { sourceUrl: 'javascript:alert(1)' }, /sourceUrl/],
    ['a colour that is not #rrggbb', { dominant: 'green' }, /dominant/],
    ['a category with capitals', { category: 'Nature' }, /category/],
    ['too many tags', { tags: Array.from({ length: 13 }, (_, i) => 't' + i) }, /tags/],
    ['a size that is not a number', { width: '3840' }, /width/],
  ])('is refused for %s', (_name, patch, why) => {
    const r = checkEntry({ ...good(), ...patch });
    expect(r.entry).toBeUndefined();
    expect(r.problem).toMatch(why);
  });
  it('is refused when it is not an object', () => {
    expect(checkEntry(null).problem).toMatch(/object/);
    expect(checkEntry([]).problem).toMatch(/object/);
    expect(checkEntry('x').problem).toMatch(/object/);
  });
});

describe('the whole list', () => {
  it('keeps the good entries and says why each other was dropped', () => {
    const r = validateCatalogue(doc([good(), { ...good(), id: 'second-one', licence: 'nope' }, { ...good(), id: 'mist-valley' }, 7]));
    expect(r.entries.map(e => e.id)).toEqual(['mist-valley']);
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toMatch(/second-one.*licence/);
    expect(r.problems[1]).toMatch(/repeats an id/);
    expect(r.problems[2]).toMatch(/entry number 4/);
    expect(r.name).toBe('Test list');
    expect(r.updated).toBe('2026-10-31');
  });
  it('an empty list is a valid list (the documented sample)', () => {
    expect(validateCatalogue(doc([]))).toMatchObject({ entries: [], problems: [] });
  });
  it('is refused as a whole when it is not schema 1 or has no entries list', () => {
    expect(() => validateCatalogue(null)).toThrow(/JSON object/);
    expect(() => validateCatalogue({ schema: 2, entries: [] })).toThrow(/schema 1/);
    expect(() => validateCatalogue({ schema: 1 })).toThrow(/entries/);
    expect(() => validateCatalogue({ schema: 1, entries: {} })).toThrow(/entries/);
  });
  it('is refused when it is far too long', () => {
    expect(() => validateCatalogue(doc(new Array(2001).fill(good())))).toThrow(/2001 entries/);
  });
});

describe('httpsUrl', () => {
  it('takes only plain https addresses', () => {
    expect(httpsUrl('https://a.example/x.jpg')).toBe(true);
    for (const bad of ['http://a.example', '//a.example', 'ftp://a.example', 'https://u@a.example', '', null, 5, 'https://' + 'a'.repeat(2100)]) expect(httpsUrl(bad)).toBe(false);
  });
});
