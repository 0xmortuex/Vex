// @vitest-environment jsdom
//
// Morning Brief extras: five self-contained section modules and their settings.
// Each exposes { id, title, build(), isEnabled() } for VexBrief.register.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { VexBriefOneNew } = require('../../src/renderer/js/brief-extras/one-new-thing.js');
const { VexBriefNewsActions } = require('../../src/renderer/js/brief-extras/news-actions.js');
const { VexBriefEvening } = require('../../src/renderer/js/brief-extras/evening.js');
const { VexBriefAudio } = require('../../src/renderer/js/brief-extras/audio-digest.js');
const { VexBriefStreaks } = require('../../src/renderer/js/brief-extras/streaks.js');
const { VexBriefExtrasSettings } = require('../../src/renderer/js/brief-extras/settings.js');

const sections = [VexBriefOneNew, VexBriefNewsActions, VexBriefEvening, VexBriefAudio, VexBriefStreaks];

beforeEach(() => { localStorage.clear(); });

describe('section contract', () => {
  it('every section has id, title, build and isEnabled', () => {
    for (const s of sections) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.build).toBe('function');
      expect(typeof s.isEnabled).toBe('function');
    }
    expect(new Set(sections.map(s => s.id)).size).toBe(sections.length);
  });

  it('the toggles switch the sections, and audio is opt-in', () => {
    expect(VexBriefOneNew.isEnabled()).toBe(true);
    expect(VexBriefAudio.isEnabled()).toBe(false);
    VexBriefExtrasSettings.set({ oneNew: false, audio: true, streaks: false });
    expect(VexBriefOneNew.isEnabled()).toBe(false);
    expect(VexBriefAudio.isEnabled()).toBe(true);
    expect(VexBriefStreaks.isEnabled()).toBe(false);
  });

  it('settings refuse a bad value instead of storing it', () => {
    expect(() => VexBriefExtrasSettings.set({ eveningHour: 25 })).toThrow(/0 to 23/);
    expect(() => VexBriefExtrasSettings.set({ audio: 'yes' })).toThrow();
    expect(VexBriefExtrasSettings.value('eveningHour')).toBe(19);
  });
});

describe('one new thing', () => {
  const items = [{ id: 'a', what: 'A.' }, { id: 'b', what: 'B.' }, { id: 'c', what: 'C.' }];
  const features = (usedIds) => ({
    ITEMS: items,
    used: (f) => usedIds.includes(f.id),
    nameOf: (f) => 'Feature ' + f.id,
    keysOf: () => '',
    actions: () => [{ act: 'panel', label: 'Open panel' }],
  });
  const day = new Date(2026, 9, 16, 8, 0);

  it('suggests an unused feature and pins it for the day', () => {
    const first = VexBriefOneNew.build(day, { features: features(['a']) });
    expect(first.lines[0].featureId).toBe('b');
    const later = VexBriefOneNew.build(new Date(2026, 9, 16, 15, 0), { features: features(['a']) });
    expect(later.lines[0].featureId).toBe('b');
  });

  it('rotates to the one shown least recently the next day', () => {
    VexBriefOneNew.build(day, { features: features([]) });                       // a
    const next = VexBriefOneNew.build(new Date(2026, 9, 17, 8, 0), { features: features([]) });
    expect(next.lines[0].featureId).toBe('b');
  });

  it('never-again removes it for good, not-today hides the card for the day', () => {
    VexBriefOneNew.build(day, { features: features([]) });
    VexBriefOneNew.never('a');
    expect(VexBriefOneNew.build(day, { features: features([]) }).lines[0].featureId).toBe('b');
    VexBriefOneNew.skipToday(day);
    expect(VexBriefOneNew.build(day, { features: features([]) })).toBeNull();
    expect(VexBriefOneNew.build(new Date(2026, 9, 17, 8, 0), { features: features([]) })).not.toBeNull();
  });

  it('returns null when everything has been used', () => {
    expect(VexBriefOneNew.build(day, { features: features(['a', 'b', 'c']) })).toBeNull();
  });
});

describe('news to action', () => {
  const known = [
    { kind: 'extension', name: 'Bitwarden', tokens: ['bitwarden'] },
    { kind: 'repo', name: 'ollama/ollama', owner: 'ollama', repo: 'ollama', tokens: ['ollama'] },
    { kind: 'site', name: 'huggingface.co', host: 'huggingface.co', tokens: ['huggingface'] },
  ];

  it('matches whole words only', () => {
    expect(VexBriefNewsActions.matchItem({ title: 'Ollama 0.9 adds tool calling' }, known).known.name).toBe('ollama/ollama');
    expect(VexBriefNewsActions.matchItem({ title: 'Hollamanager ships' }, known)).toBeNull();
    expect(VexBriefNewsActions.matchItem({ title: 'x', models: ['HuggingFace Hub'] }, known).known.kind).toBe('site');
  });

  it('a repo gets a releases link and a watch; others a search and no watch', () => {
    const repoItem = { id: '1', title: 'Ollama 0.9', url: 'https://example.com/a' };
    const m = VexBriefNewsActions.matchItem(repoItem, known);
    expect(VexBriefNewsActions.changelogUrl(repoItem, m)).toBe('https://github.com/ollama/ollama/releases');
    expect(VexBriefNewsActions.actionsFor(repoItem, m).map(a => a.label)).toEqual(['Open changelog', 'Watch ollama/ollama', 'Remind me tomorrow', 'Dismiss']);
    const extItem = { id: '2', title: 'Bitwarden adds passkeys', url: 'https://example.com/b' };
    const em = VexBriefNewsActions.matchItem(extItem, known);
    expect(VexBriefNewsActions.changelogUrl(extItem, em)).toMatch(/^https:\/\/duckduckgo\.com\/\?q=Bitwarden/);
    expect(VexBriefNewsActions.actionsFor(extItem, em).some(a => a.label.startsWith('Watch'))).toBe(false);
  });

  it('the actions call the real facilities and mark the story handled', async () => {
    const item = { id: 's1', title: 'Ollama 0.9', url: 'https://github.com/ollama/ollama/releases/tag/v0.9' };
    const m = VexBriefNewsActions.matchItem(item, known);
    const github = { add: vi.fn() };
    const reminders = { create: vi.fn().mockResolvedValue({}) };
    const openUrl = vi.fn();
    const acts = VexBriefNewsActions.actionsFor(item, m, { github, reminders, openUrl, now: () => new Date(2026, 9, 16, 21, 0).getTime() });
    acts[0].run(); expect(openUrl).toHaveBeenCalledWith('https://github.com/ollama/ollama/releases');
    acts[1].run(); expect(github.add).toHaveBeenCalledWith('https://github.com/ollama/ollama/releases');
    await acts[2].run();
    const [text, at, extra] = reminders.create.mock.calls[0];
    expect(text).toBe('Read: Ollama 0.9');
    expect(new Date(at).getHours()).toBe(9);
    expect(new Date(at).getDate()).toBe(17);
    expect(extra).toEqual({ url: item.url });
    expect(VexBriefNewsActions._handled().s1).toBeTruthy();
  });

  it('build lists only unread, unhandled stories that name something known', async () => {
    const now = Date.now();
    const news = { list: () => [
      { id: 'n1', title: 'Ollama 0.9 released', url: 'https://example.com/1', read: false, publishedAt: now - 3600e3, source: 'Blog' },
      { id: 'n2', title: 'Unrelated', url: 'https://example.com/2', read: false, publishedAt: now - 3600e3 },
      { id: 'n3', title: 'Ollama old', url: 'https://example.com/3', read: true, publishedAt: now - 3600e3 },
    ] };
    const sec = await VexBriefNewsActions.build(now, { news, extensions: async () => [], watches: () => [{ owner: 'ollama', repo: 'ollama' }], history: () => [] });
    expect(sec.lines).toHaveLength(1);
    expect(sec.lines[0].text).toBe('Ollama 0.9 released');
  });
});

describe('evening wind-down', () => {
  it('is only on after the set hour', () => {
    expect(VexBriefEvening.isEnabled(new Date(2026, 9, 16, 18, 59))).toBe(false);
    expect(VexBriefEvening.isEnabled(new Date(2026, 9, 16, 19, 0))).toBe(true);
    VexBriefExtrasSettings.set({ eveningHour: 17 });
    expect(VexBriefEvening.isEnabled(new Date(2026, 9, 16, 17, 0))).toBe(true);
    VexBriefExtrasSettings.set({ evening: false });
    expect(VexBriefEvening.isEnabled(new Date(2026, 9, 16, 22, 0))).toBe(false);
  });

  it('lists what is undone, read-later and tomorrow\'s first event', async () => {
    const now = new Date(2026, 9, 16, 20, 0);
    const at = (d, h) => new Date(2026, 9, d, h, 0).getTime();
    const sec = await VexBriefEvening.build(now, {
      reminders: { list: async () => [
        { id: 1, message: 'Call dentist', at: at(16, 15), firedAt: null },
        { id: 2, message: 'Done already', at: at(16, 9), firedAt: at(16, 9) },
      ] },
      openTasks: { _notes: () => [], collect: () => [{ text: 'File taxes', done: false, due: at(16, 0), noteTitle: 'Admin' }] },
      readLater: [{ title: 'Long read', url: 'https://x.test/a', read: false, at: 1 }, { title: 'Seen', url: 'https://x.test/b', read: true }],
      calendar: { between: () => [{ summary: 'Standup', start: at(17, 9), end: at(17, 10), allDay: false }] },
    });
    const text = sec.lines.map(l => l.text);
    expect(text).toContain('2 things left undone');
    expect(text).toContain('Call dentist');
    expect(text).toContain('File taxes');
    expect(text).not.toContain('Done already');
    expect(text).toContain('Long read');
    expect(text.find(t => t.startsWith('Tomorrow starts with Standup'))).toBeTruthy();
  });

  it('says so when nothing is left', () => {
    const body = VexBriefEvening.compose({ undone: [], readLater: [], tomorrow: null });
    expect(body.lines.map(l => l.text)).toEqual(['Nothing left undone today', 'Nothing scheduled to start tomorrow']);
  });
});

describe('audio digest', () => {
  it('writes a script and splits it into short chunks', () => {
    const text = VexBriefAudio.script({
      now: new Date(2026, 9, 16, 8, 0),
      reminders: [{ message: 'Pay rent' }],
      events: [{ summary: 'Standup', start: new Date(2026, 9, 16, 9, 30).getTime() }],
      news: [{ title: 'A model ships.' }],
      readLater: 2,
    });
    expect(text).toMatch(/^Good morning\./);
    expect(text).toContain('Standup at');
    expect(text).toContain('Pay rent.');
    expect(text).toContain('2 saved pages');
    const chunks = VexBriefAudio.chunks(text);
    expect(chunks.every(c => c.length <= 260)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('refuses to play without a speech engine, and shows no card then', async () => {
    expect(VexBriefAudio.supported()).toBe(false);
    expect(VexBriefAudio.build()).toBeNull();
    await expect(VexBriefAudio.play()).rejects.toThrow(/no speech engine/);
  });
});

describe('streaks and goals', () => {
  const goals = { tabs: 10, focus: 25 };
  const key = (d) => VexBriefStreaks.dayKey(d);

  it('counts days in a row and forgives an unfinished today', () => {
    const now = new Date(2026, 9, 16, 12, 0);
    const days = {
      '2026-10-13': { focus: 30 }, '2026-10-14': { focus: 25 }, '2026-10-15': { focus: 40 },
      '2026-10-16': { focus: 5 },
    };
    expect(VexBriefStreaks.streak(days, 'focus', goals, now)).toBe(3);
    days['2026-10-16'].focus = 25;
    expect(VexBriefStreaks.streak(days, 'focus', goals, now)).toBe(4);
    delete days['2026-10-15'];
    expect(VexBriefStreaks.streak(days, 'focus', goals, now)).toBe(1);
  });

  it('samples tabs and inbox, adds focus minutes, and builds three rows', () => {
    const now = new Date(2026, 9, 16, 12, 0);
    VexBriefStreaks.sample(now, { tabs: 8, unseen: 0 });
    VexBriefStreaks.addFocus(30, now);
    const sec = VexBriefStreaks.build(now, { tabs: 8, unseen: null });
    expect(sec.lines.map(l => l.goal)).toEqual(['inbox', 'tabs', 'focus']);
    expect(sec.lines.every(l => l.met)).toBe(true);
    const days = VexBriefStreaks.days();
    expect(days[key(now)]).toEqual({ inbox: true, tabs: 8, focus: 30 });
    VexBriefExtrasSettings.set({ goalTabs: 5 });
    expect(VexBriefStreaks.goals().tabs).toBe(5);
  });

  it('an unreadable inbox is not measured, so it does not count as zero', () => {
    const now = new Date(2026, 9, 16, 12, 0);
    const day = VexBriefStreaks.sample(now, { tabs: 3, unseen: null });
    expect(day.inbox).toBe(false);
  });
});
