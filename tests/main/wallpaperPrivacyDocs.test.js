// The Wallpaper Store contacts picture hosts while it is open. PRIVACY.md and docs/wallpaper-catalogue.md used to say
// the list was empty and nothing was contacted. These tests keep both documents in step with the shipped data:
// a host the store can fetch from must be named in PRIVACY.md, and the doc's numbers must match the data file.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const data = path.join(root, 'src', 'main', 'data');
const catalogue = JSON.parse(fs.readFileSync(path.join(data, 'wallpaper-catalogue.json'), 'utf8'));
const allowed = JSON.parse(fs.readFileSync(path.join(data, 'wallpaper-catalogue-hosts.json'), 'utf8'));
const privacy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
const doc = fs.readFileSync(path.join(root, 'docs', 'wallpaper-catalogue.md'), 'utf8');
const host = (u) => new URL(u).hostname.toLowerCase();

describe('PRIVACY.md names every host the Wallpaper Store can fetch from', () => {
  const used = [...new Set(catalogue.entries.flatMap(e => [host(e.thumbUrl), host(e.fullUrl)]))].sort();

  it('the store uses the hosts it is expected to (a new host must be noticed here)', () => {
    expect(used).toEqual(['images-assets.nasa.gov', 'images.metmuseum.org', 'openaccess-cdn.clevelandart.org', 'thumb.wikimedia.org', 'upload.wikimedia.org']);
  });

  it.each(used)('PRIVACY.md lists %s', (h) => {
    expect(privacy).toContain(h);
  });

  it('PRIVACY.md also lists every host on the allow-list, even one no entry uses today', () => {
    for (const h of allowed) expect(privacy, h).toContain(h);
  });

  it('every picture an entry points at is on the allow-list (nothing is fetched from a host the policy does not name)', () => {
    for (const e of catalogue.entries) {
      expect(allowed, e.id).toContain(host(e.thumbUrl));
      expect(allowed, e.id).toContain(host(e.fullUrl));
    }
  });

  it('has a Wallpaper store row that says what is sent and when', () => {
    const row = privacy.split(/\r?\n/).find(l => /^\| Wallpaper store/.test(l));
    expect(row).toBeTruthy();
    expect(row).toMatch(/Only the image request itself/);
    expect(row).toMatch(/nothing about you/);
    expect(row).toMatch(/Only while the Wallpaper Store is open/);
    expect(row).toMatch(/Nothing at start-up or in the background/);
  });
});

describe('docs/wallpaper-catalogue.md tells the truth about the shipped list', () => {
  it('no longer says the list is empty or that nothing is contacted', () => {
    expect(doc).not.toMatch(/never contacts anything for wallpapers/i);
    expect(doc).not.toMatch(/empty on purpose/i);
    expect(doc).toMatch(/2000 free pictures/);
    expect(catalogue.entries.length).toBe(2000);
  });

  it('gives the number of entries per full-picture host and licence, matching the data', () => {
    const counts = new Map();
    for (const e of catalogue.entries) { const k = host(e.fullUrl) + ' | ' + e.licence; counts.set(k, (counts.get(k) || 0) + 1); }
    expect(counts.size).toBeGreaterThan(0);
    for (const [k, n] of counts) {
      const [h, lic] = k.split(' | ');
      expect(doc, k).toContain('| ' + h + ' | ' + lic + ' | ' + n + ' |');
    }
  });

  it('gives the licence totals, matching the data', () => {
    const pdm = catalogue.entries.filter(e => e.licence === 'PDM-1.0').length;
    const cc0 = catalogue.entries.filter(e => e.licence === 'CC0-1.0').length;
    expect(pdm + cc0).toBe(catalogue.entries.length);
    expect(doc).toContain(pdm + ' entries marked `PDM-1.0`');
    expect(doc).toContain(cc0 + ' marked `CC0-1.0`');
  });

  it('flags that Wikimedia-hosted pictures may carry attribution duties, and says the credit is shown', () => {
    const wiki = catalogue.entries.filter(e => /(^|\.)wikimedia\.org$/.test(host(e.fullUrl)) || /commons\.wikimedia\.org$/.test(host(e.sourceUrl))).length;
    expect(doc).toContain('**' + wiki + ' entries are hosted on Wikimedia**');
    expect(doc).toMatch(/CC-BY-SA/);
    expect(doc).toMatch(/attribution|credit the author/i);
    expect(doc).toMatch(/not re-verified|not\*\* re-verified/i);
  });

  it('every entry has a credit (author) for the store to show', () => {
    const missing = catalogue.entries.filter(e => typeof e.author !== 'string' || !e.author.trim()).map(e => e.id);
    expect(missing).toEqual([]);
    const ui = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'wallpaper-store-ui.js'), 'utf8');
    expect(ui).toMatch(/Photo by[^\n]*d\.author[^\n]*licenceName/);
  });
});
