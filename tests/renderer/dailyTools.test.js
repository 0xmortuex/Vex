// @vitest-environment jsdom
//
// The daily tools: universal search, meeting prep, evening tab cleanup,
// routine detection, project spaces, and the hotkey conflict check.
import { beforeEach, describe, expect, it } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { UniversalSearch } = require('../../src/renderer/js/universal-search.js');
const { MeetingPrep } = require('../../src/renderer/js/meeting-prep.js');
const { TabCleanup } = require('../../src/renderer/js/tab-cleanup.js');
const { RoutineDetect } = require('../../src/renderer/js/routine-detect.js');
const { ProjectSpaces } = require('../../src/renderer/js/project-spaces.js');
const { createGameHotkeys } = require('../../src/main/game-hotkeys.js');
const { createCaptureInbox } = require('../../src/main/capture-inbox.js');

beforeEach(() => { localStorage.clear(); });

describe('universal search', () => {
  it('reads type prefixes and leaves unknown ones alone', () => {
    expect(UniversalSearch.parseQuery('mail: invoice')).toEqual({ types: ['mail'], text: 'invoice' });
    expect(UniversalSearch.parseQuery('notes: mail: boiler').types).toEqual(['note', 'mail']);
    expect(UniversalSearch.parseQuery('https://x.test').types).toEqual([]);
  });
  it('requires every word, ranks titles first and filters by type', () => {
    const items = [
      { type: 'note', id: 'n1', title: 'Boiler quote', body: 'three quotes', at: 1 },
      { type: 'history', id: 'h1', title: 'Shop', body: 'boiler quote page', at: 5 },
      { type: 'mail', id: 'm1', title: 'Invoice', at: 3 },
    ];
    const r = UniversalSearch.search('boiler quote', items);
    expect(r.map(x => x.id)).toEqual(['n1', 'h1']);
    expect(UniversalSearch.search('mail: invoice', items).map(x => x.id)).toEqual(['m1']);
    expect(UniversalSearch.search('boiler zzz', items)).toEqual([]);
  });
  it('remembers mail headers only, capped, and can forget', () => {
    const n = UniversalSearch.rememberMail('a1', { messages: [{ uid: 1, subject: 'Hi', from: { name: 'Al', address: 'a@x' }, date: 5 }] });
    expect(n).toBe(1);
    expect(JSON.parse(localStorage.getItem('vex.mailHeaders'))[0]).toEqual({ accountId: 'a1', uid: 1, subject: 'Hi', from: 'Al', date: 5 });
    UniversalSearch.setMailEnabled(false);
    expect(localStorage.getItem('vex.mailHeaders')).toBeNull();
    expect(UniversalSearch.rememberMail('a1', { messages: [{ uid: 2, subject: 'x' }] })).toBe(0);
  });
});

describe('meeting prep', () => {
  it('splits documents from the call link', () => {
    const p = MeetingPrep.prepare({ summary: 'Sprint review', start: 1000, description: 'Agenda https://docs.google.com/d/1. Join https://meet.google.com/abc-def', location: '' }, []);
    expect(p.docs).toEqual(['https://docs.google.com/d/1']);
    expect(p.calls).toEqual(['https://meet.google.com/abc-def']);
  });
  it('finds the last notes by title or tag, newest first', () => {
    const notes = [
      { id: 'a', title: 'Sprint review 3 Oct', content: 'x', updatedAt: '2026-10-03T10:00:00Z' },
      { id: 'b', title: 'Sprint review 10 Oct', content: 'y', updatedAt: '2026-10-10T10:00:00Z' },
      { id: 'c', title: 'Other', tags: ['sprint review'], content: 'z', updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'd', title: 'Groceries', content: 'milk' },
    ];
    expect(MeetingPrep.findNotes(notes, 'Sprint review').map(n => n.id)).toEqual(['b', 'a', 'c']);
  });
  it('is due inside the lead time, once, and not for all-day events', () => {
    const now = 1_000_000_000;
    const ev = [{ summary: 'Standup', start: now + 9 * 60000 }, { summary: 'Later', start: now + 60 * 60000 }, { summary: 'Day', start: now, allDay: true }];
    const due = MeetingPrep.due(ev, now);
    expect(due.map(e => e.summary)).toEqual(['Standup']);
    expect(MeetingPrep.due(ev, now, { shown: new Set([MeetingPrep.keyOf(ev[0])]) })).toEqual([]);
  });
});

describe('tab cleanup', () => {
  const day = 86400000, now = 100 * day;
  const tab = (id, url, daysAgo, extra = {}) => ({ id, url, title: url, _lastActive: now - daysAgo * day, ...extra });
  it('proposes only idle tabs and second copies, never protected ones', () => {
    const tabs = [
      tab(1, 'https://a.test/', 5), tab(2, 'https://b.test/', 1), tab(3, 'https://c.test/', 9, { pinned: true }),
      tab(4, 'https://d.test/', 9, { audible: true }), tab(5, 'https://e.test/', 9, { groupId: 'g' }),
      tab(6, 'https://f.test/', 9), tab(7, 'https://b.test/', 2), tab(8, 'vex://start', 20),
    ];
    const out = TabCleanup.propose(tabs, { now, days: 3, activeId: 6 });
    expect(out.map(o => [o.id, o.why]).sort()).toEqual([[1, 'idle'], [7, 'duplicate']]);
    expect(out.some(o => [2, 3, 4, 5, 6, 8].includes(o.id))).toBe(false);
  });
  it('never calls a tab with unknown activity stale', () => {
    expect(TabCleanup.propose([{ id: 1, url: 'https://x.test/' }], { now, days: 3 })).toEqual([]);
  });
});

describe('routine detection', () => {
  const at = (day, h, m) => new Date(2026, 9, day, h, m).getTime();
  const visit = (log, day, hosts) => hosts.forEach((h, i) => RoutineDetect.append(log, { h, u: 'https://' + h + '/', t: at(day, 8, i * 2) }));
  it('finds the same morning run on several days', () => {
    const log = [];
    visit(log, 5, ['mail.test', 'tracker.test', 'news.test']);
    visit(log, 6, ['mail.test', 'tracker.test', 'news.test', 'extra.test']);
    visit(log, 7, ['other.test', 'mail.test', 'tracker.test', 'news.test']);
    const s = RoutineDetect.suggestion(RoutineDetect.find(log));
    expect(s.sites).toEqual(['mail.test', 'tracker.test', 'news.test']);
    expect(s.days).toBe(3);
    expect(s.steps).toEqual(['open:https://mail.test/', 'open:https://tracker.test/', 'open:https://news.test/']);
  });
  it('finds nothing from two days, or from afternoons', () => {
    const log = [];
    visit(log, 5, ['a.test', 'b.test', 'c.test']);
    visit(log, 6, ['a.test', 'b.test', 'c.test']);
    expect(RoutineDetect.find(log)).toBeNull();
    const pm = [];
    for (const d of [5, 6, 7]) ['a.test', 'b.test', 'c.test'].forEach((h, i) => RoutineDetect.append(pm, { h, u: 'https://' + h, t: at(d, 15, i * 2) }));
    expect(RoutineDetect.find(pm)).toBeNull();
  });
  it('skips local and non-web addresses', () => {
    expect(RoutineDetect.entryFor('http://localhost:3000/')).toBeNull();
    expect(RoutineDetect.entryFor('vex://start')).toBeNull();
    expect(RoutineDetect.entryFor('https://www.Example.com/a/b?q=1').u).toBe('https://www.example.com/a/b');
  });
});

describe('project spaces', () => {
  it('normalizes repositories', () => {
    expect(ProjectSpaces.normalizeRepo('https://github.com/me/app.git')).toBe('me/app');
    expect(ProjectSpaces.normalizeRepo('me/app')).toBe('me/app');
    expect(ProjectSpaces.normalizeRepo('')).toBe('');
    expect(() => ProjectSpaces.normalizeRepo('nope')).toThrow();
  });
  it('filters mail by words and from:/subject:', () => {
    const m = { subject: 'Q3 invoice', from: { name: 'Alice', address: 'a@acme.test' } };
    expect(ProjectSpaces.mailMatches(m, 'invoice')).toBe(true);
    expect(ProjectSpaces.mailMatches(m, 'from:acme subject:q3')).toBe(true);
    expect(ProjectSpaces.mailMatches(m, 'from:bob')).toBe(false);
    expect(ProjectSpaces.mailMatches(m, '')).toBe(true);
  });
  it('cycles to the next space and wraps', () => {
    const s = [{ id: 'a' }, { id: 'b' }];
    expect(ProjectSpaces.nextId(s, 'a')).toBe('b');
    expect(ProjectSpaces.nextId(s, 'b')).toBe('a');
    expect(ProjectSpaces.nextId([], null)).toBeNull();
  });
});

describe('capture hotkey and inbox (main)', () => {
  const gs = () => { const held = new Set(); return { register: (a) => { if (held.has(a)) return false; held.add(a); return true; }, unregister: (a) => held.delete(a) }; };
  it('refuses a key two actions share and the boss key', () => {
    const h = createGameHotkeys({ globalShortcut: gs(), onAction() {}, reserved: ['CommandOrControl+Alt+H'] });
    const r = h.set({ 'quick-capture': 'Ctrl+Shift+Y', 'discord-mute': 'control+shift+y', 'streamer-toggle': 'Ctrl+Alt+H' });
    expect(Object.keys(r.applied)).toEqual(['quick-capture']);
    expect(r.errors.map(e => e.action).sort()).toEqual(['discord-mute', 'streamer-toggle']);
  });
  it('keeps clips in a file and survives a reload', () => {
    const files = new Map();
    const fsImpl = {
      readFileSync: (f) => { if (!files.has(f)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; } return files.get(f); },
      writeFileSync: (f, d) => files.set(f, d), renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }, mkdirSync() {},
    };
    const a = createCaptureInbox({ file: '/x/clips.json', fsImpl });
    a.add('first'); a.add('second');
    const b = createCaptureInbox({ file: '/x/clips.json', fsImpl });
    expect(b.list().map(i => i.text)).toEqual(['second', 'first']);
    expect(() => b.add('  ')).toThrow();
  });
});
