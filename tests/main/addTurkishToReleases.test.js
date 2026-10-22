// scripts/add-turkish-to-releases.js: the Turkish notes onto release pages that are already published. Pure parts only; nothing touches GitHub.
import { describe, it, expect } from 'vitest';
const { withTurkish, plan, entryOf } = require('../../scripts/add-turkish-to-releases.js');

const TR = [
  '# Değişiklik günlüğü', '',
  '## v2.0.0 (2026-01-02) — Daha yeni', '', '### Notlar', '- yeni şey', '',
  '## v1.0.0 (2026-01-01) — Eski', '', '### Notlar', '- eski şey', '',
].join('\n');

describe('withTurkish', () => {
  it('adds the Turkish entry of that version under a Türkçe heading, after the English', () => {
    const out = withTurkish('### Notes\n- the new thing\n', TR, '2.0.0');
    expect(out).toBe('### Notes\n- the new thing\n\n---\n\n## Türkçe — Daha yeni\n\n### Notlar\n- yeni şey\n');
  });
  it('is nothing when the page already has the Turkish section, so it can be run again', () => {
    const once = withTurkish('### Notes\n- the new thing\n', TR, '2.0.0');
    expect(withTurkish(once, TR, '2.0.0')).toBeNull();
  });
  it('is nothing when that version has no Turkish entry', () => {
    expect(withTurkish('### Notes\n- x\n', TR, '9.9.9')).toBeNull();
  });
  it('takes the right version, not the newest', () => {
    expect(withTurkish('- old\n', TR, '1.0.0')).toContain('eski şey');
    expect(withTurkish('- old\n', TR, '1.0.0')).not.toContain('yeni şey');
  });
});

describe('plan', () => {
  const releases = [
    { tag: 'v2.0.0', body: '- the new thing' },
    { tag: 'v1.0.0', body: '- old\n\n---\n\n## Türkçe — Eski\n\n- eski şey' },
    { tag: 'v0.5.0', body: '- ancient' },
    { tag: 'v0.4.0', body: '' },
  ];
  it('edits only the pages that need it, and counts the rest', () => {
    const { edits, skipped } = plan(releases, TR);
    expect(edits.map(e => e.tag)).toEqual(['v2.0.0']);
    expect(skipped).toEqual({ noTurkish: 1, already: 1, empty: 1 });
  });
  it('can be limited to named releases', () => {
    expect(plan(releases, TR, ['v0.5.0']).edits).toEqual([]);
    expect(plan(releases, TR, ['v2.0.0']).edits.map(e => e.tag)).toEqual(['v2.0.0']);
  });
});

describe('aliases', () => {
  const EN = ['## v9.0.0 (2026-01-02) — New', '', '_Released as v2.5.1._', '', '- x', '', '## v8.0.0 (2026-01-01) — Old', '', '- y', ''].join('\n');
  const TR2 = ['## v9.0.0 (2026-01-02) — Yeni', '', '_v2.5.1 olarak yayımlandı._', '', '- x', ''].join('\n');
  it('reads "Released as" lines into tag -> changelog version', () => {
    const a = require('../../scripts/add-turkish-to-releases.js').aliases(EN);
    expect([...a]).toEqual([['v2.5.1', 'v9.0.0']]);
  });
  it('lets an old tag take the Turkish notes of the changelog entry it was released as', () => {
    const a = require('../../scripts/add-turkish-to-releases.js').aliases(EN);
    const { edits } = plan([{ tag: 'v2.5.1', body: '- x' }], TR2, null, a);
    expect(edits.map(e => e.tag)).toEqual(['v2.5.1']);
    expect(edits[0].body).toContain('## Türkçe — Yeni');
  });
});

describe('entryOf', () => {
  it('drops the heading and stops at the next version', () => {
    const e = entryOf(TR, '2.0.0');
    expect(e.title).toBe('## v2.0.0 (2026-01-02) — Daha yeni');
    expect(e.body).toBe('### Notlar\n- yeni şey');
  });
  it('is null for a version it does not have', () => { expect(entryOf(TR, '3.0.0')).toBeNull(); });
});
