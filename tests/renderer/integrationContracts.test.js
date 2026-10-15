// @vitest-environment jsdom
//
// The contracts between the 2026-10 feature modules: one medal ledger that every
// signal reaches, one name for the "a medal was earned" event, one level on the
// profile page, one quiet switch, and one rate gate for unsolicited toasts.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');

const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let V;

function loadMedals() {
  vi.resetModules();
  localStorage.clear();
  delete globalThis.VexMedals;
  globalThis.VexIcons = fresh('vex-icons.js').VexIcons;
  globalThis.VexFeatures = fresh('feature-catalog.js').VexFeatures;
  fresh('vex-medals.js');
  V = globalThis.VexMedals;
  V._reset({ wipe: true });
  fresh('vex-medals-catalog.js');
}

beforeEach(() => { loadMedals(); });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory()
    ? walk(path.join(dir, e.name))
    : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])));
}

describe('one medal ledger', () => {
  it('every medal id any module signals or unlocks against resolves to a catalogue medal', () => {
    const ids = new Map();
    const note = (id, f) => { if (/^[a-z][a-z0-9.-]*[a-z0-9]$/.test(id)) (ids.get(id) || ids.set(id, new Set()).get(id)).add(path.basename(f)); };
    for (const f of walk(JS)) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/(?:\bmedal|\bsignal|VexProgress\.medal|VexFun\.medal)\(\s*'([a-z][a-z0-9.-]*)'/g)) note(m[1], f);
      for (const m of s.matchAll(/vex:medal-signal'[^;]*?\{\s*id:\s*'([a-z][a-z0-9.-]*)'/g)) note(m[1], f);
      for (const m of s.matchAll(/unlock:\s*\{\s*medal:\s*'([a-z][a-z0-9.-]*)'/g)) note(m[1], f);
    }
    // discovery-<n> is built from the milestones.
    for (const n of [10, 25, 50]) note('discovery-' + n, 'discovery-log.js');
    const missing = [...ids.keys()].filter(id => !V.get(id));
    expect(missing, 'signals with no medal: ' + missing.join(', ')).toEqual([]);
    expect(V.unmapped()).toEqual([]);
  });

  it('a dotted play id and a cosmetic id reach the same medal as the catalogue id', () => {
    expect(V.canon('play.tetris.cleared')).toBe('play-tetris-cleared');
    expect(V.canon('first-focus')).toBe('focus-first');
    document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'play.mini.runner' } }));
    expect(V.has('play-mini-runner')).toBe(true);
    expect(V.has('play.mini.runner')).toBe(true);
  });

  it('a signal nobody defined is remembered, not silently dropped', () => {
    document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'no-such-medal' } }));
    expect(V.unmapped()).toContain('no-such-medal');
  });

  it('an award is announced under both event names', () => {
    const seen = [];
    document.addEventListener('vex:medal-awarded', e => seen.push('awarded:' + e.detail.id));
    document.addEventListener('vex:medal-earned', e => seen.push('earned:' + e.detail.id));
    V.award('brief-first', { silent: true });
    expect(seen).toEqual(['awarded:brief-first', 'earned:brief-first']);
  });
});

describe('one level', () => {
  it('points from Browser levels raise the level the profile shows', () => {
    const { VexProgress } = fresh('fun/fun-core.js');
    globalThis.VexProgress = VexProgress;
    const { VexLevels } = fresh('fun/levels.js');
    VexProgress.setEnabled('levels', true);
    const before = V.levelInfo();
    VexLevels.award('inbox-cleared');
    const after = V.levelInfo();
    expect(after.xp).toBe(before.xp + 30);
    const snap = VexLevels.snapshot();
    expect(snap.level).toBe(after.level);
    expect(snap.xp).toBe(after.xp);
    expect(snap.into).toBe(after.into);
  });
});

describe('one quiet switch', () => {
  it('vex.fun.quiet silences Play, Progress, Living, Expression and the toast gate', () => {
    const { VexProgress } = fresh('fun/fun-core.js');
    const { VexLiving } = fresh('living-core.js');
    globalThis.VexLiving = VexLiving;
    const { VexAttention } = fresh('vex-attention.js');
    VexAttention.reset();
    expect(VexProgress.silenced()).toBe(false);
    expect(VexLiving.readEnv().quietSwitch).toBe(false);
    localStorage.setItem('vex.fun.quiet', '1');
    expect(VexProgress.silenced()).toBe(true);
    expect(VexProgress.live('pet')).toBe(false);
    const env = VexLiving.readEnv();
    expect(env.quietSwitch).toBe(true);
    expect(VexLiving.quietReason(env)).toBe('quiet-switch');
    expect(VexLiving.isHardStop('quiet-switch')).toBe(true);
    expect(VexAttention.gate('x', '1')).toBe(false);
    const { VexExpression } = fresh('vex-expression.js');
    expect(VexExpression.gaming()).toBe(true);
  });
});

describe('toast rate gate', () => {
  it('lets three through a minute, never the same one twice, and nothing while quiet', () => {
    const { VexAttention } = fresh('vex-attention.js');
    VexAttention.reset();
    let now = 1000000;
    VexAttention._now = () => now;
    expect(VexAttention.gate('a', '1')).toBe(true);
    expect(VexAttention.gate('a', '1')).toBe(false);          // repeat
    expect(VexAttention.gate('a', '2')).toBe(true);
    expect(VexAttention.gate('b', '1')).toBe(true);
    expect(VexAttention.gate('c', '1')).toBe(false);          // fourth in the minute
    now += 61 * 1000;
    expect(VexAttention.gate('c', '1')).toBe(true);           // a new minute
    now += 11 * 60 * 1000;
    expect(VexAttention.gate('a', '1')).toBe(true);           // repeat window over
    expect(() => VexAttention.gate('', '1')).toThrow();
  });
});
