// VexMedals: catalogue integrity, the award engine, the vex:medal-signal
// contract, the toast queue and the "Unlock all medals" display switch.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');
let V;

beforeAll(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  globalThis.document = new EventTarget();
  globalThis.showToast = vi.fn();
  globalThis.VexIcons = require(path.join(JS, 'vex-icons.js')).VexIcons;
  globalThis.VexFeatures = require(path.join(JS, 'feature-catalog.js')).VexFeatures;
  require(path.join(JS, 'vex-medals.js'));
  V = globalThis.VexMedals;
  require(path.join(JS, 'vex-medals-catalog.js'));
});

beforeEach(() => {
  localStorage.clear();
  V._reset({ wipe: true });
  globalThis.showToast.mockClear();
  delete globalThis.GameSession;
});

const PICTO = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;

describe('catalogue integrity', () => {
  it('has at least 60 medals across the six groups', () => {
    expect(V.list().length).toBeGreaterThanOrEqual(60);
    for (const c of V.CATS) expect(V.list().filter(m => m.cat === c.id).length, c.id).toBeGreaterThanOrEqual(8);
    expect(V.CATS.length).toBe(6);
  });

  it('every id is unique and defining a duplicate throws', () => {
    const ids = V.list().map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => V.define({ id: ids[0], title: 'x', desc: 'y', tier: 'gold', art: { glyph: 'star' } })).toThrow();
  });

  it('every medal has a known tier, a real glyph, a name and art with an accessible name', () => {
    for (const m of V.list()) {
      expect(V.TIERS, m.id).toContain(m.tier);
      expect(V.glyphKnown(m.art.glyph), m.id + ' glyph ' + m.art.glyph).toBe(true);
      expect(m.title.length, m.id).toBeGreaterThan(1);
      expect(m.desc.length, m.id).toBeGreaterThan(1);
      const svg = V.artOf(m);
      expect(svg, m.id).toMatch(/^<svg /);
      expect(svg, m.id).toMatch(/role="img"/);
      expect(svg, m.id).toMatch(/aria-label="[^"]+"/);
      expect(svg, m.id).toContain('<title>');
      expect(V.artOf(m, { locked: true }), m.id).toMatch(/aria-label="Locked medal/);
    }
  });

  it('contains no emoji codepoints in any text or art', () => {
    for (const m of V.list()) {
      expect(PICTO.test([m.id, m.title, m.desc, m.hint || '', V.artOf(m)].join(' ')), m.id).toBe(false);
    }
    for (const a of V.AVATARS) expect(PICTO.test(V.avatarSvg(a.id) + a.name)).toBe(false);
  });

  it('no medal wording uses loss or fear-of-missing-out phrasing', () => {
    const bad = /\b(lose|lost|miss out|hurry|expire|running out|don't break|streak is at risk|penalt)/i;
    for (const m of V.list()) expect(bad.test(m.title + ' ' + m.desc + ' ' + (m.hint || '')), m.id).toBe(false);
  });

  it('every VexFeatures id a medal checks exists and can be seen as used', () => {
    const src = fs.readFileSync(path.join(JS, 'vex-medals-catalog.js'), 'utf8');
    const ids = [...src.matchAll(/feat\('([a-z0-9-]+)'\)/g)].map(x => x[1]);
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) {
      const it = globalThis.VexFeatures.ITEMS.find(i => i.id === id);
      expect(it, 'feature ' + id).toBeTruthy();
      expect(!!(it.cmd || it.panel), 'feature ' + id + ' has cmd or panel').toBe(true);
    }
  });

  it('draws every shape and tier', () => {
    for (const s of V.SHAPES) for (const t of V.TIERS) expect(V.art({ shape: s, tier: t, glyph: 'star', ribbon: 'red' })).toContain('</svg>');
  });
});

describe('award engine', () => {
  it('award is idempotent and fires one event', () => {
    const seen = [];
    document.addEventListener('vex:medal-awarded', (e) => seen.push(e.detail.id), { once: false });
    expect(V.award('first-bookmark')).toBe(true);
    expect(V.award('first-bookmark')).toBe(false);
    expect(V.has('first-bookmark')).toBe(true);
    expect(seen.filter(x => x === 'first-bookmark').length).toBe(1);
    expect(() => V.award('no-such-medal')).toThrow();
  });

  it('progress records and awards at the goal', () => {
    V.progress('commands-25', 10, 25);
    expect(V.progressOf('commands-25')).toEqual({ n: 10, of: 25 });
    expect(V.has('commands-25')).toBe(false);
    V.progress('commands-25', 25, 25);
    expect(V.has('commands-25')).toBe(true);
    expect(V.progressOf('commands-25')).toBe(null);
  });

  it('persists to vex.medals and reloads', () => {
    V.award('first-note');
    const raw = JSON.parse(localStorage.getItem('vex.medals'));
    expect(raw.earned['first-note']).toBeTruthy();
    V._reset();
    expect(V.has('first-note')).toBe(true);
  });

  it('the vex:medal-signal event awards and is idempotent', () => {
    const seen = [];
    document.addEventListener('vex:medal-awarded', (e) => seen.push(e.detail.id));
    const fire = (detail) => document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail }));
    fire({ id: 'brief-first' });
    fire({ id: 'brief-first' });
    fire({ id: 'not-a-medal' });
    fire({ id: 'workflow-10', n: 3, of: 10 });
    expect(V.has('brief-first')).toBe(true);
    expect(seen.filter(x => x === 'brief-first').length).toBe(1);
    expect(V.progressOf('workflow-10')).toEqual({ n: 3, of: 10 });
  });

  it('checks read real stored state', () => {
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ u: 1 }]));
    const got = V.evaluate();
    expect(got).toContain('first-bookmark');
    expect(V.has('bookmarks-10')).toBe(false);
    expect(V.progressOf('bookmarks-10')).toEqual({ n: 1, of: 10 });
  });

  it('a streak counts days of real actions', () => {
    const t = Date.now();
    V.markActiveDay(t); V.markActiveDay(t - 86400000); V.markActiveDay(t - 2 * 86400000);
    expect(V.streak()).toBe(3);
    V.evaluate();
    expect(V.has('days-3')).toBe(true);
  });
});

describe('medal toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows one toast for awards made in the same moment', () => {
    V.award('first-bookmark'); V.award('first-note');
    vi.advanceTimersByTime(1000);
    expect(globalThis.showToast).toHaveBeenCalledTimes(1);
  });

  it('holds toasts while a game runs and shows them after', () => {
    globalThis.GameSession = { active: true };
    V.award('first-bookmark');
    vi.advanceTimersByTime(2000);
    expect(globalThis.showToast).not.toHaveBeenCalled();
    expect(V.pendingToasts()).toBe(1);
    globalThis.GameSession.active = false;
    V.flush();
    expect(globalThis.showToast).toHaveBeenCalledTimes(1);
    expect(V.pendingToasts()).toBe(0);
  });
});

describe('Unlock all medals (display switch)', () => {
  it('round-trips without touching what was earned', () => {
    V.award('first-bookmark', { silent: true });
    V.award('first-note', { silent: true });
    V.progress('bookmarks-10', 4, 10);
    const before = localStorage.getItem('vex.medals');
    const lvBefore = V.levelInfo();

    V.setUnlockAll(true);
    expect(V.unlockAll()).toBe(true);
    expect(V.list().every(m => V.isShown(m.id))).toBe(true);
    // Earned stays the real record.
    expect(V.has('first-bookmark')).toBe(true);
    expect(V.has('completionist')).toBe(false);
    expect(V.has('days-30')).toBe(false);
    expect(V.stats().earned).toBe(2);
    expect(V.stats().shown).toBe(V.list().length);
    expect(V.levelInfo().xp).toBeGreaterThan(lvBefore.xp);
    expect(localStorage.getItem('vex.medals')).toBe(before);

    V.setUnlockAll(false);
    expect(V.unlockAll()).toBe(false);
    expect(V.isShown('days-30')).toBe(false);
    expect(V.isShown('first-note')).toBe(true);
    expect(V.progressOf('bookmarks-10')).toEqual({ n: 4, of: 10 });
    expect(V.levelInfo()).toEqual(lvBefore);
    expect(localStorage.getItem('vex.medals')).toBe(before);
  });

  it('is off by default', () => {
    expect(V.unlockAll()).toBe(false);
    expect(V.isShown('first-bookmark')).toBe(false);
  });

  it('causes no award events and no toasts, however many medals it shows', () => {
    const awarded = [];
    const on = (e) => awarded.push(e.detail.id);
    document.addEventListener('vex:medal-awarded', on);
    V.setUnlockAll(true);
    V.evaluate();
    V.setUnlockAll(false);
    document.removeEventListener('vex:medal-awarded', on);
    expect(awarded).toEqual([]);
    expect(globalThis.showToast).not.toHaveBeenCalled();
    expect(V.pendingToasts()).toBe(0);
  });

  it('a medal really earned while the switch is on is still recorded as earned', () => {
    V.setUnlockAll(true);
    expect(V.award('first-note', { silent: true })).toBe(true);
    V.setUnlockAll(false);
    expect(V.has('first-note')).toBe(true);
  });
});
