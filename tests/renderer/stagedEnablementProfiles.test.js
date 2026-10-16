// @vitest-environment jsdom
//
// Staged enablement decides "existing profile" from what the profile has saved, not from the usage
// record (which did not exist in older releases, so on an upgrade it is created "now" and says
// nothing). Three fixture profiles: brand new, an old release's profile that has data but no
// registry record, and a profile that already ran stage() once.
import { describe, it, expect, beforeEach } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let R;
let switches;

// A stand-in for VexUsage with a switch per feature. `since` is "now": the usage record is new.
function fakeUsage(startOn = true) {
  switches = {};
  return {
    report: () => ({ since: Date.now() }),
    get: (id) => (id in switches ? { id } : null),
    isEnabled: (id) => switches[id],
    disable: async (id) => { switches[id] = false; },
    enable: async (id) => { switches[id] = true; },
    add(id) { switches[id] = startOn; },
  };
}

function define() {
  R.defineAll([
    { id: 'old-one', title: 'Old one', maturity: 'stable' },
    { id: 'new-a', title: 'New A', maturity: 'new' },
    { id: 'new-b', title: 'New B', maturity: 'new' },
    { id: 'beta-c', title: 'Beta C', maturity: 'beta' },
    { id: 'passive-d', title: 'Passive D', maturity: 'new', existingProfileDefault: 'on' },
    { id: 'core-e', title: 'Core E', maturity: 'new', killSwitch: 'none' },
  ]);
}

beforeEach(() => {
  localStorage.clear();
  R = fresh('feature-registry.js').VexRegistry;
  R._reset();
  define();
  globalThis.VexRegistry = R;
  const u = fakeUsage(true);
  globalThis.VexUsage = u;
  for (const id of ['old-one', 'new-a', 'new-b', 'beta-c', 'passive-d']) u.add(id);
});

describe('a brand-new profile', () => {
  it('has no evidence and keeps every module default', async () => {
    expect(R.hasProfileEvidence()).toBe(false);
    expect(await R.stage()).toEqual([]);
    for (const id of ['old-one', 'new-a', 'new-b', 'beta-c', 'passive-d']) expect(switches[id], id).toBe(true);
    expect(R._load().profile.kind).toBe('new');
  });
});

describe('an old release profile: saved data, no registry record, a usage record created just now', () => {
  beforeEach(() => {
    localStorage.setItem('vex.tabs', '[]');
    localStorage.setItem('vex.onboardingDone', '1');
  });

  it('ends with every new or beta feature OFF, a stable one untouched, a named passive one left on', async () => {
    expect(R.hasProfileEvidence()).toBe(true);
    const held = await R.stage();                          // no `existing` given: it is worked out
    expect(held.sort()).toEqual(['beta-c', 'new-a', 'new-b']);
    expect(switches['old-one']).toBe(true);
    for (const id of ['new-a', 'new-b', 'beta-c']) expect(switches[id], id).toBe(false);
    expect(switches['passive-d']).toBe(true);              // existingProfileDefault: 'on'
    expect(R._load().profile.kind).toBe('existing');
  });

  it.each(['vex.hasRunBefore', 'vex.legalAcceptedVersion', 'vex.bookmarks', 'vex.history', 'vex.notes'])('counts %s as saved data', async (key) => {
    localStorage.clear();
    localStorage.setItem(key, 'x');
    expect(R.hasProfileEvidence()).toBe(true);
    expect((await R.stage()).length).toBe(3);
  });

  it('records the decision once: switching one on is kept on the next start', async () => {
    await R.stage();
    await VexUsage.enable('new-a');
    R._state = null;                                       // the next session reads vex.registry
    expect(await R.stage()).toEqual([]);
    expect(switches['new-a']).toBe(true);
  });

  it('a feature added in a later release is held off too, even on a profile that began as new', async () => {
    localStorage.clear();
    await R.stage();                                       // first run: brand new
    expect(R._load().profile.kind).toBe('new');
    R.define({ id: 'later', title: 'Later', maturity: 'new' });
    VexUsage.add('later');
    R._state = null;
    expect(await R.stage()).toEqual(['later']);
    expect(switches.later).toBe(false);
  });
});

describe('a profile that already ran stage() once', () => {
  it('keeps the record and does not reconsider', async () => {
    localStorage.setItem('vex.tabs', '[]');
    await R.stage();
    const before = JSON.stringify(R._load().staged);
    R._state = null;
    expect(await R.stage()).toEqual([]);
    expect(JSON.stringify(R._load().staged)).toBe(before);
  });
});

describe('offers are limited to three a week', () => {
  it('offers three now and the rest after the week', async () => {
    localStorage.setItem('vex.tabs', '[]');
    R.define({ id: 'new-f', title: 'New F', maturity: 'new' });
    VexUsage.add('new-f');
    await R.stage();
    const seen = [];
    R.onOffer((x) => seen.push(x.id));
    const t0 = 1e12;
    expect(R.offerTry(undefined, t0)).toBe(3);
    expect(R.offerTry(undefined, t0 + 3600000)).toBe(0);
    expect(R.pendingOffers().length).toBe(1);
    expect(R.offerTry(undefined, t0 + 8 * 86400000)).toBe(1);
    expect(seen.length).toBe(4);
  });
});

describe('the manifest field', () => {
  it('is off or on', () => {
    expect(R.get('new-a').existingProfileDefault).toBe('off');
    expect(() => R.define({ id: 'bad', existingProfileDefault: 'maybe' })).toThrow(/existingProfileDefault/);
  });
});
