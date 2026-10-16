// @vitest-environment jsdom
//
// The Playfulness master level (T0-009): js/vex-playfulness.js and the modules
// that read it (VexProgress, VexFun, the living layers, the medal toast, streaks).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const NAMES = ['VexDefaults', 'VexMigrations', 'VexPlayfulness', 'AttentionState', 'VexProgress', 'VexFun', 'GameMode', 'GameSession', 'MeetingMode', 'FocusMode', 'BatteryMode', 'VexSimpleMode', 'VexMinimalMode', 'VexLiving'];
let P;

function load() {
  const d = fresh('vex-defaults.js');
  globalThis.VexDefaults = d.VexDefaults; globalThis.VexMigrations = d.VexMigrations;
  globalThis.AttentionState = fresh('attention-state.js').AttentionState;
  P = fresh('vex-playfulness.js').VexPlayfulness; globalThis.VexPlayfulness = P;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-reduce-motion');
  for (const n of NAMES) delete globalThis[n];
  load();
});

describe('the level', () => {
  it('is Calm until the person chooses, and a choice is theirs', () => {
    expect(P.chosen()).toBe('calm');
    expect(P.isExplicit()).toBe(false);
    P.setLevel('full');
    expect(P.chosen()).toBe('full');
    expect(P.isExplicit()).toBe(true);
    expect(() => P.setLevel('loud')).toThrow();
  });

  it('says which kinds each level allows', () => {
    const table = (level) => { P.setLevel(level); return Object.keys(P.NEEDS).filter(k => P.allowed(k)).sort(); };
    expect(table('off')).toEqual([]);
    expect(table('calm')).toEqual(['delight', 'living', 'medal', 'pet', 'streak', 'tabgame']);
    expect(table('full')).toEqual(['celebrate', 'delight', 'living', 'medal', 'medal-toast', 'pet', 'sound', 'streak', 'tabgame']);
    expect(() => P.allowed('nonsense')).toThrow();
  });

  it('gives the reason in words', () => {
    P.setLevel('calm');
    expect(P.why('sound')).toMatch(/needs full/);
    P.setLevel('off');
    expect(P.why('pet')).toBe('Playfulness is off');
    P.setLevel('full');
    expect(P.why('pet')).toBe('');
  });
});

describe('it switches itself off', () => {
  beforeEach(() => P.setLevel('full'));

  it.each([
    ['Game mode', () => { globalThis.GameMode = { gaming: true }; }, 'Game mode is on'],
    ['a meeting', () => { globalThis.MeetingMode = { active: () => true }; }, 'a meeting is running'],
    ['Focus', () => { globalThis.FocusMode = { active: true, until: 0 }; }, 'Focus is on'],
    ['battery saver', () => { globalThis.BatteryMode = { isLean: () => true }; }, 'the PC is saving battery'],
    ['reduced motion', () => { document.documentElement.setAttribute('data-reduce-motion', ''); }, 'reduced motion is on'],
    ['Simple mode', () => { globalThis.VexSimpleMode = { isSimple: () => true }; }, 'Simple mode is on'],
    ['Minimal Vex', () => { globalThis.VexMinimalMode = { isOn: () => true }; }, 'Minimal Vex is on'],
  ])('during %s', (_n, arrange, reason) => {
    expect(P.level()).toBe('full');
    arrange();
    expect(P.level()).toBe('off');
    expect(P.autoOffReason()).toBe(reason);
    expect(P.allowed('pet')).toBe(false);
    expect(P.why('pet')).toMatch(/paused because/);
  });
});

describe('the old quiet switch is an alias', () => {
  it('quiet on is Off, quiet off brings the level back', () => {
    P.setLevel('full');
    P.quietAlias(true);
    expect(P.chosen()).toBe('off');
    expect(localStorage.getItem('vex.fun.quiet')).toBe('1');
    expect(P.level()).toBe('off');
    P.quietAlias(false);
    expect(P.chosen()).toBe('full');
    expect(localStorage.getItem('vex.fun.quiet')).toBe('0');
  });

  it('a profile that only has vex.fun.quiet = 1 reads as Off', () => {
    localStorage.setItem('vex.fun.quiet', '1');
    expect(P.level()).toBe('off');
  });

  it('VexFun.setFlag("quiet") and VexFun.quiet() follow the master level', () => {
    globalThis.VexFun = fresh('vex-fun.js').VexFun;
    P.setLevel('full');
    expect(VexFun.quiet()).toBe(false);
    VexFun.setFlag('quiet', true);
    expect(P.chosen()).toBe('off');
    VexFun.setFlag('quiet', false);
    expect(P.chosen()).toBe('full');
    P.setLevel('off');
    expect(VexFun.quiet()).toBe(true);
  });
});

describe('what reads the level', () => {
  it('VexProgress: Off silences the pet, Calm keeps the pet but not the level-up pop-up', () => {
    globalThis.VexProgress = fresh('fun/fun-core.js').VexProgress;
    P.setLevel('calm');
    expect(VexProgress.silenced()).toBe(false);
    expect(VexProgress.allows('pet')).toBe(true);
    expect(VexProgress.allows('celebrate')).toBe(false);
    P.setLevel('full');
    expect(VexProgress.allows('celebrate')).toBe(true);
    P.setLevel('off');
    expect(VexProgress.silenced()).toBe(true);
    expect(VexProgress.allows('pet')).toBe(false);
  });

  it('a Play switch turned on under Calm says what it needs, and a sound pack does not play', () => {
    globalThis.VexFun = fresh('vex-fun.js').VexFun;
    window.showToast = vi.fn();
    P.setLevel('calm');
    VexFun.setFlag('sounds', true);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Playfulness set to full/), 'info', 6000);
    expect(VexFun.why('sounds')).toMatch(/needs full/);
    P.setLevel('full');
    expect(VexFun.may('sounds')).toBe(true);
  });

  it('the living layers stop for Off but not for Calm', () => {
    globalThis.VexLiving = fresh('living-core.js').VexLiving;
    P.setLevel('calm');
    expect(VexLiving.readEnv().quietSwitch).toBe(false);
    P.setLevel('off');
    expect(VexLiving.readEnv().quietSwitch).toBe(true);
  });
});
