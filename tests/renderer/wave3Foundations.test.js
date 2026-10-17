// @vitest-environment jsdom
//
// Wave 3 foundations: provenance chip (T3-107), dry-run preview (T3-051), diagnostics bundle (T3-012),
// storage ledger (T3-082), shared search index (T3-108), usage counters (T3-083), progressive
// disclosure (T3-067), feature sheet (T3-091), Your data (T3-099), intent search (T3-078).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const JS = '../../src/renderer/js/';
const ROOT = path.resolve(__dirname, '../..');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

function boot() {
  localStorage.clear();
  vi.resetModules();
  delete window.__vexUsageQueue;
  globalThis.VexTr = fresh(JS + 'vex-tr.js').VexTr;
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  fresh(JS + 'feature-manifests.js');
}
beforeEach(boot);

describe('provenance chip', () => {
  it('requires a source and says what made the text', () => {
    const { VexProvenance: P } = fresh(JS + 'provenance-chip.js');
    expect(() => P.chip()).toThrow(/needs a source/);
    expect(() => P.chip({ kind: 'magic' })).toThrow(/"ai", "local" or "rule"/);
    expect(P.label({ kind: 'local', model: 'llama3.2:3b' })).toBe('Local AI \u00b7 llama3.2:3b');
    expect(P.label({ kind: 'rule', model: 'ignored' })).toBe('Rule');
    expect(P.label(P.fromResult({ backend: 'cloud', model: 'claude' }))).toBe('Vex AI \u00b7 claude');
    expect(() => P.fromResult({ result: 'x' })).toThrow(/does not say which backend/);
    const el = P.chip({ kind: 'ai', model: 'm', read: 'your mail subjects' });
    expect(el.getAttribute('role')).toBe('note');
    expect(el.title).toMatch(/from your mail subjects/);
    const host = document.createElement('div');
    P.attach(host, { kind: 'rule' }); P.attach(host, { kind: 'rule' });
    expect(host.querySelectorAll('.vex-prov-chip').length).toBe(1);
    expect(P.html({ kind: 'local', model: '<b>' })).not.toContain('<b>');
  });
});

describe('dry-run preview', () => {
  it('validates its input and counts what is ticked', () => {
    const { VexPlan: V } = fresh(JS + 'plan-preview.js');
    expect(() => V.validate({ title: 'x', items: [{ id: 'a' }, { id: 'a' }] })).toThrow(/share the id/);
    expect(() => V.validate({ items: [] })).toThrow(/needs a title/);
    expect(V.chosen([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['c', 'a']))).toEqual(['a', 'c']);
    expect(V.countLine(1, 'tab')).toBe('This will do 1 tab.');
    expect(V.countLine(0)).toBe('Nothing is ticked.');
  });

  it('answers ok with the ticked ids and the snapshot; cancel answers not ok', async () => {
    globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
    const { VexPlan: V } = fresh(JS + 'plan-preview.js');
    const snap = vi.fn(async (ids) => ({ saved: ids }));
    const p = V.confirm({ title: 'Tidy', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], okLabel: 'Go', snapshot: snap });
    const boxes = document.querySelectorAll('#vex-plan-preview input[type=checkbox]');
    expect(boxes.length).toBe(2);
    boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change'));
    expect(document.querySelector('#vex-plan-preview [role=status]').textContent).toBe('This will do 1 thing.');
    [...document.querySelectorAll('#vex-plan-preview button')].find(b => b.textContent === 'Go').click();
    expect(await p).toEqual({ ok: true, chosen: ['a'], snapshot: { saved: ['a'] } });
    const q = V.confirm({ title: 'Tidy', items: [{ id: 'a', label: 'A' }] });
    [...document.querySelectorAll('#vex-plan-preview button')].find(b => b.textContent === 'Not now').click();
    expect(await q).toEqual({ ok: false });
  });

  it('does not run when its safety copy cannot be made', async () => {
    globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
    const { VexPlan: V } = fresh(JS + 'plan-preview.js');
    const p = V.confirm({ title: 'Tidy', items: [{ id: 'a', label: 'A' }], okLabel: 'Go', snapshot: async () => { throw new Error('disk full'); } });
    [...document.querySelectorAll('#vex-plan-preview button')].find(b => b.textContent === 'Go').click();
    await expect(p).rejects.toThrow(/Nothing was changed.*disk full/);
  });
});

describe('diagnostics bundle', () => {
  it('holds the facts and none of the addresses, secrets or ledger words', () => {
    globalThis.VexReport = fresh(JS + 'report-problem.js').VexReport;
    const { VexDiagBundle: D } = fresh(JS + 'diagnostics-bundle.js');
    const text = D.build({
      now: Date.UTC(2026, 9, 16, 12, 0),
      env: { version: '9.9.9', electron: '42', chrome: '148', os: '10.0.26300', arch: 'x64', look: 'firefox', theme: 'dark', tier: 'standard', bootFails: 0 },
      features: [{ id: 'a', running: true, on: false, maturity: 'new' }, { id: 'b', running: true, on: true, maturity: 'stable', tripped: true }],
      jobs: [{ name: 'Slow job', feature: 'a', runs: 3, totalMs: 900, maxMs: 400, held: 1 }],
      ledger: [{ at: 1, feature: 'tab-cleanup', what: 'Closed https://bank.example/secret?token=abc123', undo: { kind: 'x' }, undone: false }],
      problems: [{ at: 2, area: 'Mail', message: 'Could not open https://mail.example/inbox?sid=zzz for C:\\Users\\Fadi\\x', n: 2 }],
      crashes: [{ at: 3, kind: 'gpu', detail: 'at file:///C:/Users/Fadi/a.js', version: '9.9.8' }],
      storage: [{ owner: 'Notes', bytes: 20480, keys: 2 }],
    });
    expect(text).toContain('Version: 9.9.9');
    expect(text).toContain('Slow job [a]: 3 runs');
    expect(text).toContain('Switched off after failing: b');
    expect(text).toContain('tab-cleanup (can be undone)');
    expect(text).toContain('Notes: 20 KB in 2 keys');
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('bank.example');
    expect(text).not.toContain('Fadi');
  });

  it('refuses to build without the scrubber rather than leak', () => {
    delete globalThis.VexReport;
    const { VexDiagBundle: D } = fresh(JS + 'diagnostics-bundle.js');
    expect(() => D.build({ env: { version: '1' } })).toThrow(/scrubber/);
  });
});

describe('storage ledger', () => {
  it('names the owner of each key, adds up per feature and holds a feature back from sync', () => {
    globalThis.SyncEngine = { SYNC_KEYS: ['vex.notes', 'vex.bookmarks'] };
    const { VexStorageLedger: L } = fresh(JS + 'storage-ledger.js');
    localStorage.setItem('vex.notes', 'x'.repeat(100));
    localStorage.setItem('vex.bookmarks', '[]');
    localStorage.setItem('vex.ledger', '[]');
    const rows = L.rows();
    expect(rows.find(r => r.key === 'vex.notes').owner).toBe('library-data');
    expect(L.scopeOf('vex.notes')).toBe('default');
    expect(L.scopeOf('vex.ledger')).toBe('never');
    const owners = L.byOwner();
    expect(owners[0].owner).toBe('library-data');
    expect(owners[0].bytes).toBe((100 + 2) * 2);
    expect(L.syncAllowed('vex.notes')).toBe(true);
    L.setNever('library-data', true);
    expect(L.syncAllowed('vex.notes')).toBe(false);
    expect(L.syncAllowed('vex.bookmarks')).toBe(false);
    expect(L.scopeOf('vex.notes')).toBe('never');
    L.setNever('library-data', false);
    expect(L.syncAllowed('vex.notes')).toBe(true);
    delete globalThis.SyncEngine;
  });

  it('warns once a day at 80 percent through the Attention Inbox', () => {
    const { VexStorageLedger: L } = fresh(JS + 'storage-ledger.js');
    localStorage.setItem('vex.notes', 'x'.repeat(4_100_000));
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    expect(L.quota().warn).toBe(true);
    L.checkQuota(); L.checkQuota();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0].title).toMatch(/% full/);
    delete globalThis.VexAttention;
  });
});

describe('shared search index', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: 'i' + i, type: 'note', title: 'Note ' + i + (i % 3 === 0 ? ' boiler' : ''), subtitle: '', body: 'body text ' + i + ' İstanbul' }));

  it('names candidates that contain every gram, folded, and nothing else', () => {
    const { create } = fresh(JS + 'search-index.js');
    const idx = create({ capBytes: 8 * 1024 * 1024 });
    idx.replace('n', items(30), 's1');
    const c = idx.candidates('n', ['boiler']);
    expect(c.map(i => i.id).sort()).toEqual(['i0', 'i12', 'i15', 'i18', 'i21', 'i24', 'i27', 'i3', 'i6', 'i9']);
    expect(idx.candidates('n', ['istanbul']).length).toBe(30);       // "İstanbul" folds to "istanbul"
    expect(idx.candidates('n', ['zzzz'])).toEqual([]);
    expect(idx.candidates('n', ['no']).length).toBe(30);             // shorter than a gram: the whole source
    expect(idx.candidates('missing', ['x'])).toBe(null);
  });

  it('updates one item at a time and knows when a source is current', () => {
    const { create } = fresh(JS + 'search-index.js');
    const idx = create();
    idx.replace('n', items(3), 'a');
    expect(idx.isCurrent('n', 'a')).toBe(true);
    idx.upsert('n', { id: 'new', type: 'note', title: 'zebra crossing', body: '' });
    expect(idx.candidates('n', ['zebra']).map(i => i.id)).toEqual(['new']);
    expect(idx.isCurrent('n', 'a')).toBe(false);
    idx.remove('n', 'new');
    expect(idx.candidates('n', ['zebra'])).toEqual([]);
  });

  it('drops the source used longest ago when over the cap, and reports it as not indexed', () => {
    let t = 0;
    const { create } = fresh(JS + 'search-index.js');
    const big = items(40);
    const probe = create({ capBytes: 1e9 });
    probe.replace('a', big, '1');
    const one = probe.stats().bytes;
    const alone = create({ capBytes: Math.floor(one / 2), now: () => ++t });
    expect(alone.replace('a', big, '1')).toBe(false);          // alone and over the cap: dropped
    const idx = create({ capBytes: Math.floor(one * 1.5), now: () => ++t });
    idx.replace('a', big, '1'); idx.replace('b', big, '2');
    expect(idx.isIndexed('a')).toBe(false);
    expect(idx.isIndexed('b')).toBe(true);
    expect(idx.stats().sources.find(s => s.name === 'a').evicted).toBe(true);
    expect(idx.candidates('a', ['note'])).toBe(null);
    expect(() => idx.setCap(512)).toThrow(/at least 1 MB/);
  });

  it('gives UniversalSearch the same results as a full scan', () => {
    globalThis.VexSearchIndex = fresh(JS + 'search-index.js').VexSearchIndex;
    const { UniversalSearch: U } = fresh(JS + 'universal-search.js');
    const notes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i, title: i % 4 ? 'Shopping ' + i : 'Boiler service ' + i, content: 'call the plumber about item ' + i, updatedAt: '2026-01-01T00:00:00Z' }));
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'b1', url: 'https://boiler.example/', title: 'Boiler manuals' }]));
    for (const q of ['boiler', 'notes: plumber 5', 'boiler service', 'xx', 'item 59', 'nothing-here']) {
      const scan = U.search(q, U.gather(), {}).map(r => r.id);
      const viaIndex = U.searchIndexed(q).results.map(r => r.id);
      expect(viaIndex, q).toEqual(scan);
    }
    expect(U.searchIndexed('boiler').counts.note).toBe(60);
    // A changed store is picked up.
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'only', title: 'Boiler only', content: '' }]));
    expect(U.searchIndexed('boiler').results.map(r => r.id).sort()).toEqual(['b1', 'only']);
  });
});

describe('usage counters', () => {
  it('counts per day, sums over a window and forgets after 35 days', () => {
    const { VexUsageCounters: C } = fresh(JS + 'usage-counters.js');
    let now = new Date(2026, 9, 1, 12).getTime();
    C._now = () => now;
    C.note('f', 'opened'); C.note('f', 'opened'); C.note('f', 'errored');
    expect(C.total('f', 'opened', 14, now)).toBe(2);
    expect(C.daysUsed('f', 14, now)).toBe(1);
    expect(() => C.note('f', 'bogus')).toThrow(/one of/);
    now += 40 * 86400000;
    C.note('g', 'opened');
    expect(C.total('f', 'opened', 60, now)).toBe(0);
    C.reset();
    expect(localStorage.getItem('vex.usageCounters')).toBe(null);
  });

  it('counts nothing while switched off, and stops (with a problem) when its record is unreadable', () => {
    const { VexUsageCounters: C } = fresh(JS + 'usage-counters.js');
    C.setEnabled(false);
    expect(C.note('f', 'opened')).toBe(false);
    C.setEnabled(true);
    localStorage.setItem('vex.usageCounters', '{not json');
    const note = vi.fn();
    globalThis.VexProblems = { note };
    expect(C.note('f', 'opened')).toBe(false);
    expect(note).toHaveBeenCalledTimes(1);
    delete globalThis.VexProblems;
  });

  it('suggests hiding what was never opened and pinning what is opened daily, once a month, and only after two weeks', () => {
    const { VexUsageCounters: C } = fresh(JS + 'usage-counters.js');
    let now = new Date(2026, 9, 1, 12).getTime();
    C._now = () => now;
    C.note('tab-mru', 'opened');            // starts the clock
    const rows = [
      { id: 'night-coach', title: 'Night usage coach', on: true, daysSeen: 20, catalogUsed: false },
      { id: 'dueness', title: 'What is due', on: true, daysSeen: 20, catalogUsed: false },
    ];
    expect(C.candidates(rows, now)).toEqual({ hide: [], pin: [] });     // too early
    for (let d = 0; d < 12; d++) { now += 86400000; C.note('dueness', 'opened'); }
    now += 3 * 86400000;
    const c = C.candidates(rows, now);
    expect(c.hide.map(x => x.id)).toEqual(['night-coach']);
    expect(c.pin.map(x => x.command)).toEqual(['due-now']);

    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    globalThis.VexUsage = { list: () => rows };
    const first = C.suggest(now);
    expect(first.kind).toBe('pin');
    expect(C.suggest(now + 86400000)).toBe(null);                        // once a month
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0].action.key).toBe('pin:dueness');
    delete globalThis.VexAttention;
  });

  it('pins a command and un-pins it through the ledger undo; hiding goes through VexUsage', async () => {
    const { VexUsageCounters: C } = fresh(JS + 'usage-counters.js');
    const disable = vi.fn(async () => {});
    globalThis.VexUsage = { disable };
    const record = vi.fn();
    globalThis.VexLedger = { record };
    expect(await C.accept('pin:dueness')).toBe('pinned');
    expect(C.pinnedCommands()).toEqual(['due-now']);
    expect(record.mock.calls[0][0].undo).toEqual({ kind: 'usage-suggest:unpin', command: 'due-now' });
    expect(await C.accept('hide:night-coach')).toBe('hidden');
    expect(disable).toHaveBeenCalledWith('night-coach');
    await expect(C.accept('nonsense')).rejects.toThrow(/Unknown suggestion/);
    delete globalThis.VexLedger;
  });
});

describe('progressive disclosure', () => {
  it('shows at most one a day and three a week, best-affinity first, rotating by week', () => {
    const { VexDisclosure: D } = fresh(JS + 'disclosure.js');
    const monday = new Date(2026, 9, 12, 9).getTime();
    expect(new Date(D.weekStart(monday + 3 * 86400000)).getDay()).toBe(1);
    const items = [{ id: 'a', cat: 'tabs' }, { id: 'b', cat: 'work' }, { id: 'c', cat: 'work' }];
    const ranked = D.rank(items, { work: 5 }, {}, monday).map(f => f.id);
    expect(ranked.slice(0, 2).sort()).toEqual(['b', 'c']);
    expect(D.rank(items, {}, { a: monday - 1000 }, monday).map(f => f.id)).not.toContain('a');       // cooling down
    expect(D.counts(monday)).toEqual({ today: 0, week: 0 });

    globalThis.VexFeatures = {
      ITEMS: items, unused: () => items, used: () => false, command: () => ({ id: 'x' }), nameOf: (f) => 'Feature ' + f.id,
    };
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    expect(D.surface(monday)).toBeTruthy();
    expect(D.surface(monday + 3600000)).toBe(null);                       // one a day
    expect(D.surface(monday + 86400000)).toBeTruthy();
    expect(D.surface(monday + 2 * 86400000)).toBeTruthy();
    expect(D.surface(monday + 3 * 86400000)).toBe(null);                  // three a week
    expect(suggest).toHaveBeenCalledTimes(3);
    expect(suggest.mock.calls[0][0].action.key).toMatch(/^show:/);
    expect(D.surface(monday + 7 * 86400000)).toBe(null);                  // all three still cooling down, none left
    delete globalThis.VexFeatures; delete globalThis.VexAttention;
  });

  it('does nothing when switched off', () => {
    const { VexDisclosure: D } = fresh(JS + 'disclosure.js');
    D.setEnabled(false);
    expect(D.surface()).toBe(null);
  });
});

describe('feature sheet', () => {
  it('lists what a feature touches, resets only what it owns, and can undo', () => {
    const { VexFeatureSheet: S } = fresh(JS + 'feature-sheet.js');
    expect(S.lines('night-coach')[0]).toMatch(/^Reads:/);
    expect(S.linesForCatalog('nothing-like-this')).toEqual([]);
    localStorage.setItem('vex.nightCoach', 'a'); localStorage.setItem('vex.nightCoach.log', 'b'); localStorage.setItem('vex.notes', 'mine');
    expect(S.ownedKeys('night-coach')).toEqual(['vex.nightCoach', 'vex.nightCoach.log']);
    expect(S.resettable('library-data').ok).toBe(false);
    expect(() => S.clear('library-data')).toThrow(/cannot be reset/);
    const done = S.clear('night-coach');
    expect(done.removed.length).toBe(2);
    expect(localStorage.getItem('vex.nightCoach')).toBe(null);
    expect(localStorage.getItem('vex.notes')).toBe('mine');
    done.undo();
    expect(localStorage.getItem('vex.nightCoach.log')).toBe('b');
  });

  it('shows the first-use sheet only for new or beta features, once, with a gap, never in a private window', () => {
    const { VexFeatureSheet: S } = fresh(JS + 'feature-sheet.js');
    const m = { id: 'x', maturity: 'new' };
    const base = { seen: {}, enabled: true, now: 1e9, lastShownAt: 0, privateWindow: false, gaming: false };
    expect(S.shouldShow(m, base)).toBe(true);
    expect(S.shouldShow({ id: 'x', maturity: 'stable' }, base)).toBe(false);
    expect(S.shouldShow(m, { ...base, seen: { x: 1 } })).toBe(false);
    expect(S.shouldShow(m, { ...base, privateWindow: true })).toBe(false);
    expect(S.shouldShow(m, { ...base, gaming: true })).toBe(false);
    expect(S.shouldShow(m, { ...base, lastShownAt: base.now - 1000 })).toBe(false);
    expect(S.shouldShow(m, { ...base, enabled: false })).toBe(false);
    expect(S.firstUse('night-coach')).toBe(true);
    expect(document.querySelector('.vex-firstuse')).toBeTruthy();
    expect(S.firstUse('night-coach')).toBe(false);
  });
});

describe('Your data', () => {
  it('round-trips everything but secrets, section by section', () => {
    globalThis.VexRegistry = VexRegistry;
    globalThis.VexBackup = fresh(JS + 'backup.js').VexBackup;
    const { VexYourData: Y } = fresh(JS + 'your-data.js');
    localStorage.setItem('vex.notes', '[{"id":"n","title":"T","content":"c"}]');
    localStorage.setItem('vex.nightCoach', '{"a":1}');
    localStorage.setItem('vex.lockPin', 'hash-of-a-pin');
    localStorage.setItem('vex.githubToken', 'ghp_secret');
    localStorage.setItem('vex.someUnlisted', 'u');
    const a = Y.build([]);
    const titles = a.sections.map(s => s.title);
    expect(titles).toContain('Notes, bookmarks and read later');
    expect(a.sections.every(s => s.schema === 1)).toBe(true);
    const all = a.sections.flatMap(s => Object.keys(s.items));
    expect(all).toContain('vex.notes');
    expect(all).not.toContain('vex.lockPin');
    expect(all).not.toContain('vex.githubToken');
    const wire = JSON.parse(JSON.stringify(a));

    localStorage.clear();
    localStorage.setItem('vex.notes', 'old');
    const d = Y.describe(wire);
    expect(d.sections.find(s => s.id === 'library-data')).toMatchObject({ count: 1, replaces: 1, added: 0 });
    const r = Y.apply(wire, ['library-data']);
    expect(r.sections).toEqual(['library-data']);
    expect(localStorage.getItem('vex.notes')).toBe('[{"id":"n","title":"T","content":"c"}]');
    expect(localStorage.getItem('vex.nightCoach')).toBe(null);          // not ticked
    Y.apply(wire);
    expect(localStorage.getItem('vex.nightCoach')).toBe('{"a":1}');
    expect(localStorage.getItem('vex.someUnlisted')).toBe('u');
    expect(localStorage.getItem('vex.lockPin')).toBe(null);
  });

  it('refuses secrets slipped into a file, a newer format and a stranger', () => {
    globalThis.VexBackup = fresh(JS + 'backup.js').VexBackup;
    const { VexYourData: Y } = fresh(JS + 'your-data.js');
    const evil = { format: 'vex-your-data', v: 2, sections: [{ id: 'other', title: 'x', schema: 1, items: { 'vex.apiToken': 'steal', 'vex.fine': 'ok' } }] };
    Y.apply(evil);
    expect(localStorage.getItem('vex.apiToken')).toBe(null);
    expect(localStorage.getItem('vex.fine')).toBe('ok');
    expect(() => Y.apply({ format: 'vex-your-data', v: 99, sections: [] })).toThrow(/newer Vex/);
    expect(() => Y.apply({ hello: 1 })).toThrow(/not a Vex "Your data"/);
    expect(() => Y.apply({ format: 'vex-your-data', v: 2, sections: [{ id: 'z', schema: 5, items: { 'vex.a': '1' } }] })).toThrow(/newer than this Vex/);
  });

  it('writes notes, highlights and clips as Markdown with front matter and unique names', () => {
    const { VexYourData: Y } = fresh(JS + 'your-data.js');
    localStorage.setItem('vex.notes', JSON.stringify([{ id: '1', title: 'Plan: Q4', content: 'Body', tags: ['work'], createdAt: '2026-01-01' }, { id: '2', title: 'Plan: Q4', content: 'Second' }]));
    localStorage.setItem('vex.annotations', JSON.stringify({ 'https://a.test/p': [{ text: 'quote', note: 'my note', title: 'A page' }] }));
    const files = Y.markdownFiles([{ id: 'c', text: 'clipped line\nmore', at: 0 }]);
    expect(files.map(f => f.path)).toEqual(['Notes/plan-q4.md', 'Notes/plan-q4-2.md', 'Highlights/a-page.md', 'Clips/clipped-line.md']);
    expect(files[0].text).toContain('title: "Plan: Q4"');
    expect(files[0].text).toContain('tags: ["work"]');
    expect(files[2].text).toContain('> quote');
  });
});

describe('intent search', () => {
  // The Ctrl+K commands, read from the source so the test needs no command bar.
  function commands() {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/command.js'), 'utf8');
    const out = [];
    for (const m of src.matchAll(/\{ id: '([^']+)', label: '((?:[^'\\]|\\.)*)', hint: '((?:[^'\\]|\\.)*)'/g)) out.push({ id: m[1], label: m[2].replace(/\\'/g, "'"), hint: m[3].replace(/\\'/g, "'") });
    return out;
  }
  let V, data;
  beforeEach(() => {
    globalThis.CommandBar = { commands: commands() };
    globalThis.VexFeatures = fresh(JS + 'feature-catalog.js').VexFeatures;
    globalThis.SettingsUI = fresh(JS + 'settings-ui.js').SettingsUI;
    ({ VexIntent: V } = fresh(JS + 'intent-search.js'));
    data = V.collect();
  });

  const CASES = [
    ['make text bigger', ['feature:zoom', 'feature:uisize', 'setting:appearance', 'setting:reading & accessibility']],
    ['stop notifications', ['feature:toast-snooze']],
    ['why is it slow', ['feature:tab-cost', 'feature:check-speed', 'feature:why-slow']],
    ['back up my stuff', ['feature:backup', 'command:backup']],
    ['dark mode', ['feature:theme-auto', 'feature:themes', 'setting:appearance']],
    ['change search engine', ['feature:search-engine']],
    ['block ads', ['feature:adblock']],
    ['close duplicate tabs', ['feature:closeduplicates', 'command:closeduplicates']],
    ['tidy my downloads', ['setting:distraction budget', 'setting:downloads', 'feature:download-desk']],
    ['save my passwords', ['feature:savepassword', 'command:savepassword', 'setting:passwords', 'feature:passwords']],
    ['use less memory', ['feature:memory-panel', 'feature:memory-saver', 'feature:tab-sleep']],
    ['sync my phone', ['feature:sync', 'setting:vex sync', 'feature:sendphone']],
    ['undo what vex did', ['feature:why-did-that', 'command:why-did-that']],
    ['report a problem', ['command:report-problem']],
    ['set a timer', ['feature:clock', 'feature:game-timers', 'feature:speech-timer']],
    ['game mode', ['feature:game-mode']],
    ['translate this page', ['feature:translate', 'command:translate']],
    ['reading mode', ['feature:reading-mode', 'command:read']],
    ['take a screenshot', ['feature:screenshot', 'feature:screenshot-full', 'feature:screenshot-code']],
    ['clear my history', ['command:clear-data', 'feature:history']],
    ['lock vex with a pin', ['command:lock-vex', 'setting:privacy & security', 'feature:secure-lock']],
    ['change the homepage', ['setting:personalization', 'feature:startpage']],
    ['import bookmarks from chrome', ['command:browser-import']],
    ['check for updates', ['setting:about', 'feature:updates', 'feature:update-self-test']],
    ['keyboard shortcuts', ['setting:keyboard shortcuts', 'feature:shortcuts', 'command:shortcuts']],
    ['turn on vertical tabs', ['feature:vertical-tabs', 'setting:tab layout']],
    ['who is using my camera', ['setting:site settings', 'feature:permissions', 'setting:site permissions']],
    ['listen to this article', ['command:readaloud', 'feature:readaloud', 'feature:listen-reader']],
    ['sleep tabs that I do not use', ['feature:tab-sleep', 'command:sleep']],
  ];

  it.each(CASES)('"%s" puts the right place first', (phrase, ok) => {
    const first = V.resolve(phrase, data, 1)[0];
    expect(first, phrase).toBeTruthy();
    expect(ok, phrase + ' -> ' + first.kind + ':' + first.id).toContain(first.kind + ':' + first.id);
  });

  it('finds screen recording within the first three, and nothing for a nonsense sentence', () => {
    expect(V.resolve('record my screen', data, 3).map(h => h.id)).toContain('record-screen');
    expect(V.resolve('purple elephants dancing quietly', data)).toEqual([]);
  });

  it('only answers sentences, only when on, and runs a command through the command bar', () => {
    expect(V.results('screenshot')).toEqual([]);                 // one word: the commands already match by name
    V.setEnabled(false);
    expect(V.results('take a screenshot')).toEqual([]);
    V.setEnabled(true);
    const rows = V.results('take a screenshot');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].id).toMatch(/^intent:/);
  });
});
