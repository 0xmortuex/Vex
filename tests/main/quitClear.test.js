// @vitest-environment node
//
// Clear history, cookies and cache when Vex closes (src/main/quit-clear.js), tested with fake sessions. The real Electron
// session.clearData with excludeOrigins was NOT run here (no Electron probe in this wave): CI proves the logic, the owner
// should try it once on a throwaway profile.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), path = require('path');
const { createQuitClear, parseConfig, isKept } = require('../../src/main/quit-clear.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

function fakeSession(cookies) {
  const ses = {
    removed: [], dataCalls: [], cache: 0, flushed: 0,
    cookies: {
      get: vi.fn(async () => cookies.slice()),
      remove: vi.fn(async (url, name) => { ses.removed.push(name + '@' + new URL(url).hostname); }),
    },
    clearData: vi.fn(async (o) => { ses.dataCalls.push(o); }),
    clearCache: vi.fn(async () => { ses.cache += 1; }),
    flushStorageData: vi.fn(async () => { ses.flushed += 1; }),
  };
  return ses;
}
const jar = () => [
  { name: 'a', domain: '.school.example', path: '/', secure: true },
  { name: 'b', domain: 'bank.example.org', path: '/', secure: true },
  { name: 'c', domain: '.mail.bank.example.org', path: '/', secure: true },
  { name: 'd', domain: '.netflix.com', path: '/', secure: true },
];
function make({ config, ending = 'quitting', partitions = ['persist:main'], sessions, clearHistory } = {}) {
  const hist = clearHistory || vi.fn(async () => {});
  const note = vi.fn();
  const q = createQuitClear({
    getConfig: () => config, partitions: () => partitions, sessionFor: (p) => sessions[p],
    ending: () => ending, noteDeliberate: note, clearHistory: hist, log: { error: vi.fn() },
  });
  return { q, hist, note };
}

describe('parseConfig', () => {
  it('anything but an explicit on is off', () => {
    expect(parseConfig(null)).toEqual({ on: false, keep: [] });
    expect(parseConfig('{nope')).toEqual({ on: false, keep: [] });
    expect(parseConfig({ on: 'yes', keep: ['a.example'] })).toEqual({ on: false, keep: [] });
  });
  it('reads a saved value (object or JSON text) and drops bad hosts and duplicates', () => {
    const v = { on: true, keep: ['Bank.Example.org', 'www.bank.example.org', 'bad host!', 5, 'other.example'] };
    expect(parseConfig(v)).toEqual({ on: true, keep: ['bank.example.org', 'other.example'] });
    expect(parseConfig(JSON.stringify(v)).on).toBe(true);
  });
});

describe('isKept', () => {
  it('keeps a listed host, its subdomains, and the sites Vex needs signed in', () => {
    expect(isKept('mail.bank.example.org', ['bank.example.org'])).toBe(true);
    expect(isKept('bank.example.org', ['bank.example.org'])).toBe(true);
    expect(isKept('notbank.example.org', ['bank.example.org'])).toBe(false);
    expect(isKept('www.netflix.com', [])).toBe(true);
    expect(isKept('school.example', [])).toBe(false);
  });
});

describe('at quit', () => {
  it('does nothing when the switch is off, even on a deliberate exit', async () => {
    const ses = fakeSession(jar());
    const { q, hist, note } = make({ config: { on: false, keep: [] }, sessions: { 'persist:main': ses } });
    expect(await q.run()).toEqual({ skipped: 'off' });
    expect(ses.cookies.get).not.toHaveBeenCalled();
    expect(hist).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
  });
  it('does nothing when the exit was not marked as a deliberate one (a crash)', async () => {
    const ses = fakeSession(jar());
    const { q, hist } = make({ config: { on: true, keep: [] }, ending: null, sessions: { 'persist:main': ses } });
    expect(await q.run()).toEqual({ skipped: 'not a deliberate exit' });
    expect(ses.cookies.remove).not.toHaveBeenCalled();
    expect(hist).not.toHaveBeenCalled();
  });
  it('removes the cookies of sites that are not kept, keeps the rest, clears data and cache, clears history', async () => {
    const ses = fakeSession(jar());
    const { q, hist, note } = make({ config: { on: true, keep: ['bank.example.org'] }, sessions: { 'persist:main': ses } });
    const r = await q.run();
    expect(ses.removed).toEqual(['a@school.example']);
    expect(r.cookies).toBe(1);
    expect(r.errors).toEqual([]);
    expect(ses.dataCalls).toHaveLength(1);
    expect(ses.dataCalls[0].dataTypes).not.toContain('cookies');
    expect(ses.dataCalls[0].excludeOrigins).toEqual(expect.arrayContaining(['https://bank.example.org', 'https://mail.bank.example.org', 'https://netflix.com']));
    expect(ses.cache).toBe(1);
    expect(ses.flushed).toBe(1);
    expect(hist).toHaveBeenCalledTimes(1);
    expect(r.history).toBe(true);
    expect(note).toHaveBeenCalledTimes(1);
  });
  it('never touches a panel session or a private one', async () => {
    const main1 = fakeSession(jar()), panel = fakeSession(jar());
    const { q } = make({ config: { on: true, keep: [] }, partitions: ['persist:main', 'persist:spotify', 'persist:route-tor'], sessions: { 'persist:main': main1, 'persist:spotify': panel, 'persist:route-tor': panel } });
    await q.run();
    expect(main1.cache).toBe(1);
    expect(panel.cookies.get).not.toHaveBeenCalled();
    expect(panel.clearCache).not.toHaveBeenCalled();
  });
  it('sweeps a container session too', async () => {
    const c = fakeSession(jar());
    const { q } = make({ config: { on: true, keep: [] }, partitions: ['persist:container-work'], sessions: { 'persist:container-work': c } });
    await q.run();
    expect(c.removed).toContain('a@school.example');
  });
  it('a failing step is reported and the rest still runs', async () => {
    const ses = fakeSession(jar());
    ses.cookies.remove = vi.fn(async () => { throw new Error('locked'); });
    ses.clearData = vi.fn(async () => { throw new Error('busy'); });
    const hist = vi.fn(async () => { throw new Error('disk'); });
    const { q } = make({ config: { on: true, keep: [] }, sessions: { 'persist:main': ses }, clearHistory: hist });
    const r = await q.run();
    expect(r.errors.join('|')).toMatch(/locked/);
    expect(r.errors.join('|')).toMatch(/busy/);
    expect(r.errors.join('|')).toMatch(/history: disk/);
    expect(ses.cache).toBe(1);
    expect(r.history).toBe(false);
  });
});

describe('wiring in main.js', () => {
  it('runs inside the quit wait of the forget-a-site sweep and leaves its pinned lines alone', () => {
    expect(main).toMatch(/_siteForget\.onQuit = async \(\) => \{[\s\S]{0,200}_quitClear\.run\(\)/);
    expect(main).toMatch(/ending: \(\) => _exitWatch\.ending\(\)/);
    expect(main).toMatch(/noteDeliberate: \(\) => _massSignoutDeliberate\('auto-clear-quit'\)/);
    expect(main).toMatch(/_massSignoutDeliberate\('forget-site-quit'\);\r?\n\s*_siteForget\.onQuit\(\)/);
  });
});
