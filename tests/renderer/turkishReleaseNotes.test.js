// @vitest-environment jsdom
//
// The release notes in Turkish: an entry that has `tr` (from CHANGELOG.tr.md) shows it when Vex is in Turkish; every other
// case shows the English entry exactly as it was.
import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/i18n.js');
const { VexUpdateNotes } = require('../../src/renderer/js/update-log.js');

const entry = { version: 'v2.0.0', name: 'v2.0.0 — New', body: '- **A thing.** It works.', tr: { name: 'v2.0.0 — Yeni', body: '- **Bir şey.** Çalışır.' } };
const plain = { version: 'v1.0.0', name: 'v1.0.0 — First', body: '- **Old.** Old notes.' };

beforeEach(() => localStorage.clear());

describe('VexUpdateNotes.localized', () => {
  it('is the English entry, untouched, in English', () => {
    expect(VexUpdateNotes.localized(entry)).toBe(entry);
  });
  it('is the Turkish name and body in Turkish, keeping everything else on the entry', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    const out = VexUpdateNotes.localized(entry);
    expect(out.name).toBe('v2.0.0 — Yeni');
    expect(out.body).toBe('- **Bir şey.** Çalışır.');
    expect(out.version).toBe('v2.0.0');
  });
  it('keeps the English of a release that has no Turkish notes, even in Turkish', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    expect(VexUpdateNotes.localized(plain)).toBe(plain);
    expect(VexUpdateNotes.localized(null)).toBeNull();
    expect(VexUpdateNotes.localized({ ...plain, tr: { name: 'x', body: '' } })).toEqual({ ...plain, tr: { name: 'x', body: '' } });
  });
  it('maps a list, and passes a non-list through', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    const out = VexUpdateNotes.localizedList([entry, plain]);
    expect(out[0].body).toBe('- **Bir şey.** Çalışır.');
    expect(out[1]).toBe(plain);
    expect(VexUpdateNotes.localizedList(undefined)).toBeUndefined();
  });
  it('the points and the bold lead the card reads come out of the Turkish body the same way', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    const out = VexUpdateNotes.localized(entry);
    expect(VexUpdateNotes.lead('**Bir şey.** Çalışır.')).toBe('Bir şey');
    expect(out.body.startsWith('- **')).toBe(true);
  });
});
