// @vitest-environment jsdom
//
// Weekly note (js/weekly-note.js): clips are recorded with address and time,
// and a "Week of <Monday>" note is written from them. Only the marked block is
// Vex's; what is written around it stays.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let N;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/weekly-note.js');
  N = window.VexWeeklyNote;
});

afterEach(() => { vi.restoreAllMocks(); });

// Wednesday 2030-01-09 is in the week of Monday 2030-01-07.
const wed = new Date(2030, 0, 9, 12, 0);

describe('the week', () => {
  it('starts on Monday', () => {
    expect(N._ymd(N.weekStart(wed))).toBe('2030-01-07');
    expect(N._ymd(N.weekStart(new Date(2030, 0, 13, 23, 0)))).toBe('2030-01-07'); // Sunday
    expect(N.title(wed)).toBe('Week of 2030-01-07');
  });
});

describe('the clip record', () => {
  it('keeps address, title, time and a short text, and only for web pages', () => {
    expect(N.recordClip({ url: 'https://a.test/x', title: 'A', text: 'hello' })).toBe(true);
    expect(N.recordClip({ url: 'vex://start', title: 'S', text: '' })).toBe(false);
    const l = N.log();
    expect(l).toHaveLength(1);
    expect(l[0].url).toBe('https://a.test/x');
    expect(typeof l[0].at).toBe('number');
  });

  it('records nothing while it is switched off', () => {
    window.VexWorkflow.setPref('weeklyNote', false);
    expect(N.recordClip({ url: 'https://a.test/', title: 'A', text: '' })).toBe(false);
  });

  it('is capped', () => {
    const many = Array.from({ length: N.MAX_LOG + 20 }, (_, i) => ({ url: 'https://a.test/' + i, title: 't', text: '', at: i + 1 }));
    localStorage.setItem(N.LOG_KEY, JSON.stringify(many));
    N.recordClip({ url: 'https://a.test/new', title: 't', text: '' });
    expect(N.log()).toHaveLength(N.MAX_LOG);
  });
});

describe('generating the note', () => {
  beforeEach(() => {
    localStorage.setItem(N.LOG_KEY, JSON.stringify([
      { url: 'https://a.test/1', title: 'First', text: 'a quote', at: new Date(2030, 0, 8, 9, 0).getTime() },
      { url: 'https://b.test/2', title: 'Old', text: '', at: new Date(2029, 11, 1).getTime() },
    ]));
  });

  it('writes a note with this week’s clips and links back, not last month’s', () => {
    const r = N.generate(wed);
    expect(r.created).toBe(true);
    expect(r.note.title).toBe('Week of 2030-01-07');
    expect(r.note.content).toContain('[First](https://a.test/1)');
    expect(r.note.content).not.toContain('b.test');
    expect(r.counts.clips).toBe(1);
    const stored = JSON.parse(localStorage.getItem('vex.notes'));
    expect(stored).toHaveLength(1);
  });

  it('rewrites only its own block and keeps what was written around it', () => {
    N.generate(wed);
    const notes = JSON.parse(localStorage.getItem('vex.notes'));
    notes[0].content = 'My intro\n\n' + notes[0].content + '\n\nMy afterthought';
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    const again = N.generate(wed);
    expect(again.created).toBe(false);
    expect(again.note.content.startsWith('My intro')).toBe(true);
    expect(again.note.content.endsWith('My afterthought')).toBe(true);
    expect(again.note.content.split(N.START)).toHaveLength(2);
  });

  it('refuses when notes cannot be read, rather than writing over them', () => {
    localStorage.setItem('vex.notes', '{not json');
    expect(() => N.generate(wed)).toThrow(/could not be read/);
  });

  it('the automatic note runs once, on Friday evening, only when asked for', () => {
    const fri = new Date(2030, 0, 11, 18, 0);
    expect(N._tick(fri)).toBe(false);
    window.VexWorkflow.setPref('weeklyNoteAuto', true);
    expect(N._tick(new Date(2030, 0, 10, 18, 0))).toBe(false);
    expect(N._tick(fri)).toBe(true);
    expect(N._tick(fri)).toBe(false);
  });
});
