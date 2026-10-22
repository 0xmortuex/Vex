// Turkish release notes: CHANGELOG.tr.md entries ride along on the English ones as `tr`, and the screens pick them in Turkish.
import { describe, it, expect } from 'vitest';
const { addTurkishNotes, parseChangelogList } = require('../../src/main-helpers.js');

const EN = '# Changelog\n\n## v2.0.0 (2026-10-21) — New thing\n\n### New\n- **A thing.** It works. (feature: a-thing)\n\n## v1.0.0 (2026-10-01) — First\n\n### New\n- **Old.** Old notes.\n';
const TR = '# Değişiklik günlüğü\n\nGiriş metni.\n\n## v2.0.0 (2026-10-21) — Yeni şey\n\n### Yeni\n- **Bir şey.** Çalışır. (feature: a-thing)\n';

describe('addTurkishNotes', () => {
  it('adds the Turkish notes of a version that has them, and leaves the others as they were', () => {
    const out = addTurkishNotes(parseChangelogList(EN), TR);
    expect(out.map(e => e.version)).toEqual(['v2.0.0', 'v1.0.0']);
    expect(out[0].tr.name).toBe('v2.0.0 — Yeni şey');
    expect(out[0].tr.body).toContain('**Bir şey.** Çalışır. (feature: a-thing)');
    expect(out[0].body).toContain('**A thing.**');   // the English is still there
    expect(out[1].tr).toBeUndefined();               // no Turkish for v1.0.0: English stays
  });
  it('returns the entries untouched when there is no Turkish file or it is empty', () => {
    const list = parseChangelogList(EN);
    expect(addTurkishNotes(list, '')).toEqual(list);
    expect(addTurkishNotes(list, undefined)).toEqual(list);
    expect(addTurkishNotes(null, TR)).toEqual([]);
  });
  it('the shipped CHANGELOG.tr.md parses, and every entry has a heading and a body', () => {
    const md = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'CHANGELOG.tr.md'), 'utf8');
    const list = parseChangelogList(md);
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const e of list) { expect(e.version).toMatch(/^v\d+\.\d+\.\d+$/); expect(e.body.length).toBeGreaterThan(50); }
  });
  it('every Turkish entry that carries a (feature: id) tag has the same tags as the English entry', () => {
    const read = (n) => require('fs').readFileSync(require('path').join(__dirname, '..', '..', n), 'utf8');
    const tags = (body) => (body.match(/\(feature:\s*([a-z0-9._:-]+)\)/gi) || []).sort();
    const en = new Map(parseChangelogList(read('CHANGELOG.md')).map(e => [e.version, e]));
    for (const t of parseChangelogList(read('CHANGELOG.tr.md'))) {
      expect(en.has(t.version), t.version + ' exists in CHANGELOG.md').toBe(true);
      expect(tags(t.body), t.version + ' feature tags').toEqual(tags(en.get(t.version).body));
    }
  });
});

// Every release has its notes in Turkish, with the same shape as the English: the same bullets, the same (feature: id) tags, the same code
// in backticks. A translation that dropped a bullet or changed a command would fail here.
describe('CHANGELOG.tr.md covers every release', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const read = (n) => fs2.readFileSync(path2.join(__dirname, '..', '..', n), 'utf8').replace(/\r/g, '');
  const sections = (md) => {
    const heads = [...md.matchAll(/^## (v\d\S*) (\([^)]*\))/gm)];
    return new Map(heads.map((h, i) => [h[1], { date: h[2], text: md.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : undefined) }]));
  };
  const en = sections(read('CHANGELOG.md'));
  const tr = sections(read('CHANGELOG.tr.md'));
  const bullets = (t) => (t.match(/^\s*- /gm) || []).length;
  const heads3 = (t) => (t.match(/^### /gm) || []).length;
  const set = (t, re) => (t.match(re) || []).sort().join('\u0001');
  const hasBody = (t) => t.split('\n').slice(1).join('').trim().length > 0;

  it('has a Turkish entry for every release that has notes', () => {
    const missing = [...en].filter(([v, e]) => hasBody(e.text) && !tr.has(v)).map(([v]) => v);
    expect(missing).toEqual([]);
  });
  it('has no Turkish entry for a release that does not exist', () => {
    expect([...tr.keys()].filter(v => !en.has(v))).toEqual([]);
  });
  it('keeps each entry\'s date, bullets, headings, feature tags and code spans', () => {
    const bad = [];
    for (const [v, t] of tr) {
      const e = en.get(v);
      if (!e) continue;
      if (e.date !== t.date) bad.push(v + ': date');
      if (bullets(e.text) !== bullets(t.text)) bad.push(v + ': bullets');
      if (heads3(e.text) !== heads3(t.text)) bad.push(v + ': headings');
      if (set(e.text, /\(feature:\s*[a-z0-9._:-]+\)/gi) !== set(t.text, /\(feature:\s*[a-z0-9._:-]+\)/gi)) bad.push(v + ': feature tags');
      if (set(e.text, /`[^`\n]+`/g) !== set(t.text, /`[^`\n]+`/g)) bad.push(v + ': code spans');
    }
    expect(bad).toEqual([]);
  });
});
