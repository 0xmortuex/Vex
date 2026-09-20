// Meeting mode. What must hold: a meeting survives Vex being closed, action
// items are written as real tasks, a tab that was already muted is not
// unmuted afterwards, and reminders are held for the meeting and let go after.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { MeetingMode: M } = require('../../src/renderer/js/meeting-mode.js');

const store = {};
let notes;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  notes = [];
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.OpenTasks = { notes: () => notes, writeNotes: (n) => { notes = n; } };
  globalThis.document = { body: { classList: { add: vi.fn(), remove: vi.fn() } } };
  globalThis.window = { showToast: vi.fn(), vex: { reminders: { hold: vi.fn(async () => true) } } };
  globalThis.TabManager = { tabs: [], activeTabId: 1, renderTabUpdate: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map() };
});

const mutableTab = (id, audible, muted = false) => {
  const wv = { muted, setAudioMuted(v) { this.muted = v; } };
  WebviewManager.webviews.set(id, wv);
  const tab = { id, audible, muted };
  TabManager.tabs.push(tab);
  return { tab, wv };
};

describe('starting and ending', () => {
  it('opens a note with the time on it and holds reminders', () => {
    const note = M.start();
    expect(note.title).toMatch(/^Meeting \u2014 /);
    expect(note.content).toMatch(/^\d\d:\d\d {2}Started\./);
    expect(notes[0].id).toBe(note.id);
    expect(window.vex.reminders.hold).toHaveBeenCalledWith(expect.any(Number));
    expect(M.active()).toBe(true);
  });

  it('will not start a second meeting on top of one', () => {
    M.start();
    expect(() => M.start()).toThrow(/already running/);
  });

  it('ending writes how long it took and lets the reminders go', () => {
    M.start();
    const out = M.stop();
    expect(notes[0].content).toMatch(/Ended, after 1 minute\./);
    expect(window.vex.reminders.hold).toHaveBeenLastCalledWith(0);
    expect(M.active()).toBe(false);
    expect(out.items).toBe(0);
  });

  it('a meeting outlives the window being closed', () => {
    M.start();
    // A fresh window: the module is new, the stored state is not.
    expect(M.state().noteId).toBe(notes[0].id);
    M.init();
    expect(document.body.classList.add).toHaveBeenCalledWith('meeting-mode');
  });

  it('nothing to end is said plainly', () => {
    expect(() => M.stop()).toThrow(/No meeting/);
    expect(() => M.jot('x')).toThrow(/No meeting/);
  });
});

describe('what goes in the note', () => {
  it('a line goes in with the time it was said', () => {
    M.start();
    M.jot('  agreed   the   date ');
    expect(notes[0].content).toMatch(/\n\d\d:\d\d {2}agreed the date$/);
  });

  it('an action item is written as a task, and counted at the end', () => {
    M.start();
    M.action('send the quote');
    M.action('book the room');
    expect(notes[0].content).toContain('- [ ] send the quote');
    expect(M.stop().items).toBe(2);
  });

  it('an empty line is refused rather than written', () => {
    M.start();
    expect(() => M.jot('   ')).toThrow(/Write the line/);
    expect(() => M.action('')).toThrow(/Write the action/);
  });

  it('a deleted note ends the meeting instead of writing into nothing', () => {
    M.start();
    notes = [];
    expect(() => M.jot('x')).toThrow(/has ended/);
    expect(M.active()).toBe(false);
  });
});

describe('the quiet part', () => {
  it('mutes other tabs making a sound, and leaves the rest alone', () => {
    const active = mutableTab(1, true);
    const noisy = mutableTab(2, true);
    const quiet = mutableTab(3, false);
    const already = mutableTab(4, true, true);
    M.start();
    expect(active.wv.muted).toBe(false);          // the call is in this one
    expect(noisy.wv.muted).toBe(true);
    expect(quiet.wv.muted).toBe(false);
    expect(already.wv.muted).toBe(true);

    M.stop();
    expect(noisy.wv.muted).toBe(false);
    // The one that was already muted stays muted — it was not ours to unmute.
    expect(already.wv.muted).toBe(true);
  });
});

describe('how long it lasted, in words', () => {
  it('reads like a person would say it', () => {
    expect(M.lasted(60000)).toBe('1 minute');
    expect(M.lasted(25 * 60000)).toBe('25 minutes');
    expect(M.lasted(60 * 60000)).toBe('1 hour');
    expect(M.lasted(95 * 60000)).toBe('1 hour 35 minutes');
  });
});
