// @vitest-environment jsdom
//
// Versioned consent and default migrations (T0-017): js/vex-defaults.js, with the
// modules that use it (SleepConsent, VexPlayfulness, NewTabSlots) run over
// fixture profiles saved by the previous release (tests/fixtures/profiles).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const FIX = path.resolve(__dirname, '../fixtures/profiles');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const GLOBALS = ['VexMigrations', 'VexDefaults', 'VexConsent', 'SleepConsent', 'VexPlayfulness', 'NewTabSlots', 'AttentionState', 'Onboarding', 'VexFun', 'VexAttention', 'VexSettingsGroups'];

function loadAll() {
  const d = fresh('vex-defaults.js');
  Object.assign(globalThis, { VexMigrations: d.VexMigrations, VexDefaults: d.VexDefaults, VexConsent: d.VexConsent });
  d.VexMigrations._defs.clear();
  d.VexConsent._defs.clear();
  globalThis.Onboarding = { done: () => localStorage.getItem('vex.onboarding.done') === '1', _usedBefore: () => false };
  globalThis.SleepConsent = fresh('sleep-consent.js').SleepConsent;
  globalThis.VexPlayfulness = fresh('vex-playfulness.js').VexPlayfulness;
  globalThis.NewTabSlots = fresh('newtab-slots.js').NewTabSlots;
}

function profile(name) {
  const o = JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
  localStorage.clear();
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) localStorage.setItem(k, v);
}

beforeEach(() => {
  localStorage.clear();
  for (const g of GLOBALS) delete globalThis[g];
  vi.restoreAllMocks();
  loadAll();
});

describe('migrateOnce', () => {
  it('runs a migration once and records its id', () => {
    const fn = vi.fn().mockReturnValue(7);
    expect(VexMigrations.migrateOnce('test.one', fn)).toEqual({ ran: true, result: 7 });
    expect(VexMigrations.migrateOnce('test.one', fn)).toEqual({ ran: false, result: undefined });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('vex.migrations.ran'))).toContain('test.one');
  });

  it('does not record a migration that threw, and raises its error', () => {
    expect(() => VexMigrations.migrateOnce('test.bad', () => { throw new Error('nope'); })).toThrow('nope');
    expect(VexMigrations.hasRun('test.bad')).toBe(false);
  });

  it('runAll tries every registered migration and then raises one error naming the failures', () => {
    const ok = vi.fn();
    VexMigrations.register('test.a', () => { throw new Error('a broke'); });
    VexMigrations.register('test.b', ok);
    expect(() => VexMigrations.runAll()).toThrow(/test\.a: a broke/);
    expect(ok).toHaveBeenCalled();
    expect(VexMigrations.hasRun('test.b')).toBe(true);
    expect(VexMigrations.hasRun('test.a')).toBe(false);
  });

  it('refuses an unknown id and a damaged list', () => {
    expect(() => VexMigrations.migrateOnce('test.none')).toThrow(/No migration/);
    localStorage.setItem('vex.migrations.ran', '{broken');
    expect(() => VexMigrations.ran()).toThrow(/not readable/);
  });
});

describe('defaults that know who chose them', () => {
  it('a new default never overrides a choice, and a choice always wins', () => {
    expect(VexDefaults.get('thing', 'a')).toBe('a');
    expect(VexDefaults.setDefault('thing', 'b')).toBe(true);
    expect(VexDefaults.entry('thing')).toEqual({ value: 'b', explicit: false });
    expect(VexDefaults.setDefault('thing', 'c')).toBe(true);         // Vex may change its own default
    VexDefaults.set('thing', 'mine');
    expect(VexDefaults.entry('thing')).toEqual({ value: 'mine', explicit: true });
    expect(VexDefaults.setDefault('thing', 'd')).toBe(false);        // a release cannot take it back
    expect(VexDefaults.get('thing')).toBe('mine');
    expect(VexDefaults.reset('thing')).toBe(true);
    expect(VexDefaults.get('thing', 'dflt')).toBe('dflt');
  });

  it('refuses a bad name', () => {
    expect(() => VexDefaults.set('Bad Name!', 1)).toThrow();
  });
});

describe('versioned consent', () => {
  it('asks once more when the data use changes, and not again for the same version', () => {
    VexConsent.register('mail-ai', { version: 1, label: 'Read mail to summarise it' });
    expect(VexConsent.status('mail-ai')).toBe('unasked');
    expect(VexConsent.needsAsk('mail-ai')).toBe(true);
    VexConsent.record('mail-ai', 'granted');
    expect(VexConsent.granted('mail-ai')).toBe(true);
    VexConsent.register('mail-ai', { version: 2, label: 'Read mail to summarise it and draft replies' });
    expect(VexConsent.status('mail-ai')).toBe('stale');
    expect(VexConsent.granted('mail-ai')).toBe(false);
    expect(VexConsent.needsAsk('mail-ai')).toBe(true);
    VexConsent.record('mail-ai', 'declined');
    expect(VexConsent.status('mail-ai')).toBe('declined');
    expect(VexConsent.needsAsk('mail-ai')).toBe(false);              // a no is remembered for this version
  });

  it('asks through a confirm dialog only when an answer is needed', async () => {
    VexConsent.register('x-feature', { version: 1 });
    window.vexConfirm = vi.fn().mockResolvedValue(true);
    expect(await VexConsent.ask('x-feature', { message: 'ok?' })).toBe(true);
    expect(await VexConsent.ask('x-feature', { message: 'ok?' })).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });

  it('a sleep consent agreed to under version 1 falls back to "ask" when sleeping widens', () => {
    profile('old-profile-uses-fun.json');
    loadAll();
    VexMigrations.runAll();                                           // adopts the saved "auto" as version 1
    expect(VexConsent.status('sleep-auto')).toBe('granted');
    expect(SleepConsent.mode()).toBe('auto');
    VexConsent.register('sleep-auto', { version: 2, label: 'sleep, wider' });
    expect(SleepConsent.mode()).toBe('ask');
    expect(SleepConsent.modeFor('tabs')).toBe('ask');
    SleepConsent.set('auto');                                         // answered again, for version 2
    expect(SleepConsent.mode()).toBe('auto');
  });
});

describe('fixture profiles through the migrations', () => {
  it('an old profile that uses sounds and the pet keeps them (Full) and keeps every New Tab card', () => {
    profile('old-profile-uses-fun.json');
    loadAll();
    VexMigrations.runAll();
    expect(VexPlayfulness.chosen()).toBe('full');
    expect(NewTabSlots.layout()).toBe('all');
    expect(VexMigrations.ran()).toEqual(expect.arrayContaining(['playfulness.keep-what-is-used', 'newtab.layout-existing-profiles']));
    // Running again changes nothing.
    const before = JSON.stringify(localStorage);
    expect(VexMigrations.runAll()).toEqual([]);
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it('an old profile on the quiet switch stays quiet', () => {
    profile('old-profile-quiet.json');
    loadAll();
    VexMigrations.runAll();
    expect(VexPlayfulness.chosen()).toBe('off');
    expect(VexPlayfulness.level()).toBe('off');
  });

  it('a level and a layout the owner already chose are never touched', () => {
    profile('old-profile-chose-calm-layout.json');
    loadAll();
    VexMigrations.runAll();
    expect(VexDefaults.entry('playfulness')).toEqual({ value: 'calm', explicit: true });   // sounds are on, but the choice stands
    expect(NewTabSlots.layout()).toBe('calm');
  });

  it('a new profile gets Calm and the calm New Tab grid, as defaults and not as choices', () => {
    profile('new-profile.json');
    loadAll();
    VexMigrations.runAll();
    expect(VexPlayfulness.chosen()).toBe('calm');
    expect(VexDefaults.isExplicit('playfulness')).toBe(false);
    expect(NewTabSlots.layout()).toBe('calm');
    expect(VexDefaults.isExplicit('newtab.layout')).toBe(false);
  });
});
