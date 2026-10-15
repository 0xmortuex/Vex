// @vitest-environment jsdom
//
// Memory tools: journal, link memory, mini dashboards, clipboard actions, game
// log, backup nudge (js/memory-tools.js). Pure decisions are tested here: what
// is detected, what is refused, and what is never indexed or monitored.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexMemoryTools: M } = require('../../src/renderer/js/memory-tools.js');

const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => {
  localStorage.clear();
  M._offered.clear(); M._lastOffer = 0; M._game = null; M._started = false;
  global.window.showToast = vi.fn();
  global.window.vex = undefined;
  delete globalThis.GameSession; delete globalThis.GameMode;
});

describe('settings', () => {
  it('defaults: clipboard actions and title lookup are opt-in', () => {
    const s = M.settings();
    expect(s.clipboard).toBe(false);
    expect(s.fetchTitles).toBe(false);
    expect(s.journal).toBe(true);
  });
  it('rejects unknown names', () => {
    expect(() => M.setSetting('nope', true)).toThrow();
  });
});

describe('clipboard detection', () => {
  it('finds tracking numbers', () => {
    expect(M.detectClip('1Z999AA10123456784')).toMatchObject({ kind: 'tracking', carrier: 'UPS' });
    expect(M.detectClip('RB123456789GB')).toMatchObject({ kind: 'tracking' });
    expect(M.detectClip('hello world')).toBeNull();
  });
  it('finds a future date and not a past one', () => {
    const y = new Date().getFullYear() + 1;
    expect(M.detectClip(y + '-03-04 14:30')).toMatchObject({ kind: 'date' });
    expect(M.detectClip('2001-03-04')).toBeNull();
    expect(M.detectClip('We should probably get together about the garden on March 4, ' + y)).toBeNull();   // a sentence is not a date
  });
  it('finds a street address', () => {
    expect(M.detectClip('221 Baker Street, London')).toMatchObject({ kind: 'address' });
    expect(M.detectClip('Hauptstrasse 12, 10115 Berlin')).toMatchObject({ kind: 'address' });
  });
  it('never looks at a link', () => {
    expect(M.detectClip('https://example.com/track/1Z999AA10123456784')).toBeNull();
  });
});

describe('offering', () => {
  const offer = () => M.onCopy({ text: '1Z999AA10123456784' });
  beforeEach(() => { vi.spyOn(M, '_inFront').mockReturnValue(true); });
  it('does nothing until it is turned on', () => {
    expect(offer()).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('offers once when on, with an action', () => {
    M.setSetting('clipboard', true);
    expect(offer()).toMatchObject({ kind: 'tracking' });
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][3].action.label).toBe('Track it');
    expect(offer()).toBeNull();
  });
  it('is silent while a game runs or Vex is not in front', () => {
    M.setSetting('clipboard', true);
    globalThis.GameSession = { active: true };
    expect(offer()).toBeNull();
    delete globalThis.GameSession;
    M._inFront.mockReturnValue(false);
    expect(offer()).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
  });
});

describe('link memory', () => {
  it('extracts links with context and skips ones carrying secrets', () => {
    const links = M.extractLinks('Read this: https://example.com/a. And [Docs](https://docs.example.com/x)\nhttps://x.example/?token=abc\nhttps://user:pw@h.example/');
    const urls = links.map(l => l.url);
    expect(urls).toContain('https://example.com/a');
    expect(urls).toContain('https://docs.example.com/x');
    expect(urls.some(u => /token|user/.test(u))).toBe(false);
    expect(links.find(l => l.url === 'https://docs.example.com/x').title).toBe('Docs');
  });
  it('indexes notes once and honours forgetting', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n', title: 'Trip', content: 'Hotel https://hotel.example/book', updatedAt: 5 }]));
    expect(M.scanLinks()).toBe(1);
    expect(M.scanLinks()).toBe(0);
    expect(M.searchLinks('hotel')).toHaveLength(1);
    M.forgetLink('https://hotel.example/book');
    expect(M.scanLinks()).toBe(0);
    expect(M.searchLinks('hotel')).toHaveLength(0);
  });
  it('never treats private hosts as fetchable', () => {
    expect(M._isPrivateHost('https://192.168.1.2/')).toBe(true);
    expect(M._isPrivateHost('https://localhost/')).toBe(true);
    expect(M._isPrivateHost('https://example.com/')).toBe(false);
  });
});

describe('dashboards', () => {
  it('accepts plain endpoints and refuses credentials', () => {
    expect(M.validateTarget('github', 'owner/repo')).toBe('owner/repo');
    expect(M.validateTarget('http', 'https://example.com/health')).toBe('https://example.com/health');
    expect(() => M.validateTarget('http', 'https://u:p@example.com/')).toThrow(/password/i);
    expect(() => M.validateTarget('http', 'https://example.com/?api_key=1')).toThrow(/secret/i);
    expect(() => M.validateTarget('http', 'http://example.com/')).toThrow(/https/);
    expect(() => M.validateTarget('github', 'not a repo')).toThrow();
  });
  it('caps and de-duplicates widgets', () => {
    M.addWidget({ type: 'github', target: 'a/b' });
    expect(() => M.addWidget({ type: 'github', target: 'a/b' })).toThrow(/already/);
    expect(M.widgets()).toHaveLength(1);
  });
});

describe('journal', () => {
  it('writes a day from history and notes, and keeps an edited day', async () => {
    localStorage.setItem('vex.history', JSON.stringify([{ url: 'https://a.example/', title: 'Alpha', visitedAt: new Date(day(2026, 5, 4)).toISOString() }]));
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n', title: 'Plan', content: '', createdAt: day(2026, 5, 4, 15), updatedAt: day(2026, 5, 4, 15) }]));
    const e = await M.ensureDay('2026-05-04');
    expect(e.text).toContain('[Alpha](https://a.example/)');
    expect(e.text).toContain('Wrote a note: Plan');
    M.saveEntry('2026-05-04', 'mine');
    const again = await M.ensureDay('2026-05-04', { force: true });
    expect(again.text).toBe('mine');
    expect(M.exportMarkdown).toBeTypeOf('function');
  });
  it('writes nothing for an empty day', async () => {
    expect(await M.ensureDay('2026-05-05')).toBeNull();
  });
});

describe('game log', () => {
  it('logs a finished game with slept tabs and closed tabs, and skips a blip', () => {
    globalThis.GameMode = { _gamingReport: { slept: 3 } };
    M._onGameState({ game: true, app: 'Foo' });
    M._game.start = Date.now() - 3600000;
    M._game.closed = 1;
    const e = M._onGameState({ game: false });
    expect(e).toMatchObject({ app: 'Foo', slept: 3, closed: 1 });
    expect(M.gameLine(e)).toMatch(/Foo, 1 h, 3 tabs slept, 1 tab closed/);
    M._onGameState({ game: true, app: 'Blip' });
    expect(M._onGameState({ game: false })).toBeNull();
    expect(M.gameLog()).toHaveLength(1);
  });
});

describe('backup nudge', () => {
  it('is due a week after first sight or last backup', () => {
    const t = Date.now();
    expect(M.backupDue(t)).toBe(false);
    expect(M.backupDue(t + 8 * 86400000)).toBe(true);
    localStorage.setItem(M.KEYS.lastBackup, String(t + 7 * 86400000));
    expect(M.backupDue(t + 8 * 86400000)).toBe(false);
  });
});

describe('brief modules', () => {
  it('exposes id/title/build/isEnabled', async () => {
    M._wired = false;
    M.init();
    for (const m of M.briefModules) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.isEnabled()).toBe('boolean');
    }
    const g = M.briefModules.find(m => m.id === 'game-log');
    expect((await g.build()).items).toEqual([]);
    M._timers.forEach(clearTimeout); M._timers.forEach(clearInterval);
  });
});
