// @vitest-environment jsdom
//
// One box: the lines Ctrl+K reads on top of quick-commands.js, and what it
// refuses to read.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexOneBox: B } = require('../../src/renderer/js/one-box.js');
const { VexQuickCommands: QC } = require('../../src/renderer/js/quick-commands.js');
const { VexQuickReminder: R } = require('../../src/renderer/js/quick-reminder.js');

const at = (h, m = 0, d = 16) => new Date(2026, 9, d, h, m, 0, 0);

beforeEach(() => { localStorage.clear(); });

describe('what it understands', () => {
  it('a note', () => {
    expect(B.understand('note: idea for the trip')).toMatchObject({ kind: 'note', text: 'idea for the trip' });
    expect(B.understand('jot down buy milk')).toMatchObject({ kind: 'note', text: 'buy milk' });
    expect(B.understand('add a note that the router is on 192.168.1.1')).toMatchObject({ kind: 'note' });
    expect(B.understand('note:')).toBeNull();
    expect(B.understand('notes')).toBeNull();
  });

  it('GitHub pages', () => {
    expect(B.understand('open GitHub PRs')).toMatchObject({ kind: 'open', url: 'https://github.com/pulls' });
    expect(B.understand('open github pull requests')).toMatchObject({ url: 'https://github.com/pulls' });
    expect(B.understand('show my github issues')).toMatchObject({ url: 'https://github.com/issues' });
    expect(B.understand('go to github notifications')).toMatchObject({ url: 'https://github.com/notifications' });
    expect(B.understand('open github')).toMatchObject({ url: 'https://github.com/' });
    expect(B.understand('open github desktop')).toBeNull();
  });

  it('GitHub repositories need the username and encode it', () => {
    expect(B.understand('open github repos')).toMatchObject({ kind: 'error' });
    expect(B.understand('open github repos', { githubUser: 'a b' })).toMatchObject({ url: 'https://github.com/a%20b?tab=repositories' });
  });

  it('time to read, the timeline and living bookmarks', () => {
    expect(B.understand("I have 20 minutes")).toMatchObject({ kind: 'minutes', minutes: 20 });
    expect(B.understand('got half an hour')).toMatchObject({ kind: 'minutes', minutes: 30 });
    expect(B.understand('I have a cat')).toBeNull();
    expect(B.understand('timeline')).toMatchObject({ kind: 'timeline', by: 'day' });
    expect(B.understand('show my timeline this week')).toMatchObject({ kind: 'timeline', by: 'week' });
    expect(B.understand('what did I do yesterday?')).toMatchObject({ kind: 'timeline' });
    expect(B.understand('are my bookmarks still alive?')).toMatchObject({ kind: 'livemarks' });
  });

  it('never reads a destructive sentence as an order', () => {
    for (const s of ['delete note: old', 'clear github notifications', 'remove my bookmarks', 'close all tabs', 'reset timeline', 'forget my history', 'stop the timeline']) {
      expect(B.understand(s)).toBeNull();
    }
  });
});

describe('"remind me … at 5"', () => {
  it('a bare hour is the next one that comes, not 5 in the morning', () => {
    const afternoon = B.rewriteBareHour('remind me to call Sam at 5', at(14));
    expect(afternoon.text).toBe('remind me to call Sam at 17:00');
    expect(afternoon.note).toContain('17:00');
    const lateNight = B.rewriteBareHour('remind me to call Sam at 5', at(23, 30));
    expect(lateNight.text).toBe('remind me to call Sam at 05:00');
    expect(B.rewriteBareHour('remind me to call Sam at 5', at(3)).text).toBe('remind me to call Sam at 05:00');
    expect(B.rewriteBareHour('remind me at 9:30 to stretch', at(10)).text).toBe('remind me to stretch at 21:30');
  });

  it('leaves what is already clear alone', () => {
    expect(B.rewriteBareHour('remind me to call Sam at 5pm', at(14))).toBeNull();
    expect(B.rewriteBareHour('remind me to call Sam at 17:00', at(14))).toBeNull();
    expect(B.rewriteBareHour('remind me to call Sam tomorrow 9am', at(14))).toBeNull();
    expect(B.rewriteBareHour('timer 20', at(14))).toBeNull();
  });

  it('the rewritten sentence goes through the existing reminder parser', () => {
    const fixed = B.rewriteBareHour('remind me to call Sam at 5', at(14));
    const t = R.parseTrigger('at ' + fixed.text.split(' at ').pop(), at(14));
    expect(t.at.getHours()).toBe(17);
  });
});

describe('rows and installation', () => {
  it('a row says what it understood before it runs', () => {
    const [row] = B.results('note: idea');
    expect(row).toMatchObject({ id: 'quick-onebox-note', isPrimary: true });
    expect(row.hint).toMatch(/^Understood as: A new note/);
    expect(localStorage.getItem('vex.notes')).toBeNull();      // nothing ran yet
  });

  it('running a note adds a new one and keeps the old ones', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'old', title: 'Old', content: 'keep me' }]));
    B.addNote('idea for the trip\nsecond line');
    const notes = JSON.parse(localStorage.getItem('vex.notes'));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ title: 'idea for the trip', content: 'idea for the trip\nsecond line' });
    expect(notes[1].id).toBe('old');
    expect(() => B.addNote('   ')).toThrow(/needs some text/);
  });

  it('install adds its rows ahead of the existing ones, once, and fixes the bare hour', () => {
    const seen = [];
    const qc = { results(raw) { seen.push(raw); return [{ id: 'quick-remind', hint: 'Today at 5:00 AM', isPrimary: true }]; } };
    expect(B.install(qc)).toBe(true);
    expect(B.install(qc)).toBe(false);
    const out = qc.results('note: hello');
    expect(out.map(r => r.id)).toEqual(['quick-onebox-note', 'quick-remind']);
    qc.results('remind me to call Sam at 5');
    expect(seen[1]).toMatch(/^remind me to call Sam at \d\d:\d\d$/);
  });

  it('can be switched off without losing the bare-hour fix', () => {
    B.setEnabled(false);
    const qc = { results() { return []; } };
    B.install(qc);
    expect(qc.results('note: hello')).toEqual([]);
    B.setEnabled(true);
  });

  it('works with the real quick-commands module', () => {
    B.install(QC);
    const ids = QC.results('timeline').map(r => r.id);
    expect(ids).toContain('quick-onebox-timeline');
  });
});
