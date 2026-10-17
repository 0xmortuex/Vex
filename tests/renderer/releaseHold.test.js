// @vitest-environment jsdom
//
// T0-002 (Wave 6): "features ship behind a hidden flag until ticked". With the hold switched on, the features named by
// the unticked lines of this version's list are switched off through the registry and come back when the line is ticked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let V, usageOn, switchLog, ledger, problems;
const BODY = [
  '### New',
  '- **Archive library:** Ctrl+K › Archive This Page keeps a self-contained copy.',
  '- **Patch radar:** give a game a patch notes page.',
  '- **Something with no feature:** Settings › Privacy.',
  '',
  '### Fixed',
  '- **Archive library no longer fails.** It used to crash.',
].join('\n');

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  usageOn = { archive: true, patch: true, off: false };
  switchLog = []; ledger = []; problems = [];
  globalThis.VexUsage = { get: (id) => (id in usageOn ? {} : null), isEnabled: (id) => usageOn[id] };
  globalThis.VexRegistry = {
    has: (id) => id in usageOn,
    get: (id) => ({ id, title: 'T ' + id, killSwitch: id === 'nosw' ? 'none' : 'usage' }),
    switchOff: async (id) => { switchLog.push(['off', id]); usageOn[id] = false; },
    switchOn: async (id) => { switchLog.push(['on', id]); usageOn[id] = true; },
  };
  const items = [{ name: 'Archive library', feature: 'archive' }, { name: 'Patch radar', feature: 'patch' }, { name: 'Off thing', feature: 'off' }];
  globalThis.VexFeatures = { ITEMS: items, nameOf: (f) => f.name };
  globalThis.VexLedger = { note: (l) => ledger.push(l), registerUndo() {} };
  globalThis.VexProblems = { note: (...a) => problems.push(a) };
  ({ VexReleaseChecklist: V } = fresh(JS + 'release-checklist.js'));
  globalThis.VexReleaseChecklist = V;
  V._current = V.build({ version: 'v9.9.9', name: 'x', body: BODY });
});

const flush = () => new Promise(r => setTimeout(r, 0));

describe('hold until ticked', () => {
  it('is off by default and holds nothing', async () => {
    expect(V.holdOn()).toBe(false);
    expect(await V.applyHold()).toEqual([]);
    expect(switchLog).toEqual([]);
  });

  it('names a feature only for a New line that matches the catalogue, never for a fix', () => {
    const items = V._current.items;
    expect(V.featureOf(items.find(i => i.title === 'Archive library'))).toBe('archive');
    expect(V.featureOf(items.find(i => i.title === 'Something with no feature'))).toBe('');
    expect(V.featureOf(items.find(i => /no longer fails/.test(i.title)))).toBe('');
  });

  it('switches off the features of unticked lines, records it, and notes one ledger line each with Undo', async () => {
    const held = await V.setHold(true);
    expect(held.sort()).toEqual(['archive', 'patch']);
    expect(switchLog).toEqual([['off', 'archive'], ['off', 'patch']]);
    expect(Object.keys(V.held('9.9.9')).sort()).toEqual(['archive', 'patch']);
    expect(ledger).toHaveLength(2);
    expect(ledger[0].undo).toEqual({ kind: 'release-hold-release', version: '9.9.9', feature: 'archive' });
    expect(await V.applyHold()).toEqual([]);                    // already held: nothing more
  });

  it('ticking a line puts its feature back; Vex only opening it does not', async () => {
    await V.setHold(true);
    const archive = V._current.items.find(i => i.title === 'Archive library');
    V.autoTick('9.9.9', archive, 'feature');
    await flush();
    expect(usageOn.archive).toBe(false);
    V.setTick('9.9.9', archive.id, true);
    await flush(); await flush();
    expect(usageOn.archive).toBe(true);
    expect(V.held('9.9.9').archive).toBeUndefined();
    expect(V.held('9.9.9').patch).toBeDefined();
    V.setTick('9.9.9', archive.id, false);                      // unticking holds it again
    await flush(); await flush(); await flush();
    expect(usageOn.archive).toBe(false);
    expect(problems).toEqual([]);
  });

  it('never touches a feature that is already off, and never turns on one it did not hold', async () => {
    usageOn.patch = false;
    await V.setHold(true);
    expect(V.held('9.9.9').patch).toBeUndefined();
    const patch = V._current.items.find(i => i.title === 'Patch radar');
    V.setTick('9.9.9', patch.id, true);
    await flush(); await flush();
    expect(usageOn.patch).toBe(false);
    expect(switchLog.filter(x => x[1] === 'patch')).toEqual([]);
  });

  it('switching the hold off restores everything it held', async () => {
    await V.setHold(true);
    const back = await V.setHold(false);
    expect(back.sort()).toEqual(['archive', 'patch']);
    expect(usageOn.archive && usageOn.patch).toBe(true);
    expect(V.held('9.9.9')).toEqual({});
  });

  it('the ledger Undo puts one feature back without ticking the line', async () => {
    await V.setHold(true);
    await V.releaseHeld('9.9.9', null, 'archive');
    expect(usageOn.archive).toBe(true);
    expect(V.held('9.9.9').archive).toBeUndefined();
    expect(V.ticked('9.9.9')).toEqual({});
  });

  it('a feature the person switched on again by hand while held stays on', async () => {
    await V.setHold(true);
    usageOn.archive = true;
    await V.releaseHeld('9.9.9', null, 'archive');
    expect(switchLog.filter(x => x[0] === 'on')).toEqual([]);
  });

  it('a feature with no switch is never held, and an unreadable held list is an error', async () => {
    usageOn.nosw = true;
    globalThis.VexFeatures.ITEMS.push({ name: 'Archive library', feature: 'nosw' });
    globalThis.VexFeatures.ITEMS.splice(0, 1);
    expect(V.featureOf(V._current.items[0])).toBe('');
    localStorage.setItem(V.HELD, '{broken');
    expect(() => V.held('9.9.9')).toThrow(/not readable/);
  });

  it('turning the whole Release check off (Minimal Vex) puts held features back', async () => {
    await V.setHold(true);
    V.setEnabled(false);
    await flush(); await flush(); await flush();
    expect(usageOn.archive && usageOn.patch).toBe(true);
    expect(await V.applyHold()).toEqual([]);
  });
});
