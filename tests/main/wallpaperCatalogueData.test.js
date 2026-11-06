// The shipped wallpaper catalogue (src/main/data/wallpaper-catalogue.json), built by scripts/build-wallpaper-catalogue.js.
// This checks the DATA: every entry passes the validator, licences are the two free ones, every address is https on a host Vex may use.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { checkEntry, validateCatalogue } = require('../../src/main/wallpaper-catalogue.js');
const { ALLOWED_HOSTS, SOURCE_HOSTS, CATEGORY_TITLES } = require('../../scripts/build-wallpaper-catalogue.js');

const dir = path.join(__dirname, '..', '..', 'src', 'main', 'data');
const doc = JSON.parse(fs.readFileSync(path.join(dir, 'wallpaper-catalogue.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(dir, 'wallpaper-catalogue-categories.json'), 'utf8'));
const hosts = JSON.parse(fs.readFileSync(path.join(dir, 'wallpaper-catalogue-hosts.json'), 'utf8'));

describe('wallpaper catalogue data', () => {
  it('is a schema 1 list that the validator accepts without a single problem', () => {
    const r = validateCatalogue(doc);
    expect(r.problems).toEqual([]);
    expect(r.entries.length).toBe(doc.entries.length);
  });

  it('has at least 800 entries', () => {
    expect(doc.entries.length).toBeGreaterThanOrEqual(800);
  });

  it('passes checkEntry for each entry', () => {
    const bad = doc.entries.map((e) => ({ e, r: checkEntry(e) })).filter((x) => x.r.problem).map((x) => x.e.id + ': ' + x.r.problem);
    expect(bad).toEqual([]);
  });

  it('has unique ids', () => {
    expect(new Set(doc.entries.map((e) => e.id)).size).toBe(doc.entries.length);
  });

  it('uses only CC0-1.0 and PDM-1.0', () => {
    expect([...new Set(doc.entries.map((e) => e.licence))].sort()).toEqual(['CC0-1.0', 'PDM-1.0'].filter((l) => doc.entries.some((e) => e.licence === l)));
    for (const e of doc.entries) expect(['CC0-1.0', 'PDM-1.0']).toContain(e.licence);
  });

  it('gives every category at least 20 entries, and lists every category for the store', () => {
    const count = {};
    for (const e of doc.entries) count[e.category] = (count[e.category] || 0) + 1;
    for (const [cat, n] of Object.entries(count)) expect({ cat, ok: n >= 20 }).toEqual({ cat, ok: true });
    const listed = categories.map((c) => c.id);
    for (const cat of Object.keys(count)) expect(listed).toContain(cat);
    for (const c of categories) {
      expect(c.id).toMatch(/^[a-z][a-z-]{0,29}$/);
      expect(typeof c.title).toBe('string');
      expect(typeof c.blurb).toBe('string');
    }
    expect(categories).toEqual(JSON.parse(JSON.stringify(CATEGORY_TITLES)));
  });

  it('downloads only from the allow-listed hosts, over https', () => {
    expect(hosts).toEqual([...ALLOWED_HOSTS]);
    for (const e of doc.entries) {
      for (const key of ['thumbUrl', 'fullUrl']) {
        const u = new URL(e[key]);
        expect(u.protocol).toBe('https:');
        expect({ id: e.id, key, host: u.hostname, ok: ALLOWED_HOSTS.includes(u.hostname) }).toEqual({ id: e.id, key, host: u.hostname, ok: true });
      }
      const s = new URL(e.sourceUrl);
      expect(s.protocol).toBe('https:');
      expect({ id: e.id, host: s.hostname, ok: SOURCE_HOSTS.includes(s.hostname) }).toEqual({ id: e.id, host: s.hostname, ok: true });
    }
  });

  it('keeps every picture a wide wallpaper of at least 2560 px', () => {
    for (const e of doc.entries) {
      expect(e.width).toBeGreaterThanOrEqual(2560);
      expect(e.width / e.height).toBeGreaterThanOrEqual(1.3);
      expect(e.width / e.height).toBeLessThanOrEqual(3.0);
    }
  });

  it('stays small enough to ship', () => {
    expect(fs.statSync(path.join(dir, 'wallpaper-catalogue.json')).size).toBeLessThan(1.5 * 1024 * 1024);
  });
});
