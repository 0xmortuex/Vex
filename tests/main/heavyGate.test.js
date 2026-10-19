// T0-006: the build/test gate (scripts/heavy-gate.js) and its wiring in package.json.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const G = require('../../scripts/heavy-gate.js');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

const roomy = { freePhysKB: 16 * 1024 * 1024, freeCommitKB: 30 * 1024 * 1024 };

describe('topMemoryUsers', () => {
  const csv = [
    '"idea64.exe","1000","Console","1","3,137,536 K"',
    '"Vex.exe","2000","Console","1","1,048,576 K"',
    '"Vex.exe","2001","Console","1","1,048,576 K"',
    '"svchost.exe","4","Services","0","10,240 K"',
    'not a csv line',
    '"broken.exe","9","Console"',
  ].join('\r\n');
  it('adds the memory of every process of one program and puts the biggest first', () => {
    expect(G.topMemoryUsers(csv, 3)).toEqual(['idea64.exe 3.0 GB', 'Vex.exe 2.0 GB (2 processes)', 'svchost.exe 0.0 GB']);
  });
  it('ignores lines that are not tasklist rows and respects the limit', () => {
    expect(G.topMemoryUsers(csv, 1)).toEqual(['idea64.exe 3.0 GB']);
    expect(G.topMemoryUsers('', 5)).toEqual([]);
  });
});

describe('evaluate', () => {
  it('passes with no game and enough memory', () => {
    expect(G.evaluate({ processNames: ['explorer.exe', 'Code.exe'], mem: roomy }).ok).toBe(true);
  });
  it('refuses while a game runs, naming it', () => {
    for (const game of ['RobloxPlayerBeta.exe', 'cs2.exe', 'Marvel-Win64-Shipping.exe', 'ArcRaiders.exe', 'SomethingNew-Win64-Shipping.exe']) {
      const v = G.evaluate({ processNames: ['explorer.exe', game], mem: roomy });
      expect(v.ok, game).toBe(false);
      expect(v.reasons[0]).toContain(game);
    }
  });
  it('does not treat the Roblox crash handler or Vex itself as a game', () => {
    expect(G.evaluate({ processNames: ['RobloxCrashHandler.exe', 'Vex.exe', 'electron.exe'], mem: roomy }).ok).toBe(true);
  });
  it('refuses on low physical or committed memory, with the numbers', () => {
    const low = G.evaluate({ processNames: [], mem: { freePhysKB: 3 * 1024 * 1024, freeCommitKB: 30 * 1024 * 1024 } });
    expect(low.ok).toBe(false);
    expect(low.reasons.join()).toMatch(/free physical memory is 3\.0 GB \(needs 6 GB\)/);
    const commit = G.evaluate({ processNames: [], mem: { freePhysKB: 16 * 1024 * 1024, freeCommitKB: 8 * 1024 * 1024 } });
    expect(commit.reasons.join()).toMatch(/committed memory is 8\.0 GB \(needs 10 GB\)/);
  });
  it('knows extra games from the environment', () => {
    expect(G.evaluate({ processNames: ['MyGame.exe'], mem: roomy, extraGames: ['mygame.exe'] }).ok).toBe(false);
  });
});

describe('force', () => {
  it('is explicit: flag, VEX_HEAVY_FORCE or npm --force', () => {
    expect(G.wantsForce(['test'], {})).toBe(false);
    expect(G.wantsForce(['test', '--force'], {})).toBe(true);
    expect(G.wantsForce([], { VEX_HEAVY_FORCE: '1' })).toBe(true);
    expect(G.wantsForce([], { npm_config_force: 'true' })).toBe(true);
  });
});

describe('wiring', () => {
  it('every heavy npm entry point goes through the gate', () => {
    expect(pkg.scripts.pretest).toMatch(/heavy-gate\.js/);
    for (const name of ['pack', 'dist', 'dist:win', 'publish', 'check:ui']) {
      expect(pkg.scripts[name], name).toMatch(/^node scripts\/heavy-gate\.js /);
    }
  });
});
