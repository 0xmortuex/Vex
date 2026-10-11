// @vitest-environment jsdom
//
// docs/SYNC_PROTOCOL.md §8.1 is the list a phone or another client follows to
// know which sources the desktop owns (§6 rule 1). It fell behind the code:
// vex.neverSleepHosts, vex.translateAlwaysHosts, vex.themeAuto and
// vex.whatsNewCard synced but were not listed (found 2026-10-10). The list in
// the document must name exactly what the desktop sends.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DOC = fs.readFileSync(path.join(__dirname, '../../docs/SYNC_PROTOCOL.md'), 'utf8');

function section81() {
  const start = DOC.indexOf('### 8.1');
  const end = DOC.indexOf('### 8.2', start);
  if (start < 0 || end < 0) throw new Error('§8.1 not found in SYNC_PROTOCOL.md');
  return DOC.slice(start, end);
}
function keysOnLine(text, label) {
  const line = text.split('\n').find(l => l.startsWith('- **' + label + '**'));
  if (!line) throw new Error('No "' + label + '" line in §8.1');
  return [...line.matchAll(/`(vex\.[A-Za-z0-9.]+)`/g)].map(m => m[1]);
}

describe('SYNC_PROTOCOL.md §8.1 lists every preference the desktop syncs', () => {
  window.VexConfig = { syncWorkerUrl: () => '' };
  require('../../src/renderer/js/sync-records.js');
  require('../../src/renderer/js/sync-engine.js');
  const engine = window.SyncEngine;
  const STORE = ['vex.tabs', 'vex.groups', 'vex.stacks', 'vex.settings', 'vex.shortcuts', 'vex.theme'];
  const sent = engine.SYNC_KEYS.filter(k => !STORE.includes(k));

  it('the list preferences', () => {
    expect(keysOnLine(section81(), 'List preferences').sort()).toEqual([...engine.LIST_PREFERENCES].sort());
  });

  it('the scalar preferences', () => {
    const scalars = sent.filter(k => !engine.LIST_PREFERENCES.includes(k));
    expect(keysOnLine(section81(), 'Scalar preferences').sort()).toEqual(scalars.sort());
  });
});
