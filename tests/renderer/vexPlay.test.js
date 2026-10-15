// @vitest-environment jsdom
//
// Play: the optional playful features (js/vex-fun.js, vex-daily-word.js,
// vex-mini-games.js, vex-tab-tetris.js, vex-sounds.js). They are pure logic
// where it matters: the rules that gate them, the word score, the day's word
// and the streak, the Tetris layout, and when a sound may play.

import { describe, it, expect, beforeEach } from 'vitest';

const { VexFun } = require('../../src/renderer/js/vex-fun.js');
globalThis.VexFun = VexFun;
const { VexDailyWord } = require('../../src/renderer/js/vex-daily-word.js');
const { VexMiniGames } = require('../../src/renderer/js/vex-mini-games.js');
const { VexTabTetris } = require('../../src/renderer/js/vex-tab-tetris.js');
const { VexSounds } = require('../../src/renderer/js/vex-sounds.js');

beforeEach(() => { localStorage.clear(); delete globalThis.GameMode; delete globalThis.GameSession; });

describe('the shared rules', () => {
  it('is off until switched on', () => {
    expect(VexFun.flag('games')).toBe(false);
    expect(VexFun.why('word')).toBe('switched off');
    VexFun.setFlag('word', true);
    expect(VexFun.may('word')).toBe(true);
  });

  it('gate: quiet and Game mode each stop a feature that is on', () => {
    expect(VexFun.gate({ enabled: true })).toBe('');
    expect(VexFun.gate({ enabled: true, quiet: true })).toBe('quiet switch is on');
    expect(VexFun.gate({ enabled: true, gaming: true })).toBe('Game mode is on');
    expect(VexFun.gate({ enabled: false })).toBe('switched off');
  });

  it('is disabled while a game runs or a game session is open', () => {
    VexFun.setFlag('tetris', true);
    expect(VexFun.may('tetris')).toBe(true);
    globalThis.GameMode = { gaming: true };
    expect(VexFun.may('tetris')).toBe(false);
    globalThis.GameMode = { gaming: false };
    globalThis.GameSession = { active: true };
    expect(VexFun.why('tetris')).toBe('Game mode is on');
  });

  it('the quiet switch turns every feature off at once and keeps their own settings', () => {
    VexFun.setFlag('games', true); VexFun.setFlag('sounds', true);
    VexFun.setFlag('quiet', true);
    expect(VexFun.may('games')).toBe(false);
    expect(VexFun.may('sounds')).toBe(false);
    VexFun.setFlag('quiet', false);
    expect(VexFun.may('games')).toBe(true);
  });

  it('refuses an unknown switch', () => {
    expect(() => VexFun.flag('nope')).toThrow(/Unknown Play switch/);
  });

  it('a window cannot be opened for a feature that may not run', () => {
    expect(() => VexFun.open({ title: 'x', feature: 'games' })).toThrow(/switched off/);
  });

  it('dispatches a medal signal with the id', () => {
    let got = null;
    document.addEventListener('vex:medal-signal', (e) => { got = e.detail; }, { once: true });
    VexFun.medal('play.test');
    expect(got).toEqual({ id: 'play.test' });
  });

  it('dayKey is the local calendar day; hash and rng are stable', () => {
    expect(VexFun.dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(VexFun.hash('abc')).toBe(VexFun.hash('abc'));
    expect(VexFun.hash('abc')).not.toBe(VexFun.hash('abd'));
    const a = VexFun.rng(42), b = VexFun.rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('daily word', () => {
  it('the list is five lowercase letters each, with no repeats', () => {
    const w = VexDailyWord.WORDS;
    expect(w.length).toBeGreaterThan(300);
    expect(w.filter(x => !/^[a-z]{5}$/.test(x))).toEqual([]);
    expect(new Set(w).size).toBe(w.length);
  });

  it('scores hits, near and misses', () => {
    expect(VexDailyWord.score('crane', 'crane')).toEqual(['hit', 'hit', 'hit', 'hit', 'hit']);
    expect(VexDailyWord.score('slate', 'crane')).toEqual(['miss', 'miss', 'hit', 'miss', 'hit']);
    expect(VexDailyWord.score('nacre', 'crane')).toEqual(['near', 'near', 'near', 'near', 'hit']);
  });

  it('marks a repeated letter only as often as the answer holds it', () => {
    // answer has one E, and the last E (a hit) uses it up: the others are misses
    expect(VexDailyWord.score('eerie', 'crane')).toEqual(['miss', 'miss', 'near', 'miss', 'hit']);
    // a hit uses the letter up before a "near" can
    expect(VexDailyWord.score('lolly', 'world')).toEqual(['miss', 'hit', 'miss', 'hit', 'miss']);
  });

  it('letter states keep the best result', () => {
    const s = VexDailyWord.letterStates(['slate', 'crane'], 'crane');
    expect(s.a).toBe('hit');
    expect(s.s).toBe('miss');
    expect(s.c).toBe('hit');
  });

  it('a day has the same word everywhere and consecutive days differ', () => {
    const a = VexDailyWord.wordFor('2026-10-16');
    expect(VexDailyWord.wordFor('2026-10-16')).toBe(a);
    const week = new Set();
    for (let d = 1; d <= 14; d++) week.add(VexDailyWord.wordFor('2026-11-' + String(d).padStart(2, '0')));
    expect(week.size).toBe(14);
  });

  it('visits every word before any repeats (a full cycle is a permutation)', () => {
    const n = VexDailyWord.WORDS.length;
    const seen = new Set();
    const start = VexDailyWord.dayNumber('2026-01-01');
    for (let i = 0; i < n; i++) {
      const d = new Date((start + i) * 86400000);
      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      seen.add(VexDailyWord.wordFor(key));
    }
    expect(seen.size).toBe(n);
  });

  it('streak: grows on consecutive days, restarts quietly after a gap, never drops on a loss', () => {
    let s = VexDailyWord.afterResult({}, '2026-10-10', true);
    expect(s.streak).toBe(1);
    s = VexDailyWord.afterResult(s, '2026-10-11', true);
    expect(s.streak).toBe(2);
    const kept = VexDailyWord.afterResult(s, '2026-10-12', false);
    expect(kept.streak).toBe(2);              // a loss changes nothing
    expect(VexDailyWord.afterResult(s, '2026-10-11', true).streak).toBe(2);   // same day twice adds nothing
    const gap = VexDailyWord.afterResult(s, '2026-10-20', true);
    expect(gap.streak).toBe(1);
    expect(gap.best).toBe(2);                 // the best is never lost
  });

  it('a year boundary and a month boundary count as the next day', () => {
    expect(VexDailyWord.previousDay('2027-01-01')).toBe('2026-12-31');
    expect(VexDailyWord.previousDay('2026-03-01')).toBe('2026-02-28');
  });

  it('plays a day: keeps guesses, finishes on the answer, and stores the streak', () => {
    const now = new Date(2026, 9, 16, 10, 0);
    const answer = VexDailyWord.wordFor('2026-10-16');
    expect(() => VexDailyWord.guess('abc', now)).toThrow(/five letters/);
    const wrong = VexDailyWord.WORDS.find(w => w !== answer);
    VexDailyWord.guess(wrong, now);
    expect(() => VexDailyWord.guess(wrong, now)).toThrow(/already tried/);
    const r = VexDailyWord.guess(answer, now);
    expect(r.board.done).toBe(true);
    expect(r.board.won).toBe(true);
    expect(r.state.streak).toBe(1);
    expect(() => VexDailyWord.guess('crane', now)).toThrow(/finished/);
    // the next day starts empty and keeps the streak
    const next = VexDailyWord.today(new Date(2026, 9, 17, 9, 0));
    expect(next.board.guesses).toEqual([]);
    expect(next.state.streak).toBe(1);
  });

  it('six wrong guesses end the day without touching the streak', () => {
    const now = new Date(2026, 9, 16, 10, 0);
    const answer = VexDailyWord.wordFor('2026-10-16');
    const wrongs = VexDailyWord.WORDS.filter(w => w !== answer).slice(0, 6);
    let r;
    for (const w of wrongs) r = VexDailyWord.guess(w, now);
    expect(r.board.done).toBe(true);
    expect(r.board.won).toBe(false);
    expect(r.answer).toBe(answer);
    expect(r.state.streak || 0).toBe(0);
  });
});

describe('mini games', () => {
  it('knows which load errors mean "could not reach it"', () => {
    expect(VexMiniGames.isOfflineCode(-106)).toBe(true);    // offline
    expect(VexMiniGames.isOfflineCode(-105)).toBe(true);    // no such name
    expect(VexMiniGames.isOfflineCode(-3)).toBe(false);     // replaced by another load
    expect(VexMiniGames.isOfflineCode(-202)).toBe(false);   // a certificate error
  });

  it('runner: gravity brings the player back and a block in the way ends the run', () => {
    const rng = () => 0.5;
    const s = VexMiniGames.runnerStart();
    VexMiniGames.runnerStep(s, 0.016, true, rng);
    expect(s.y).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) VexMiniGames.runnerStep(s, 0.016, false, () => 0.99);
    // with nothing jumping, a block reaches the player at some point
    expect(s.over).toBe(true);
  });

  it('runner: a jump clears a low block', () => {
    const s = VexMiniGames.runnerStart();
    s.obstacles = [{ x: 60, w: 16, h: 22 }];
    s.y = 60; s.vy = 0;                      // already high in the air above it
    VexMiniGames.runnerStep(s, 0.001, false, () => 0.5);
    expect(s.over).toBe(false);
  });

  it('Lights Out: a press flips the cell and its neighbours, twice puts it back', () => {
    const empty = new Array(25).fill(false);
    const once = VexMiniGames.lightsPress(empty, 12, 5);
    expect(once.filter(Boolean).length).toBe(5);
    expect(VexMiniGames.lightsPress(once, 12, 5)).toEqual(empty);
    const corner = VexMiniGames.lightsPress(empty, 0, 5);
    expect(corner.filter(Boolean).length).toBe(3);
  });

  it('Lights Out puzzles always have a solution and are never already solved', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { board, presses } = VexMiniGames.lightsMake(seed, 5);
      expect(VexMiniGames.lightsSolved(board)).toBe(false);
      let b = board;
      for (const p of presses) b = VexMiniGames.lightsPress(b, p, 5);
      // undoing the presses (in any order) restores the empty board, unless the
      // never-solved guard pressed an extra cell
      if (!VexMiniGames.lightsSolved(b)) b = VexMiniGames.lightsPress(b, 12, 5);
      expect(VexMiniGames.lightsSolved(b)).toBe(true);
    }
  });

  it('scramble changes the word and keeps its letters', () => {
    for (let seed = 1; seed < 30; seed++) {
      const out = VexMiniGames.scrambleWord('apple', seed);
      expect(out).not.toBe('apple');
      expect([...out].sort().join('')).toBe('aelpp');
    }
  });
});

describe('tab tetris layout', () => {
  const tabs = [
    { id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g1' },
    { id: 'c', groupId: null }, { id: 'd', groupId: 'g2' }, { id: 'e', groupId: null },
  ];
  const groups = [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }];

  it('places every tab once, inside the board, with no overlap', () => {
    const lay = VexTabTetris.layout(tabs, groups, 5);
    expect(lay.blocks.map(b => b.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const cells = new Set();
    for (const b of lay.blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(5);
      for (let dx = 0; dx < b.w; dx++) for (let dy = 0; dy < b.h; dy++) {
        const k = (b.x + dx) + ',' + (b.y + dy);
        expect(cells.has(k)).toBe(false);
        cells.add(k);
      }
    }
  });

  it('keeps each group together, below its own label row, loose tabs last', () => {
    const lay = VexTabTetris.layout(tabs, groups, 5);
    expect(lay.clusters.map(c => c.groupId)).toEqual(['g1', 'g2', null]);
    for (const c of lay.clusters) {
      for (const id of c.ids) {
        const b = lay.blocks.find(x => x.id === id);
        expect(b.y).toBeGreaterThanOrEqual(c.top);
        expect(b.y + b.h).toBeLessThanOrEqual(c.bottom);
      }
    }
    expect(lay.clusters[1].labelRow).toBeGreaterThanOrEqual(lay.clusters[0].bottom);
  });

  it('an empty group has no cluster and an empty window has no rows', () => {
    expect(VexTabTetris.layout([], groups, 4).rows).toBe(0);
    expect(VexTabTetris.layout([{ id: 'x', groupId: null }], groups, 4).clusters.length).toBe(1);
  });

  it('a tab keeps its shape from one opening to the next', () => {
    const a = VexTabTetris.layout(tabs, groups, 6).blocks;
    const b = VexTabTetris.layout(tabs, groups, 6).blocks;
    expect(a).toEqual(b);
  });

  it('tidy plan: loose tabs on one site, two or more, grouped by that site', () => {
    const t = [
      { id: '1', groupId: null, url: 'https://a.com/1' }, { id: '2', groupId: null, url: 'https://www.a.com/2' },
      { id: '3', groupId: null, url: 'https://b.com' }, { id: '4', groupId: 'g', url: 'https://c.com' }, { id: '5', groupId: null, url: 'https://c.com/x' },
    ];
    const host = (x) => new URL(x.url).hostname.replace(/^www\./, '');
    expect(VexTabTetris.tidyPlan(t, host)).toEqual([{ host: 'a.com', ids: ['1', '2'] }]);
  });
});

describe('sounds', () => {
  const base = { name: 'medal', enabled: true, quiet: false, gaming: false, volume: 0.5, hours: { enabled: false }, now: new Date(2026, 9, 16, 12, 0) };

  it('plays only when on, not quiet, not gaming, with volume', () => {
    expect(VexSounds.decide(base)).toBe('');
    expect(VexSounds.decide({ ...base, enabled: false })).toBe('sounds are off');
    expect(VexSounds.decide({ ...base, quiet: true })).toBe('quiet switch is on');
    expect(VexSounds.decide({ ...base, gaming: true })).toBe('Game mode is on');
    expect(VexSounds.decide({ ...base, volume: 0 })).toBe('volume is zero');
    expect(VexSounds.decide({ ...base, name: 'nope' })).toBe('unknown sound');
  });

  it('Game mode and the quiet switch beat even a preview', () => {
    expect(VexSounds.decide({ ...base, enabled: false, preview: true })).toBe('');
    expect(VexSounds.decide({ ...base, preview: true, gaming: true })).toBe('Game mode is on');
    expect(VexSounds.decide({ ...base, preview: true, quiet: true })).toBe('quiet switch is on');
  });

  it('quiet hours, including a range that crosses midnight', () => {
    const hours = { enabled: true, from: '22:00', to: '08:00' };
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 23, 30), hours)).toBe(true);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 3, 0), hours)).toBe(true);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 8, 0), hours)).toBe(false);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 12, 0), hours)).toBe(false);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 12, 0), { ...hours, enabled: false })).toBe(false);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 12, 0), { enabled: true, from: '09:00', to: '17:00' })).toBe(true);
    expect(VexSounds.inQuietHours(new Date(2026, 9, 16, 12, 0), { enabled: true, from: '10:00', to: '10:00' })).toBe(false);
  });

  it('blocks a sound inside quiet hours', () => {
    const hours = { enabled: true, from: '22:00', to: '08:00' };
    expect(VexSounds.decide({ ...base, hours, now: new Date(2026, 9, 16, 23, 0) })).toBe('quiet hours');
  });

  it('every sound has notes in every pack, short and in range', () => {
    for (const name of VexSounds.NAMES) for (const pack of Object.keys(VexSounds.PACKS)) {
      const notes = VexSounds.notesFor(name, pack);
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.f).toBeGreaterThan(100);
        expect(n.f).toBeLessThan(4000);
        expect(n.t + n.d).toBeLessThan(2);
      }
    }
  });

  it('play refuses quietly when off and never touches WebAudio', () => {
    let made = 0;
    window.AudioContext = function () { made++; };
    expect(VexSounds.play('medal')).toBe(false);
    expect(VexSounds.lastReason).toBe('sounds are off');
    expect(made).toBe(0);
    expect(() => VexSounds.play('unknown')).toThrow(/Unknown sound/);
  });

  it('saved volume, pack and hours are validated', () => {
    expect(VexSounds.volume()).toBe(0.4);
    VexSounds.setVolume(0.8);
    expect(VexSounds.volume()).toBe(0.8);
    expect(() => VexSounds.setVolume(2)).toThrow();
    expect(() => VexSounds.setPack('nope')).toThrow();
    expect(() => VexSounds.setHours({ from: '99:00' })).toThrow();
    VexSounds.setHours({ from: '21:30' });
    expect(VexSounds.hours().from).toBe('21:30');
  });
});
