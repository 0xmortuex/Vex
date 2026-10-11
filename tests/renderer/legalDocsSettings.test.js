// PRIVACY.md and TERMS.md tell people which switch turns each thing off.
// Every Settings section and switch they name must exist, with that name, or
// the documents send people looking for something that is not there.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const html = read('src/renderer/index.html');
const headings = new Set([...html.matchAll(/<label class="setting-label"[^>]*>([^<]+)<\/label>/g)].map(m => decode(m[1])));
// Labels drawn by the renderer (Recall, AI memory, the bypass, extensions,
// Password Health) live in its scripts rather than in index.html.
const scripts = readdirSync(path.join(root, 'src/renderer/js')).filter(f => f.endsWith('.js')).map(f => read('src/renderer/js/' + f)).join('\n');
const shownText = decode(html) + '\n' + scripts;

const docs = ['PRIVACY.md', 'TERMS.md'].map(f => [f, read(f)]);

describe('the Settings the legal documents name', () => {
  it('every "Settings › Section › "Switch"" exists', () => {
    const cited = docs.flatMap(([f, text]) => [...text.matchAll(/Settings › ([^›"|\n]+?) › "([^"]+)"/g)].map(m => ({ f, section: m[1].trim(), label: m[2] })));
    expect(cited.length).toBeGreaterThan(10);
    const missing = cited.filter(c => !headings.has(c.section) || !shownText.includes(c.label));
    expect(missing).toEqual([]);
  });

  it('every Settings section named on its own exists', () => {
    const sections = docs.flatMap(([, text]) => [...text.matchAll(/Settings › ((?:[A-Z][\w&()-]*)(?: (?:[A-Z&][\w&()-]*|extras|\(full-text history\)))*)/g)].map(m => m[1].trim()));
    expect(sections.length).toBeGreaterThan(10);
    expect([...new Set(sections)].filter(s => !headings.has(s))).toEqual([]);
  });

  it('the other switches they name by their label exist', () => {
    for (const label of ['Update extensions automatically', 'Check my passwords against known breaches', 'Note prices', 'Block ads and trackers', 'Choose what to sync']) {
      expect(docs.some(([, text]) => text.includes(label)), label + ' is cited').toBe(true);
      expect(shownText.includes(label), label + ' exists').toBe(true);
    }
  });
});
