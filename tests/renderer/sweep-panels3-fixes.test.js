// @vitest-environment jsdom
//
// The panels sweep, part 3 (found 2026-09-29): a restored backup that the
// window's own close wrote over, "every 30 minutes" running hourly, note
// ticks landing on the wrong task, windows Escape could not close, a quick
// capture error nobody could read, a sticky note restored off-screen,
// unreadable habits with no way out, two timers ending together, and a
// once-task dated by UTC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/page-export.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');
const { ScheduleWords } = require('../../src/renderer/js/schedule-words.js');
const { VexMarkdown } = require('../../src/renderer/js/vex-markdown.js');
window.VexMarkdown = VexMarkdown;
const { NotesPanel } = require('../../src/renderer/js/notes-panel.js');
const { OpenTasks } = require('../../src/renderer/js/open-tasks.js');
const { Habits } = require('../../src/renderer/js/habits.js');
const { VexClock } = require('../../src/renderer/js/clock-panel.js');
const { StickyNotes } = require('../../src/renderer/js/sticky-notes.js');
const { VexBoosts } = require('../../src/renderer/js/boosts.js');
require('../../src/renderer/js/automations.js');
require('../../src/renderer/js/focus-flows.js');
const { Automations, FocusFlows } = window;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
});

describe('a restored backup stays restored', () => {
  afterEach(() => { delete globalThis.WorkspaceManager; });

  it('has the panels that keep a copy in memory read the restored one', async () => {
    const ws = { reloadSyncedState: vi.fn() };
    globalThis.WorkspaceManager = ws;
    const applied = vi.fn();
    window.addEventListener('vex-sync-data-applied', applied);
    localStorage.setItem('vex.workspaces', '{"workspaces":[{"id":"old"}]}');
    const data = { v: 1, items: { 'vex.workspaces': '{"workspaces":[{"id":"restored"}]}' } };
    VexBackup.apply(data);
    VexBackup._reloadLive();
    expect(ws.reloadSyncedState).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledTimes(1);
    window.removeEventListener('vex-sync-data-applied', applied);
  });

  it('the WorkspaceManager write on close keeps the restored list', () => {
    const { WorkspaceManager } = require('../../src/renderer/js/workspaces.js');
    WorkspaceManager.workspaces = [{ id: 'ws_personal', name: 'Before' }];
    WorkspaceManager.activeId = 'ws_personal';
    localStorage.setItem('vex.workspaces', JSON.stringify({ activeWorkspaceId: 'ws_personal', workspaces: [{ id: 'ws_personal', name: 'Restored' }, { id: 'ws_b', name: 'Also restored', tabs: [{ url: 'https://a.test' }] }] }));
    globalThis.WorkspaceManager = WorkspaceManager;
    VexBackup._reloadLive();
    WorkspaceManager.save();     // what saveCurrentState ends with, on close
    const saved = JSON.parse(localStorage.getItem('vex.workspaces'));
    expect(saved.workspaces.map(w => w.name)).toEqual(['Restored', 'Also restored']);
    expect(saved.workspaces[1].tabs).toEqual([{ url: 'https://a.test' }]);
  });
});

describe('schedules in words', () => {
  it('"every 30 minutes" is a schedule the engine reads as 30 minutes', () => {
    const s = ScheduleWords.parse('every 30 minutes');
    expect(s).toEqual({ type: 'interval', everyMinutes: 30 });
    expect(ScheduleWords.describe(s)).toBe('every 30 minutes');
    expect(ScheduleWords.describe(ScheduleWords.parse('every 2 hours'))).toBe('every 2 hours');
  });

  it('reads a bare hour after "at"', () => {
    expect(ScheduleWords.parse('on the 21st at 9')).toEqual({ type: 'monthly', time: '09:00', dayOfMonth: 21 });
    expect(ScheduleWords.time('every evening at 7')).toBe('19:00');
    expect(ScheduleWords.time('every morning at 9')).toBe('09:00');
    expect(ScheduleWords.time('at 25')).toBe(null);
  });
});

describe('note checkboxes and bullets', () => {
  const src = '- [ ] one\n+ [ ] two\n• [ ] three\n* [ ] four';

  it('draws a checkbox for every bullet toggleTask counts', () => {
    const boxes = NotesPanel.renderMarkdown(src).match(/data-task="\d+"/g) || [];
    expect(boxes.length).toBe(4);
  });

  it('ticking the nth box flips the nth task, whatever the bullet', () => {
    expect(NotesPanel.toggleTask(src, 2)).toBe('- [ ] one\n+ [ ] two\n• [x] three\n* [ ] four');
    expect(NotesPanel.toggleTask(src, 1)).toBe('- [ ] one\n+ [x] two\n• [ ] three\n* [ ] four');
    expect(OpenTasks.LINE.test('• [ ] three')).toBe(true);
  });
});

// Deleting was "asks first"; it is now at once with Undo (js/vex-undo.js).
describe('Escape closes them, and deleting comes with Undo', () => {
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  let offered;
  const undoReady = () => {
    require('../../src/renderer/js/vex-undo.js');
    offered = null;
    window.showToast = vi.fn((_m, _t, _d, opts) => { if (opts) offered = opts; return { dismiss() {} }; });
    window.vexConfirm = vi.fn(async () => true);
    globalThis.vexConfirm = window.vexConfirm;
  };

  it('Automations', async () => {
    undoReady();
    const rules = [
      { id: 'a1', name: 'Morning', enabled: true, trigger: { type: 'time', value: '08:00' }, action: { type: 'open', value: 'https://a.test' } },
      { id: 'a2', name: 'Evening', enabled: false, trigger: { type: 'time', value: '20:00' }, action: { type: 'open', value: 'https://b.test' } },
    ];
    localStorage.setItem('vex.automations', JSON.stringify(rules));
    Automations.open();
    document.querySelector('#vex-automations [data-del="0"]').click();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('vex.automations')).map(r => r.id)).toEqual(['a2']);
    offered.action.run();
    await Promise.resolve();
    expect(JSON.parse(localStorage.getItem('vex.automations'))).toEqual(rules);
    esc();
    expect(document.getElementById('vex-automations')).toBe(null);
  });

  it('Focus Flows', async () => {
    undoReady();
    const flows = [{ name: 'Writing', openTabs: [] }, { name: 'Reading', openTabs: [] }];
    localStorage.setItem('vex.focusFlows', JSON.stringify(flows));
    FocusFlows.open();
    document.querySelector('#vex-focusflows [data-act="del"]').click();
    expect(JSON.parse(localStorage.getItem('vex.focusFlows'))).toEqual([flows[1]]);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    offered.action.run();
    await Promise.resolve();
    expect(JSON.parse(localStorage.getItem('vex.focusFlows'))).toEqual(flows);
    esc();
    expect(document.getElementById('vex-focusflows')).toBe(null);
  });

  it('an Escape a dialog on top already used does not also close the window', () => {
    FocusFlows.open();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    document.dispatchEvent(ev);
    expect(document.getElementById('vex-focusflows')).not.toBe(null);
  });

  it('the Boost editor', () => {
    VexBoosts.boosts = {};
    VexBoosts.openEditor('a.test');
    expect(document.getElementById('boost-edit-modal')).not.toBe(null);
    esc();
    expect(document.getElementById('boost-edit-modal')).toBe(null);
  });
});

describe('quick capture', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/capture.html'), 'utf8');
  it('stops at the 4000 characters Vex accepts, and shows a refusal plainly', () => {
    expect(html).toMatch(/<input id="q" maxlength="4000"/);
    const re = /\.replace\((\/\^Error invoking remote method[^\n]*?\/), ''\)/.exec(html);
    expect(re).not.toBe(null);
    const strip = eval(re[1]);
    expect("Error invoking remote method 'capture:submit': Error: There is nothing to save".replace(strip, '')).toBe('There is nothing to save');
  });
});

describe('a sticky note restored from far away', () => {
  it('is wholly on screen, close button and all', () => {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList && this.classList.contains('vex-sticky-card')) return { left: 0, top: 0, width: 260, height: 220, right: 260, bottom: 220 };
      return real.call(this);
    };
    try {
      window.innerWidth = 1000; window.innerHeight = 700;
      localStorage.setItem('vex.stickyPos', JSON.stringify({ x: 5000, y: 5000 }));
      const card = StickyNotes.open('example.com');
      expect(parseFloat(card.style.left)).toBe(1000 - 260);
      expect(parseFloat(card.style.top)).toBe(700 - 220);
      card.remove();
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

describe('unreadable habits', () => {
  it('say so in the sheet and offer to start again, on a yes', async () => {
    localStorage.setItem('vex.habits', '{broken');
    window.vexConfirm = vi.fn(async () => true);
    const body = Habits.open();
    expect(body.textContent).toMatch(/could not be read/);
    body.querySelector('[data-reset]').click();
    await vi.waitFor(() => expect(localStorage.getItem('vex.habits')).toBe('[]'));
    expect(body.querySelector('[data-new]')).not.toBe(null);
  });
});

describe('two timers ending together', () => {
  it('ring as one card naming both, and a replaced card stops its clock', () => {
    const clear = vi.spyOn(window, 'clearInterval');
    VexClock.playTone = () => 1200;
    const now = Date.now();
    VexClock._timers = [
      { id: 't1', label: 'Tea', endAt: now - 10, total: 1000, reminderId: null },
      { id: 't2', label: 'Eggs', endAt: now - 10, total: 1000, reminderId: null },
    ];
    VexClock._tickTimers();
    const cards = document.querySelectorAll('#vex-ringing');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toMatch(/Tea/);
    expect(cards[0].textContent).toMatch(/Eggs/);
    clear.mockClear();
    VexClock.ring({ id: null, title: 'Timer', message: 'Later', kind: 'timer', snoozable: false });
    expect(clear).toHaveBeenCalled();
    VexClock.stopSound();
    document.getElementById('vex-ringing')._stopClock();
    clear.mockRestore();
  });
});

describe('a once-task made without a date', () => {
  it('defaults to the local date, not the UTC one', () => {
    const Scheduler = require('../../src/renderer/js/scheduler.js');
    const d = new Date();
    const local = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    expect(Scheduler._today()).toBe(local);
    expect(Scheduler._normalizeSchedule({ type: 'once' }).date).toBe(local);
  });
});
