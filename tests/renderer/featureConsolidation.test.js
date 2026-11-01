// The feature consolidation (2026-11-01) may never cost an ability: every catalogue id, Ctrl+K command id and
// sidebar panel id that existed before still resolves. The ids come from tests/renderer/fixtures/pre-consolidation-ids.json,
// taken from the catalogue before the eight "Only in Vex" duplicates were folded into their first entries.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const before = require('./fixtures/pre-consolidation-ids.json');

const jsDir = path.join(__dirname, '../../src/renderer/js');
const commandSrc = fs.readFileSync(path.join(jsDir, 'command.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(jsDir, 'sidebar.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
const registeredElsewhere = require('./_catalogTargets.js').commandIds;

describe('feature consolidation keeps every id', () => {
  it('every pre-merge catalogue id still resolves to an entry', () => {
    const lost = before.ids.filter(id => !VexFeatures.get(id));
    expect(lost).toEqual([]);
  });

  it('the folded duplicates resolve to the entry that survived, and no longer appear twice', () => {
    expect(VexFeatures.ALIASES).toEqual({
      pinsite2: 'pinsite', receipts2: 'trackerreceipts', flows2: 'focusflows', podcast2: 'queue',
      restyle2: 'airestyle', stickynotes2: 'stickynote', automations2: 'automations', formfill2: 'formfill',
    });
    for (const [old, now] of Object.entries(VexFeatures.ALIASES)) {
      expect(VexFeatures.ITEMS.some(f => f.id === old)).toBe(false);
      expect(VexFeatures.get(old)).toBe(VexFeatures.get(now));
    }
    const ids = VexFeatures.ITEMS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the old wording is still found by the library search', () => {
    expect(VexFeatures.search('tracker receipts').map(f => f.id)).toContain('trackerreceipts');
    expect(VexFeatures.search('read later as a podcast').map(f => f.id)).toContain('queue');
    expect(VexFeatures.search('all sticky notes').map(f => f.id)).toContain('stickynote');
    expect(VexFeatures.search('universal form fill').map(f => f.id)).toContain('formfill');
    expect(VexFeatures.search('ai restyle').map(f => f.id)).toContain('airestyle');
    expect(VexFeatures.search('pin any site as a panel').map(f => f.id)).toContain('pinsite');
    expect(VexFeatures.search('browser automations').map(f => f.id)).toContain('automations');
    expect(VexFeatures.search('focus flows').map(f => f.id)).toContain('focusflows');
  });

  it('every pre-merge Ctrl+K command id is still registered', () => {
    const lost = before.cmds.filter(c => !(new RegExp("id: '" + c + "'").test(commandSrc) || registeredElsewhere.has(c)));
    expect(lost).toEqual([]);
  });

  it('every pre-merge sidebar panel id is still a panel', () => {
    const lost = before.panels.filter(p => !(sidebarSrc.includes("'" + p + "'") || htmlSrc.includes('"' + p + '"')));
    expect(lost).toEqual([]);
  });
});
