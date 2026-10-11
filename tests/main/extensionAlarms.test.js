// @vitest-environment node
//
// EX5: chrome.alarms took alarms and never fired onAlarm (Electron's own).
// Main keeps them now (src/main/extension-alarms.js) and the stand-ins put
// an alarms API in front of Electron's that goes to main.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { createExtensionAlarms } = req('../../src/main/extension-alarms.js');
const SW = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8').replace(/\r\n/g, '\n');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const MIN = 60000;

function clock(start = 1_000_000) {
  let t = start, seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; await next[1].fn();
      }
      t = end;
    },
  };
}
function make({ saved = {}, outcome = 'fired' } = {}) {
  const c = clock(); const fired = []; const saves = [];
  const a = createExtensionAlarms({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, load: () => saved,
    save: (d) => saves.push(JSON.parse(JSON.stringify(d))), fire: async (key, alarm) => { fired.push([key, alarm.name, alarm.scheduledTime]); return typeof outcome === 'function' ? outcome() : outcome; } });
  return { a, c, fired, saves };
}
const K = 'persist:main|abcdefghijklmnopabcdefghijklmnop';

describe('alarms fire', () => {
  it('a one-shot alarm fires once, when due, and is gone after', async () => {
    const { a, c, fired } = make();
    a.create(K, 'once', { delayInMinutes: 1 });
    expect(a.get(K, 'once')).toEqual({ name: 'once', scheduledTime: c.now() + MIN });
    await c.advance(59000);
    expect(fired).toEqual([]);
    await c.advance(1000);
    expect(fired.map(f => f[1])).toEqual(['once']);
    expect(a.getAll(K)).toEqual([]);
  });
  it('a periodic alarm repeats, and the period is the first delay when nothing else is given', async () => {
    const { a, c, fired } = make();
    a.create(K, 'p', { periodInMinutes: 0.5 });
    await c.advance(95000);
    expect(fired.length).toBe(3);
    expect(a.get(K, 'p').periodInMinutes).toBe(0.5);
  });
  it('nothing sooner than 30 seconds; the default name is ""; a same-named alarm replaces it', async () => {
    const { a, c } = make();
    a.create(K, undefined, { delayInMinutes: 0.01 });
    expect(a.get(K).scheduledTime).toBe(c.now() + 30000);
    a.create(K, '', { when: c.now() + 5 * MIN });
    expect(a.getAll(K)).toEqual([{ name: '', scheduledTime: c.now() + 5 * MIN }]);
    expect(() => a.create(K, 'x', {})).toThrow(/when, delayInMinutes or periodInMinutes/);
  });
  it('clear and clearAll answer whether there was one, and stop it firing', async () => {
    const { a, c, fired } = make();
    a.create(K, 'a', { delayInMinutes: 1 }); a.create(K, 'b', { delayInMinutes: 1 });
    expect(a.clear(K, 'a')).toBe(true);
    expect(a.clear(K, 'a')).toBe(false);
    expect(a.clearAll(K)).toBe(true);
    await c.advance(2 * MIN);
    expect(fired).toEqual([]);
  });
  it('each extension in each session has its own', () => {
    const { a } = make();
    a.create(K, 'a', { delayInMinutes: 1 });
    expect(a.getAll('persist:container-work|abcdefghijklmnopabcdefghijklmnop')).toEqual([]);
  });
});

describe('alarms outlive a restart', () => {
  it('are saved, and one missed while Vex was closed fires soon after start', async () => {
    const first = make();
    first.a.create(K, 'p', { periodInMinutes: 60 });
    const saved = first.saves.at(-1);
    expect(saved[K][0].name).toBe('p');
    const later = make({ saved: { [K]: [{ ...saved[K][0], scheduledTime: 1 }] } });
    later.a.restore();
    await later.c.advance(15000);
    expect(later.fired.map(f => f[1])).toEqual(['p']);
    expect(later.a.get(K, 'p').scheduledTime).toBeGreaterThan(later.c.now());
  });
  it('an extension no longer there loses its alarms; one whose session is not made yet is tried again', async () => {
    const gone = make({ outcome: 'gone' });
    gone.a.create(K, 'p', { periodInMinutes: 1 });
    await gone.c.advance(MIN);
    expect(gone.a.getAll(K)).toEqual([]);
    const later = make({ outcome: 'later' });
    later.a.create(K, 'o', { delayInMinutes: 1 });
    await later.c.advance(MIN);
    expect(later.a.get(K, 'o')).toBeTruthy();
  });
});

describe('the stand-in and main', () => {
  it('the stand-ins put main\'s alarms in front of Electron\'s, with onAlarm from main', () => {
    expect(SW).toMatch(/api\('alarms\.create'/);
    expect(SW).toMatch(/onAlarm: hubEvent\('alarms\.onAlarm'\)/);
    expect(SW).toMatch(/else takeOver\(c\.alarms, alarmsApi, 'alarms'\)/);
  });
  it('main answers them only for an extension with the permission, and fires through _extDispatch', () => {
    expect(MAIN).toMatch(/case 'alarms\.create': needPerm\('alarms'\);/);
    expect(MAIN).toMatch(/_extDispatch\(ses, extId, 'alarms\.onAlarm', \[alarm\]\)/);
    expect(MAIN).toMatch(/_extAlarms\.restore\(\)/);
  });
});
