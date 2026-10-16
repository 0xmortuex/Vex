// @vitest-environment jsdom
//
// js/service-check.js (T3-016): "Is it me or the game?" from status pages and the connection timing.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexServiceCheck } = require('../../src/renderer/js/service-check.js');

const ok = (name, indicator, description, extra = {}) => ({ ok: true, url: 'https://' + name + '/api/v2/summary.json', host: name, name, indicator, description, incidents: [], ...extra });
const fine = { verdict: 'Your connection is fine (20 ms), and so is every service Vex checked.' };
const slow = { verdict: 'Your own connection is slow right now (400 ms) to a server that is never slow.' };
const none = { verdict: 'Nothing answered at all - that is your connection, not any one service.' };

beforeEach(() => { localStorage.clear(); delete globalThis.VexAttention; delete window.vex; VexServiceCheck.setEnabled(true); });

describe('the answer', () => {
  it('blames them when a listed service reports a problem and the line is fine', () => {
    const a = VexServiceCheck.combine([ok('Discord', 'minor', 'Partial outage')], fine);
    expect(a.who).toBe('them');
    expect(a.headline).toMatch(/Discord reports "Partial outage"/);
    expect(a.lines.some(l => /summary\.json/.test(l.source))).toBe(true);
  });
  it('blames the connection when it is slow, and says both when both are', () => {
    expect(VexServiceCheck.combine([ok('Discord', 'none', 'ok')], slow).who).toBe('you');
    expect(VexServiceCheck.combine([ok('Discord', 'none', 'ok')], none).who).toBe('you');
    expect(VexServiceCheck.combine([ok('Discord', 'major', 'Outage')], slow).who).toBe('unclear');
  });
  it('says fine only when nothing is reported, and never claims it when no page could be read', () => {
    expect(VexServiceCheck.combine([ok('Discord', 'none', 'ok')], fine).who).toBe('fine');
    const unread = VexServiceCheck.combine([{ ok: false, url: 'https://a/x', host: 'a', error: 'It answered 500' }], fine);
    expect(unread.who).toBe('unclear');
    expect(unread.lines[0].text).toMatch(/could not be read/);
  });
});

describe('the list', () => {
  it('stores a site as a host, refuses duplicates, http and a login, and caps at twelve', () => {
    expect(VexServiceCheck.add('https://www.githubstatus.com/')).toBe('www.githubstatus.com');
    expect(() => VexServiceCheck.add('www.githubstatus.com')).toThrow(/already listed/);
    expect(() => VexServiceCheck.add('http://a.example')).toThrow(/https/);
    expect(() => VexServiceCheck.add('https://u:p@a.example')).toThrow(/user name/);
    for (let i = 0; i < 11; i++) VexServiceCheck.add('s' + i + '.example');
    expect(() => VexServiceCheck.add('one.more.example')).toThrow(/as many/);
  });
  it('adds the usual five once and then nothing', () => {
    expect(VexServiceCheck.addPresets()).toBe(5);
    expect(VexServiceCheck.addPresets()).toBe(0);
  });
  it('refuses to ask with an empty list or when switched off', async () => {
    await expect(VexServiceCheck.fetchStatus()).rejects.toThrow(/List at least one/);
    VexServiceCheck.setEnabled(false);
    await expect(VexServiceCheck.ask()).rejects.toThrow(/switched off/);
  });
});

describe('asking and the New Tab line', () => {
  it('reads the listed pages and the timing together, and remembers the answer', async () => {
    VexServiceCheck.add('discordstatus.com');
    window.vex = { statusCheck: vi.fn(async () => [ok('Discord', 'minor', 'Partial System Outage')]), netLatency: vi.fn(async () => ({ ok: true, ...fine })) };
    const a = await VexServiceCheck.ask();
    expect(window.vex.statusCheck).toHaveBeenCalledWith(['discordstatus.com']);
    expect(a.who).toBe('them');
    expect(VexServiceCheck.widgetLines()).toEqual(['Discord: Partial System Outage']);
  });
  it('shows a line only for an incident, and not a stale one', async () => {
    VexServiceCheck._remember([ok('Discord', 'none', 'ok'), ok('GitHub', 'major', 'Major outage')]);
    expect(VexServiceCheck.widgetLines()).toEqual(['GitHub: Major outage']);
    expect(VexServiceCheck.widgetLines(Date.now() + 4 * 3600000)).toEqual([]);
    VexServiceCheck.setEnabled(false);
    expect(VexServiceCheck.widgetLines()).toEqual([]);
  });
  it('the quiet check does nothing unless the background switch is on, then tells once about a new incident', async () => {
    VexServiceCheck.add('discordstatus.com');
    window.vex = { statusCheck: vi.fn(async () => [ok('Discord', 'minor', 'Partial outage')]) };
    expect(await VexServiceCheck.tick()).toBeNull();
    expect(window.vex.statusCheck).not.toHaveBeenCalled();
    VexServiceCheck.setBackground(true);
    const notify = vi.fn((o, show) => show());
    globalThis.VexAttention = { notify };
    window.showToast = vi.fn();
    await VexServiceCheck.tick();
    await VexServiceCheck.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'service-check', urgency: 'useful' });
  });
});
