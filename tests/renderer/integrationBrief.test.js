// @vitest-environment jsdom
//
// The Morning Brief after the nine feature branches were joined: every section
// id is registered exactly once, one section failing is that section's own
// error, the brief-extras and memory-tools shapes become payloads the New Tab
// page can draw, and a button on the page can only run what the last build
// handed out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexBrief } = require('../../src/renderer/js/brief.js');
const { BriefSections } = require('../../src/renderer/js/brief-sections.js');
const { BriefIntegration } = require('../../src/renderer/js/brief-integration.js');
const { BriefActions } = require('../../src/renderer/js/brief-actions.js');
const { VexSnooze } = require('../../src/renderer/js/snooze-anything.js');
const { MailTriage } = require('../../src/renderer/js/mail-triage-actions.js');
const { InboxTriage } = require('../../src/renderer/js/inbox-triage.js');
const { GitHubDesk } = require('../../src/renderer/js/github-desk.js');
const { VexInterests } = require('../../src/renderer/js/interests-profile.js');
const { VexDayLayout } = require('../../src/renderer/js/day-layout.js');
const { VexNextAction } = require('../../src/renderer/js/next-action.js');
const { VexBriefOneNew } = require('../../src/renderer/js/brief-extras/one-new-thing.js');
const { VexBriefNewsActions } = require('../../src/renderer/js/brief-extras/news-actions.js');
const { VexBriefEvening } = require('../../src/renderer/js/brief-extras/evening.js');
const { VexBriefAudio } = require('../../src/renderer/js/brief-extras/audio-digest.js');
const { VexBriefStreaks } = require('../../src/renderer/js/brief-extras/streaks.js');
const { VexBriefExtrasSettings } = require('../../src/renderer/js/brief-extras/settings.js');
const { VexMemoryTools } = require('../../src/renderer/js/memory-tools.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
const { UniversalSearch } = require('../../src/renderer/js/universal-search.js');
const { RoutineDetect } = require('../../src/renderer/js/routine-detect.js');
const { DailyToolsSettings } = require('../../src/renderer/js/daily-tools-settings.js');

const CORE = ['ai-news', 'mail', 'github', 'schedule', 'watched', 'radar', 'resume', 'saved', 'numbers', 'focus'];
const ACTIONS = ['snoozed', 'mail-triage', 'github-desk', 'interests', 'day-layout', 'next-action'];
const EXTRAS = ['evening-wind-down', 'audio-digest', 'news-actions', 'streaks-goals', 'one-new-thing'];
const MEMORY = ['dashboards', 'journal', 'link-memory', 'game-log', 'backup'];
const ALL = [...CORE, ...ACTIONS, ...EXTRAS, ...MEMORY];

function freshRegistry() {
  for (const d of VexBrief.defs()) VexBrief.unregister(d.id);
  BriefIntegration._synced.clear();
  BriefIntegration._actions.clear();
  localStorage.clear();
  VexBrief._last = null;
  window.VexBriefModules = VexMemoryTools._makeBrief();
}

function registerEverything() {
  BriefSections.registerAll(VexBrief);
  BriefActions.registerAll(VexBrief);
  BriefIntegration.sync(VexBrief);
}

beforeEach(() => {
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  window.VexProblems = globalThis.VexProblems;
  Object.assign(globalThis, {
    VexBrief, BriefIntegration, BriefActions, VexSnooze, MailTriage, InboxTriage, GitHubDesk, VexInterests, VexDayLayout,
    VexNextAction, VexBriefOneNew, VexBriefNewsActions, VexBriefEvening, VexBriefAudio, VexBriefStreaks,
    VexBriefExtrasSettings, VexMemoryTools, VexIcons, UniversalSearch, RoutineDetect,
  });
  freshRegistry();
});
afterEach(() => { vi.restoreAllMocks(); delete window.VexBriefModules; });

describe('registration', () => {
  it('registers every section id once, from all three groups', () => {
    registerEverything();
    const ids = VexBrief.defs().map(d => d.id);
    expect([...ids].sort()).toEqual([...ALL].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('syncing again adds nothing and never duplicates', () => {
    registerEverything();
    expect(BriefIntegration.sync(VexBrief)).toBe(0);
    expect(BriefIntegration.sync(VexBrief)).toBe(0);
    expect(VexBrief.defs()).toHaveLength(ALL.length);
  });

  it('picks up a memory-tools module that arrives after the first sync', () => {
    window.VexBriefModules = [];
    BriefSections.registerAll(VexBrief);
    BriefIntegration.sync(VexBrief);
    expect(VexBrief.get('journal')).toBeNull();
    window.VexBriefModules = VexMemoryTools._makeBrief();
    expect(BriefIntegration.sync(VexBrief)).toBe(MEMORY.length);
    expect(VexBrief.get('journal')).not.toBeNull();
  });

  it('every section names an icon Vex really has', () => {
    registerEverything();
    for (const d of VexBrief.defs()) expect(VexIcons.has(d.icon), d.id + ' uses ' + d.icon).toBe(true);
  });

  it('a full build answers every enabled section, none of them undefined', async () => {
    registerEverything();
    const out = await VexBrief.build({ now: Date.now(), force: true, snap: {} });
    expect(out.sections.length).toBeGreaterThan(0);
    const seen = out.sections.map(s => s.id);
    expect(new Set(seen).size).toBe(seen.length);
    for (const s of out.sections) {
      expect(['ok', 'empty', 'hint', 'error']).toContain(s.status);
      if (s.status === 'ok') expect(Array.isArray(s.items)).toBe(true);
    }
  });
});

describe('isolation', () => {
  it('a throwing extras section is its own error and the others still answer', async () => {
    registerEverything();
    vi.spyOn(VexBriefStreaks, 'build').mockImplementation(() => { throw new Error('streaks broke'); });
    vi.spyOn(VexBriefStreaks, 'sample').mockImplementation(() => {});
    const out = await VexBrief.build({ now: Date.now(), force: true, snap: {} });
    const by = Object.fromEntries(out.sections.map(s => [s.id, s]));
    expect(by['streaks-goals'].status).toBe('error');
    expect(by['streaks-goals'].error).toBe('streaks broke');
    const others = out.sections.filter(s => s.id !== 'streaks-goals');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every(s => s.status !== 'error' || s.error !== 'streaks broke')).toBe(true);
  });

  it('a memory-tools module that rejects does not blank the brief', async () => {
    window.VexBriefModules = [{ id: 'journal', title: 'Journal', isEnabled: () => true, build: () => Promise.reject(new Error('disk')) }];
    VexBrief.register({ id: 'plain', title: 'Plain', build: () => ({ summary: 'fine' }) });
    BriefIntegration.sync(VexBrief);
    const out = await VexBrief.build({ now: Date.now(), force: true });
    const by = Object.fromEntries(out.sections.map(s => [s.id, s]));
    expect(by.journal.status).toBe('error');
    expect(by.plain.summary).toBe('fine');
  });
});

describe('adapters', () => {
  const line = (over = {}) => ({ text: 'Line', detail: 'More', ...over });

  it('turns brief-extras lines into items a page can draw', () => {
    const p = BriefIntegration.toPayload('x', { lines: [line({ url: 'https://a.example/x' }), line({ text: 'Done', met: true })] });
    const n = VexBrief.normalise({ id: 'x', title: 'X', icon: 'sparkles', maxItems: 6 }, p);
    expect(n.status).toBe('ok');
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({ text: 'Line', sub: 'More', url: 'https://a.example/x' });
    expect(n.items[1].badge).toBe('done');
  });

  it('turns memory-tools items into items, with the state as a badge', () => {
    const p = BriefIntegration.toPayload('dashboards', { items: [{ text: 'CI', detail: 'passed', url: 'https://github.com/o/r/actions', state: 'down' }], empty: '' });
    const n = VexBrief.normalise({ id: 'dashboards', title: 'D', icon: 'activity' }, p);
    expect(n.items[0]).toMatchObject({ text: 'CI', sub: 'passed', badge: 'down' });
  });

  it('answers null (a hidden card) for an empty answer', () => {
    expect(BriefIntegration.toPayload('x', { items: [], empty: 'Nothing yet.' })).toBeNull();
    expect(BriefIntegration.toPayload('x', { lines: [] })).toBeNull();
    expect(BriefIntegration.toPayload('x', null)).toBeNull();
  });

  it('a module that reported errors says so in the note', () => {
    const p = BriefIntegration.toPayload('x', { lines: [line()], errors: ['reminders: offline'] });
    expect(p.note).toMatch(/reminders: offline/);
  });

  it('the real memory-tools modules answer something renderable or nothing', async () => {
    registerEverything();
    for (const id of MEMORY) {
      const def = VexBrief.get(id);
      const out = await def.build({ now: Date.now() });
      if (out) {
        const n = VexBrief.normalise(def, out);
        expect(['ok', 'empty']).toContain(n.status);
        for (const it of n.items) expect(typeof it.text).toBe('string');
      }
    }
  });

  it('a section its own switch turned off answers nothing', async () => {
    registerEverything();
    VexBriefExtrasSettings.set({ oneNew: false });
    expect(await VexBrief.get('one-new-thing').build({ now: Date.now() })).toBeNull();
  });
});

describe('actions the page can send back', () => {
  function sectionWithAction(run) {
    const mod = {
      id: 'demo', title: 'Demo', isEnabled: () => true,
      build: () => ({ lines: [{ text: 'Story', detail: 'why', url: 'https://a.example/s', actions: [{ label: 'Dismiss', run }, { label: 'Changelog', url: 'https://a.example/log' }, { label: 'Nothing' }] }] }),
    };
    VexBrief.register(BriefIntegration.sectionFor(mod, { order: 1 }));
  }

  it('hands out keys, never functions, and drops buttons with nothing behind them', async () => {
    sectionWithAction(() => {});
    const out = await VexBrief.build({ now: Date.now(), force: true });
    const it = out.sections[0].items[0];
    expect(it.actions.map(a => a.label)).toEqual(['Dismiss', 'Changelog']);
    expect(it.actions[0].cmd).toEqual({ type: 'brief-action', key: 'demo:0:0' });
    expect(it.actions[1].cmd).toEqual({ type: 'brief-open-url', url: 'https://a.example/log' });
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.stringify(out)).not.toMatch(/function/);
  });

  it('runs an action the last build offered, and only that', async () => {
    const run = vi.fn();
    sectionWithAction(run);
    await VexBrief.build({ now: Date.now(), force: true });
    await VexBrief.onStartCommand({ type: 'brief-action', key: 'demo:0:0' });
    await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    await VexBrief.onStartCommand({ type: 'brief-action', key: 'demo:9:9' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/no longer on offer/), 'error');
  });

  it('opens an offered address in a tab and refuses one it never offered', async () => {
    sectionWithAction(() => {});
    await VexBrief.build({ now: Date.now(), force: true });
    globalThis.TabManager = { createTab: vi.fn() };
    await VexBrief.onStartCommand({ type: 'brief-open-url', url: 'https://a.example/log' });
    expect(globalThis.TabManager.createTab).toHaveBeenCalledWith('https://a.example/log', true);
    await VexBrief.onStartCommand({ type: 'brief-open-url', url: 'https://evil.example/' });
    expect(globalThis.TabManager.createTab).toHaveBeenCalledTimes(1);
    delete globalThis.TabManager;
  });

  it('keeps the old whitelist: an unknown command does nothing', async () => {
    await VexBrief.onStartCommand({ type: 'brief-delete-everything' });
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('an action that throws is shown as a toast, not swallowed', async () => {
    sectionWithAction(() => { throw new Error('could not snooze'); });
    await VexBrief.build({ now: Date.now(), force: true });
    await VexBrief.onStartCommand({ type: 'brief-action', key: 'demo:0:0' });
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('could not snooze', 'error');
  });
});

describe('settings and wiring', () => {
  it('draws the extras settings into the Morning Brief group', () => {
    const box = document.createElement('div');
    BriefIntegration.renderSettings(box);
    expect(box.querySelector('[data-be-toggle="oneNew"]')).not.toBeNull();
    expect(box.querySelector('[data-be-number="eveningHour"]')).not.toBeNull();
    expect(box.textContent).toMatch(/Memory tools/);
  });

  it('the mail subject memo is off until it is turned on', () => {
    expect(UniversalSearch.mailEnabled()).toBe(false);
    expect(UniversalSearch.rememberMail('a1', { messages: [{ uid: 1, subject: 'Hi', date: 5 }] })).toBe(0);
    expect(localStorage.getItem('vex.mailHeaders')).toBeNull();
    UniversalSearch.setMailEnabled(true);
    expect(UniversalSearch.rememberMail('a1', { messages: [{ uid: 1, subject: 'Hi', date: 5 }] })).toBe(1);
    UniversalSearch.setMailEnabled(false);
    expect(localStorage.getItem('vex.mailHeaders')).toBeNull();
  });

  it('the three watching features stay off until chosen', () => {
    const p = BriefActions.prefs();
    expect([p.interests, p.dayLayout, p.nextAction]).toEqual([false, false, false]);
  });

  it('"Save as a command chain" opens the chain editor with the suggested steps', () => {
    const open = vi.fn(() => Promise.resolve());
    globalThis.VexChainSteps = { open };
    DailyToolsSettings._wired = false;
    DailyToolsSettings.init();
    const s = { name: 'Morning: a, b', steps: ['open:https://a.example/', 'open:https://b.example/'] };
    expect(RoutineDetect._keeper(s)).toBe(true);
    expect(open).toHaveBeenCalledWith(null, { name: s.name, steps: s.steps });
    RoutineDetect.setKeeper(null);
    delete globalThis.VexChainSteps;
  });
});
