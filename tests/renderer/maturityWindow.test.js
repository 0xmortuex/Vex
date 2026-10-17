// @vitest-environment jsdom
//
// T0-029: the Experimental tier, the offer after a crash-free safety window, and the sync exemption
// (a staged or experimental feature is neither pushed nor pulled, so a pull cannot switch it on).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const DAY = 86400000;

let R;
let switches;

beforeEach(() => {
  localStorage.clear();
  R = fresh('feature-registry.js').VexRegistry;
  R._reset();
  R.defineAll([
    { id: 'old-one', title: 'Old one', maturity: 'stable', storageKeys: ['vex.oldOne'] },
    { id: 'new-a', title: 'New A', maturity: 'new', storageKeys: ['vex.newA'] },
    { id: 'beta-c', title: 'Beta C', maturity: 'beta', storageKeys: ['vex.betaC'] },
    { id: 'lab-x', title: 'Lab X', maturity: 'experimental', storageKeys: ['vex.labX'] },
  ]);
  globalThis.VexRegistry = R;
  switches = { 'old-one': true, 'new-a': true, 'beta-c': true, 'lab-x': true };
  globalThis.VexUsage = {
    get: (id) => (id in switches ? { id } : null),
    isEnabled: (id) => switches[id],
    disable: async (id) => { switches[id] = false; },
    enable: async (id) => { switches[id] = true; },
  };
});

describe('the Experimental tier', () => {
  it('is a maturity of its own with its own label, and is never sync-eligible', () => {
    expect(R.MATURITY).toContain('experimental');
    expect(R.maturityLabel('lab-x')).toBe('Experimental');
    expect(R.syncEligible('lab-x')).toBe(false);
  });
  it('is switched off even on a brand-new profile, while new and beta features keep their default there', async () => {
    const held = await R.stage({ existing: false });
    expect(held).toEqual(['lab-x']);
    expect(switches['lab-x']).toBe(false);
    expect(switches['new-a']).toBe(true);
  });
  it('is never offered as "try it", nor after the safety window', async () => {
    await R.stage({ existing: true, now: 1000 });
    expect(R.pendingOffers().sort()).toEqual(['beta-c', 'new-a']);
    expect(R.safeWindowOffers([], 1000 + 30 * DAY).sort()).toEqual(['beta-c', 'new-a']);
  });
});

describe('the offer after a crash-free safety window', () => {
  it('writes when a staged feature may be offered, and offers nothing before that', async () => {
    await R.stage({ existing: true, now: 1000 });
    expect(R._load().staged['new-a'].enabledAfter).toBe(1000 + R.SAFETY_WINDOW_MS);
    expect(R.safeWindowOffers([], 1000 + 6 * DAY)).toEqual([]);
    expect(R.safeWindowOffers([], 1000 + 8 * DAY).sort()).toEqual(['beta-c', 'new-a']);
  });
  it('a crash since the feature was staged keeps it waiting; one before does not count', async () => {
    await R.stage({ existing: true, now: 1000 });
    expect(R.safeWindowOffers([{ at: 5000, kind: 'renderer-gone' }], 1000 + 8 * DAY)).toEqual([]);
    expect(R.safeWindowOffers([{ at: 500 }], 1000 + 8 * DAY).sort()).toEqual(['beta-c', 'new-a']);
  });
  it('is an offer, not a switch-on: nothing turns on until the person presses the button', async () => {
    await R.stage({ existing: true, now: 1000 });
    window.showToast = vi.fn();
    expect(R.offerSafe([], 1000 + 8 * DAY)).toBe(2);
    expect(switches['new-a']).toBe(false);
    const call = window.showToast.mock.calls.find(c => /New A/.test(c[0]));
    expect(call[0]).toMatch(/7 days with no crash/);
    await call[3].action.run();
    expect(switches['new-a']).toBe(true);
  });
  it('offers each feature once, shares the three-a-week budget, and skips one the person already turned on', async () => {
    await R.stage({ existing: true, now: 1000 });
    window.showToast = vi.fn();
    switches['beta-c'] = true;
    expect(R.offerSafe([], 1000 + 8 * DAY)).toBe(1);
    expect(R.offerSafe([], 1000 + 8 * DAY)).toBe(0);
    expect(R._load().safeOffered['new-a']).toBeTruthy();
  });
  it('needs the crash list: an unreadable log is an error, not "no crashes"', () => {
    expect(() => R.safeWindowOffers(undefined)).toThrow(/crash list/);
  });
});

describe('the sync exemption', () => {
  it('holds back an experimental feature always, and a staged feature while it is still off', async () => {
    await R.stage({ existing: true, now: 1000 });
    expect(R.syncHeld('vex.labX')).toBe(true);
    expect(R.syncHeld('vex.newA')).toBe(true);
    expect(R.syncHeld('vex.betaC')).toBe(true);
    expect(R.syncHeld('vex.oldOne')).toBe(false);
    expect(R.syncHeld('vex.unowned')).toBe(false);
  });
  it('lets a staged feature sync once the person has turned it on', async () => {
    await R.stage({ existing: true, now: 1000 });
    switches['new-a'] = true;
    expect(R.syncHeld('vex.newA')).toBe(false);
  });
  it('sync-engine drops held keys from both pushing and pulling', () => {
    const src = require('fs').readFileSync(path.join(JS, 'sync-engine.js'), 'utf8');
    expect(src).toMatch(/preferenceKeys = \(\) => [\s\S]{0,400}VexRegistry\.syncHeld\(key\)/);
  });
});
