// src/main/safe-mode.js, feature isolation: a feature that crashes start-up twice is left out
// ALONE (the app starts normally); crashes with no one feature to blame still go to safe mode.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBootGuard, FEATURE_FAILS_BEFORE_OFF } = require('../../src/main/safe-mode.js');

let dir, clock;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-safe-feature-')); clock = 1_700_000_000_000; });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });
const guard = () => createBootGuard({ dir, fs, argv: [], version: '2.31.90', now: () => (clock += 1000) });
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'boot-state.json'), 'utf8'));

// A launch that dies while `feature` (or nothing) is starting.
function crashDuring(feature) {
  const g = guard();
  const r = g.begin();
  if (feature) g.featureStarting(feature);
  return r;
}

describe('a feature that crashes start-up', () => {
  it('is left out alone on the launch after the second crash, and the app is NOT in safe mode', () => {
    crashDuring('tab-cleanup');
    crashDuring('tab-cleanup');
    const g = guard();
    const r = g.begin();
    expect(r.disabledFeatures).toEqual(['tab-cleanup']);
    expect(r.safeMode).toBe(false);
    expect(r.fails).toBe(0);
    g.started();
    expect(guard().begin()).toMatchObject({ safeMode: false, disabledFeatures: [], crashed: false });
  });

  it('is not left out after one crash', () => {
    crashDuring('tab-cleanup');
    const r = guard().begin();
    expect(r.disabledFeatures).toEqual([]);
    expect(r.crashed).toBe(true);
    expect(r.safeMode).toBe(false);
  });

  it('needs the SAME feature twice in a row: two different features still end in safe mode', () => {
    crashDuring('a');
    crashDuring('b');
    const r = guard().begin();
    expect(r.disabledFeatures).toEqual([]);
    expect(r.safeMode).toBe(true);
  });

  it('a crash with no feature to blame still counts toward safe mode, as before', () => {
    crashDuring(null);
    crashDuring(null);
    expect(guard().begin().safeMode).toBe(true);
  });

  it('a crash elsewhere in between keeps safe mode on the table', () => {
    crashDuring('a');
    crashDuring(null);
    crashDuring('a');
    const r = guard().begin();
    expect(r.safeMode).toBe(true);           // three launches in a row did not finish
  });

  it('a feature that finished starting is never blamed for a later crash', () => {
    const g1 = guard();
    g1.begin();
    g1.featureStarting('a');
    g1.featureStarted('a');
    const g2 = guard();
    g2.begin();
    g2.featureStarting('a');
    g2.featureStarted('a');
    const r = guard().begin();
    expect(r.disabledFeatures).toEqual([]);
  });

  it('forgets the counts after a launch that finishes', () => {
    crashDuring('a');
    const g = guard();
    g.begin();
    g.started();
    expect(state().featureFails).toEqual({});
    crashDuring('a');
    expect(guard().begin().disabledFeatures).toEqual([]);          // only one since the clean launch
  });

  it('writes the feature being started to the state file before the crash, and clears it when done', () => {
    const g = guard();
    g.begin();
    g.featureStarting('x');
    expect(state().current).toBe('x');
    g.featureStarted('x');
    expect(state().current).toBe('');
  });

  it('ignores a report once the launch has finished, and refuses a bad id', () => {
    const g = guard();
    g.begin();
    g.started();
    expect(g.featureStarting('late')).toBe(false);
    expect(state().current).toBe('');
    expect(() => g.featureStarting('bad id!')).toThrow(/Not a feature id/);
  });

  it('is two launches that it takes', () => {
    expect(FEATURE_FAILS_BEFORE_OFF).toBe(2);
  });
});
