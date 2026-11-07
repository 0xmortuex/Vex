// @vitest-environment jsdom
//
// Search boxes folded with toLowerCase(), so "istanbul" missed "İstanbul" (JavaScript lower-cases İ to i + a combining dot) and
// "ISI" did not meet "ısı". They fold with VexTr.fold now, and a ratchet (no-raw-lowercase-search) fails on a new
// `.toLowerCase().includes(` / `.toLowerCase().indexOf(` in renderer code.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const R = require('../../scripts/ratchets.js');
globalThis.VexBench = { register() {} }; // the module registers itself with the bench when it has a window
const { VexCodeLibrary } = require('../../src/renderer/js/code-library.js');
const { VideoTools } = require('../../src/renderer/js/video-tools.js');
const { VexPackContent } = require('../../src/renderer/js/pack-content.js');
const { DownloadsPanel } = require('../../src/renderer/js/downloads-panel.js');
const { VexStudyEntry } = require('../../src/renderer/js/study-entry.js');

describe('VexTr.fold meets every spelling of the Turkish I in both directions', () => {
  const pairs = [['istanbul', 'İstanbul'], ['ISTANBUL', 'İstanbul'], ['ısı', 'ISI'], ['ısı', 'isi'], ['Işık', 'ISIK'], ['işik', 'IŞIK'], ['Şişli', 'sisli'], ['ĞÜŞİÖÇ', 'gusioc'], ['İİ', 'ii']];
  for (const [a, b] of pairs) {
    it(a + ' ~ ' + b, () => {
      expect(VexTr.fold(a)).toBe(VexTr.fold(b));
      expect(VexTr.fold(a).includes(VexTr.fold(b))).toBe(true);
      expect(VexTr.fold(b).includes(VexTr.fold(a))).toBe(true);
    });
  }
  it('JavaScript\'s own toLowerCase does not (why this exists)', () => {
    expect('İstanbul'.toLowerCase().includes('istanbul')).toBe(false);
    expect('ISI'.toLowerCase().includes('ısı')).toBe(false);
  });
  it('a decomposed İ (I + combining dot) folds the same as the one-piece İ', () => {
    expect(VexTr.fold('İstanbul')).toBe(VexTr.fold('İstanbul'));
  });
  it('leaves other letters and digits alone', () => {
    expect(VexTr.fold('Vex 2026-v3')).toBe('vex 2026-v3');
    expect(VexTr.fold(null)).toBe('');
  });
});

describe('the search boxes find the Turkish spelling', () => {
  it('code library', () => {
    const list = [{ code: 'x', title: 'İstanbul haritası', url: 'https://a.test', lang: 'js', license: 'MIT' }];
    expect(VexCodeLibrary.search(list, 'istanbul')).toHaveLength(1);
    expect(VexCodeLibrary.search(list, 'HARITASI')).toHaveLength(1);
  });
  it('transcript search', () => {
    const lines = [{ s: 1, t: 'ISI yalıtımı' }, { s: 2, t: 'başka' }];
    expect(VideoTools.filter(lines, 'ısı')).toHaveLength(1);
    expect(VideoTools.filter(lines, 'isi')).toHaveLength(1);
  });
  it('pack content', () => {
    const list = [{ label: 'İş mektubu', text: 'Sayın', group: 'Resmi' }];
    expect(VexPackContent.filter(list, 'iş')).toHaveLength(1);
    expect(VexPackContent.filter(list, 'IS MEKTUBU'.slice(0, 2))).toHaveLength(1);
  });
  it('downloads', () => {
    expect(DownloadsPanel._matches({ filename: 'İstanbul.pdf', url: 'https://x' }, VexTr.fold('istanbul'))).toBe(true);
    expect(DownloadsPanel._matches({ filename: 'ISI.pdf', url: 'https://x' }, VexTr.fold('ısı'))).toBe(true);
  });
  it('study entry finds the sentence around a selected word', () => {
    expect(VexStudyEntry.sentenceAround('Bir şey var. İstanbul büyük bir şehir. Son.', 'istanbul')).toBe('İstanbul büyük bir şehir.');
  });
});

describe('ratchet no-raw-lowercase-search', () => {
  it('flags the raw forms', () => {
    expect(R.findRawLowercaseSearch('a.toLowerCase().includes(q);')).toHaveLength(1);
    expect(R.findRawLowercaseSearch('x = String(t).toLowerCase().indexOf(q);')).toHaveLength(1);
    expect(R.findRawLowercaseSearch('a.toLowerCase()\n  .includes(q)')).toHaveLength(1);
  });
  it('does not flag folding, strings, comments, or a line that says why', () => {
    expect(R.findRawLowercaseSearch('VexTr.fold(a).includes(VexTr.fold(q));')).toHaveLength(0);
    expect(R.findRawLowercaseSearch('// a.toLowerCase().includes(q)\nconst s = "a.toLowerCase().includes(q)";')).toHaveLength(0);
    expect(R.findRawLowercaseSearch('// vex-allow-lowercase: a URL\nu.toLowerCase().includes(p);')).toHaveLength(0);
    expect(R.findRawLowercaseSearch('u.toLowerCase().includes(p); // vex-allow-lowercase: an id')).toHaveLength(0);
  });
  it('the marker only covers its own line and the next, not the whole file', () => {
    expect(R.findRawLowercaseSearch('// vex-allow-lowercase: x\na;\nb;\nu.toLowerCase().includes(p);')).toHaveLength(1);
  });
  it('is a registered rule over the renderer, and the renderer is clean', () => {
    expect(R.RULES['no-raw-lowercase-search'].dirs).toContain('src/renderer');
    expect(R.scan()['no-raw-lowercase-search']).toEqual({});
  });
  it('every allowed use says why', () => {
    const root = path.join(__dirname, '../../src/renderer');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    for (const f of walk(root)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/vex-allow-lowercase:\s*(.*)/g)) expect(m[1].trim().length, f).toBeGreaterThan(8);
    }
  });
});
