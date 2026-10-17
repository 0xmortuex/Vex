// @vitest-environment jsdom
//
// T2-004: caps and retention for the journal, ledger, game log, timeline, capture log, caches and AI memory.
// Warn first, trim oldest first after a grace period, never a curated list by itself, every trim undoable.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { StorageCeilings: S } = require('../../src/renderer/js/storage-ceilings.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const get = (k) => JSON.parse(localStorage.getItem(k));
let inbox;

beforeEach(() => {
  localStorage.clear();
  inbox = [];
  globalThis.VexAttention = { suggest: vi.fn((row) => { inbox.push(row); return true; }) };
  delete globalThis.VexLedger;
  delete globalThis.AIMemory;
});

describe('policies', () => {
  it('cover the journal, ledger, game log, timeline, captures, a cache and AI memory', () => {
    expect(S.policies().map(p => p.id)).toEqual(['journal', 'ledger', 'game-log', 'timeline', 'captures', 'digest-cache', 'ai-memory']);
    for (const p of S.policies().filter(x => !x.curated)) expect(p.retainDays).toBe(90);
    expect(S.policies().find(p => p.id === 'ai-memory').curated).toBe(true);
  });
  it('refuse a limit outside the range', () => {
    expect(() => S.setPolicy('game-log', { maxKB: 1 })).toThrow(/between 16 and 20480/);
    expect(() => S.setPolicy('game-log', { retainDays: 3 })).toThrow(/Days kept/);
    expect(S.setPolicy('game-log', { retainDays: 30, maxKB: 64 })).toEqual({ retainDays: 30, maxKB: 64 });
    expect(S.policies().find(p => p.id === 'game-log')).toMatchObject({ retainDays: 30, maxKB: 64 });
  });
});

describe('plan: oldest first, by age then by size', () => {
  it('drops entries older than the retention', () => {
    put('vex.gameLog', [{ start: NOW - 200 * DAY }, { start: NOW - 100 * DAY }, { start: NOW - 5 * DAY }]);
    const pl = S.plan('game-log', NOW);
    expect(pl.dropAge).toBe(2);
    expect(pl.keep).toEqual([2]);
  });
  it('then drops the oldest of the rest until the size is under the cap', () => {
    const big = (i) => ({ start: NOW - i * DAY, text: 'x'.repeat(20000) });
    put('vex.gameLog', [big(1), big(2), big(3), big(4), big(5), big(6), big(7), big(8), big(9), big(10), big(11), big(12), big(13), big(14)]);
    const pl = S.plan('game-log', NOW);              // 14 x 20 KB against a 256 KB cap
    expect(pl.dropSize).toBeGreaterThan(0);
    expect(pl.drop[0]).toBe(13);                     // the oldest (index 13, 14 days back) goes first
    expect(pl.keep.length * 20000).toBeLessThanOrEqual(256 * 1024 + 20000);
  });
  it('keeps at least the newest entry whatever the cap', () => {
    S.setPolicy('game-log', { maxKB: 16 });
    put('vex.gameLog', [{ start: NOW - DAY, text: 'x'.repeat(60000) }]);
    expect(S.plan('game-log', NOW).drop).toEqual([]);
  });
  it('works on a map (journal by day, cache by .at) and a wrapped list (ledger entries)', () => {
    put('vex.journal', { '2026-01-02': { text: 'old' }, '2026-10-16': { text: 'new' } });
    expect(S.plan('journal', NOW).drop).toEqual(['2026-01-02']);
    put('vex.readingDigestCache', { 'https://a': { at: NOW - 300 * DAY }, 'https://b': { at: NOW - DAY } });
    expect(S.plan('digest-cache', NOW).drop).toEqual(['https://a']);
  });
  it('an item with no time is never dropped for its age', () => {
    put('vex.timeline.log', [{ x: 1 }, { t: NOW - 200 * DAY }]);
    expect(S.plan('timeline', NOW).drop).toEqual([1]);
  });
  it('a feature that stored nothing has nothing to trim; an unreadable one raises instead of being cleared', () => {
    expect(S.plan('captures', NOW).drop).toEqual([]);
    localStorage.setItem('vex.captureLog', '{not json');
    expect(() => S.plan('captures', NOW)).toThrow(/not readable and was left as it is/);
    expect(localStorage.getItem('vex.captureLog')).toBe('{not json');
  });
});

describe('review: warn, wait, trim', () => {
  beforeEach(() => { put('vex.gameLog', [{ start: NOW - 200 * DAY }, { start: NOW - DAY }]); });
  it('the first pass warns and removes nothing', () => {
    expect(S.review(NOW)).toEqual({ warned: ['game-log'], trimmed: [] });
    expect(get('vex.gameLog')).toHaveLength(2);
    expect(inbox[0]).toMatchObject({ feature: 'storage-retention', action: { key: 'trim:game-log', label: 'Trim now' } });
    expect(inbox[0].body).toMatch(/1 older than 90 days would be removed, oldest first, in 3 days/);
  });
  it('a pass inside the grace period still removes nothing, and does not warn again', () => {
    S.review(NOW);
    expect(S.review(NOW + 2 * DAY)).toEqual({ warned: [], trimmed: [] });
    expect(globalThis.VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(get('vex.gameLog')).toHaveLength(2);
  });
  it('after the grace period the oldest go, the rest stays, and the removed part is kept for Undo', () => {
    S.review(NOW);
    const r = S.review(NOW + 4 * DAY);
    expect(r.trimmed).toEqual(['game-log']);
    expect(get('vex.gameLog')).toEqual([{ start: NOW - DAY }]);
    expect(get('vex.storage.trimmed')['game-log'].items).toHaveLength(1);
    expect(S.undoTrim('game-log')).toBe(1);
    expect(get('vex.gameLog').map(x => x.start)).toEqual([NOW - 200 * DAY, NOW - DAY]);
    expect(get('vex.storage.trimmed')['game-log']).toBeUndefined();
  });
  it('Keep stops the review for 30 days', () => {
    S.review(NOW);
    S.keepFor('game-log', 30, NOW);
    expect(S.review(NOW + 4 * DAY)).toEqual({ warned: [], trimmed: [] });
    expect(get('vex.gameLog')).toHaveLength(2);
  });
  it('does nothing while the retention switch is off', () => {
    S.setRetentionEnabled(false);
    expect(S.review(NOW)).toEqual({ warned: [], trimmed: [] });
    expect(globalThis.VexAttention.suggest).not.toHaveBeenCalled();
  });
  it('trim now (the person asked) removes at once', () => {
    const r = S.trim('game-log', NOW);
    expect(r).toMatchObject({ dropped: 1, undoable: true });
    expect(get('vex.gameLog')).toHaveLength(1);
  });
  it('writes the ledger line with an undo token', () => {
    globalThis.VexLedger = { note: vi.fn() };
    S.trim('game-log', NOW);
    expect(globalThis.VexLedger.note).toHaveBeenCalledWith(expect.objectContaining({ feature: 'storage-retention', undo: { kind: 'storage-trim', id: 'game-log' } }));
  });
  it('a removal too big to keep has no undo and says so', () => {
    put('vex.gameLog', [{ start: NOW - 200 * DAY, text: 'x'.repeat(300000) }, { start: NOW - DAY }]);
    globalThis.VexLedger = { note: vi.fn() };
    expect(S.trim('game-log', NOW).undoable).toBe(false);
    expect(globalThis.VexLedger.note.mock.calls[0][0].undo).toBeUndefined();
    expect(() => S.undoTrim('game-log')).toThrow(/nothing kept/);
  });
});

describe('a curated list', () => {
  it('AI memory is warned about but never trimmed by a review, only by Trim now', () => {
    globalThis.AIMemory = { data: { facts: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, text: 'y'.repeat(20000), at: NOW - i * DAY })) }, save: vi.fn() };
    expect(S.review(NOW).warned).toEqual(['ai-memory']);
    expect(S.review(NOW + 10 * DAY)).toEqual({ warned: [], trimmed: [] });
    expect(AIMemory.data.facts).toHaveLength(20);
    const r = S.trim('ai-memory', NOW);
    expect(r.dropped).toBeGreaterThan(0);
    expect(AIMemory.save).toHaveBeenCalled();
    expect(AIMemory.data.facts.length).toBe(20 - r.dropped);
    expect(AIMemory.data.facts[0].id).toBe('m0');         // the newest stay
  });
});

describe('wiring', () => {
  it('the ledger list is trimmed through the ledger so its memory copy stays right', () => {
    const entries = [{ id: 1, at: NOW - 300 * DAY, feature: 'f', what: 'w', why: 'y' }, { id: 2, at: NOW - DAY, feature: 'f', what: 'w', why: 'y' }];
    globalThis.VexLedger = { _entries: entries, _load() { return this._entries; }, _save: vi.fn(() => true), _emit: vi.fn(), note: vi.fn() };
    S.trim('ledger', NOW);
    expect(VexLedger._entries.map(e => e.id)).toEqual([2]);
    expect(VexLedger._save).toHaveBeenCalled();
  });
  it('the manifest, usage row and Settings control exist', () => {
    const fs = require('fs'), path = require('path');
    const js = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', f), 'utf8');
    expect(js('feature-manifests.js')).toMatch(/id: 'storage-retention'[\s\S]{0,200}maturity: 'new'/);
    expect(js('vex-usage-registry.js')).toMatch(/\['storage-retention', A\.api\(G\.StorageCeilings, 'retentionEnabled', 'setRetentionEnabled'\)\]/);
    expect(js('storage-ceilings.js')).toMatch(/Remove the oldest entries of a feature once it stays over its limit/);
  });
});
