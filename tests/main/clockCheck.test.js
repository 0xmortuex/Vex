// "Is this computer's clock right?" (src/main/clock-check.js): the Authenticator's codes are made from the PC clock,
// so a clock that is off makes every code wrong. The measurement, the cache, the corrected time and the request are
// driven with a fake PC clock, a fake counting clock and a stand-in for Electron's net.request.
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const clock = require('../../src/main/clock-check.js');

const T = Date.parse('Tue, 10 Nov 2026 16:05:17 GMT');
const header = (ms) => new Date(ms).toUTCString();

describe('offsetMs', () => {
  it('is about zero for a right clock (the header drops up to a second)', () => {
    expect(Math.abs(clock.offsetMs(header(T), T + 400, T + 600))).toBeLessThanOrEqual(1000);
  });
  it('is positive when the PC is ahead, negative when behind', () => {
    expect(clock.offsetMs(header(T), T + 19200, T + 19400)).toBeGreaterThan(18000);
    expect(clock.offsetMs(header(T), T - 30000, T - 29900)).toBeLessThan(-29000);
  });
  it('refuses an answer it cannot measure by', () => {
    expect(() => clock.offsetMs('', T, T + 10)).toThrow(/Date header/);
    expect(() => clock.offsetMs('not a date', T, T + 10)).toThrow(/Date header/);
    expect(() => clock.offsetMs(header(T), T, T + clock.MAX_ROUND_TRIP_MS + 1)).toThrow(/too slow/);
    expect(() => clock.offsetMs(header(T), T + 10, T)).toThrow(/not valid/);
  });
});

// A world with a true time, a PC clock that is `pcAheadMs` off it, and a counting clock. advance() lets time pass;
// setPc() is the person (or Windows) setting the PC clock.
function world(pcAheadMs, { online = true } = {}) {
  const w = { real: T, ahead: pcAheadMs, mono: 5000, calls: 0, online };
  w.now = () => w.real + w.ahead;
  w.check = clock.createClockCheck({
    now: w.now,
    mono: () => w.mono,
    request: async () => {
      w.calls++;
      if (!w.online) throw new Error('net::ERR_INTERNET_DISCONNECTED');
      const sentAt = w.now();
      return { date: header(w.real), sentAt, receivedAt: sentAt + 100 };
    },
  });
  w.advance = (ms) => { w.real += ms; w.mono += ms; };
  w.setPc = (aheadMs) => { w.ahead = aheadMs; };
  return w;
}

describe('check', () => {
  it('says a clock 19 seconds fast is wrong and ahead', async () => {
    const r = await world(19200).check.check();
    expect(r.wrong).toBe(true);
    expect(r.ahead).toBe(true);
    expect(r.offsetSeconds).toBeGreaterThanOrEqual(18);
    expect(r.offsetSeconds).toBeLessThanOrEqual(20);
  });
  it('says a clock 40 seconds slow is wrong and behind', async () => {
    expect(await world(-40000).check.check()).toMatchObject({ wrong: true, ahead: false });
  });
  it('leaves a clock a few seconds off alone', async () => {
    expect((await world(3000).check.check()).wrong).toBe(false);
    expect((await world(0).check.check()).wrong).toBe(false);
    expect((await world(-3000).check.check()).wrong).toBe(false);
  });
  it('keeps a right clock for ten minutes, then asks again', async () => {
    const w = world(1000);
    await w.check.check();
    w.advance(clock.CACHE_MS - 1000);
    await w.check.check();
    expect(w.calls).toBe(1);
    w.advance(2000);
    await w.check.check();
    expect(w.calls).toBe(2);
  });
  it('keeps a wrong clock for a minute only', async () => {
    const w = world(19200);
    await w.check.check();
    w.advance(30000);
    await w.check.check();
    expect(w.calls).toBe(2);                         // the two requests of the first look, none since
    w.advance(clock.WRONG_CACHE_MS);
    await w.check.check();
    expect(w.calls).toBe(4);
  });
  it('measures again at once when the PC clock was set', async () => {
    const w = world(19200);
    expect((await w.check.check()).wrong).toBe(true);
    w.advance(3000);
    w.setPc(0);                                  // "Sync now"
    const r = await w.check.check();
    expect(w.calls).toBe(3);                     // two to call it wrong, one to find it right
    expect(r.wrong).toBe(false);
  });
  it('rejects when the clock could not be measured', async () => {
    await expect(world(0, { online: false }).check.check()).rejects.toThrow(/DISCONNECTED/);
  });
  it('shares one request between callers that ask together', async () => {
    const w = world(19200);
    await Promise.all([w.check.check(), w.check.check(), w.check.time()]);
    expect(w.calls).toBe(2);                     // one look (two requests, the clock being wrong), not three
  });
});

// The probe sits behind a cache that may keep an answer for an hour. A stored answer handed out with the Date it
// had when it was stored would read as "your clock is half an hour fast" on a PC whose clock is right, and
// correcting by it would break every code. Found by reading the probe's real headers, 2026-11-11.
describe('an answer that must not be believed', () => {
  it('one that came out of a cache is not a measurement: the PC clock is used', async () => {
    const calls = { n: 0 };
    const c = clock.createClockCheck({ now: () => T, mono: () => 0, request: async () => { calls.n++; return { date: header(T - 1800 * 1000), age: 1800, sentAt: T, receivedAt: T + 50 }; } });
    await expect(c.check()).rejects.toThrow(/came from a cache \(1800 s old\)/);
    expect(await c.time()).toMatchObject({ known: false, wrong: false, now: T });
    expect(calls.n).toBe(1);                         // and nothing is asked again for a minute
  });
  it('a clock is called wrong only when a second request agrees', async () => {
    const w = world(19200);
    const r = await w.check.check();
    expect(r.wrong).toBe(true);
    expect(w.calls).toBe(2);
  });
  it('one stale answer between fresh ones does not make a right clock wrong', async () => {
    let n = 0;
    const c = clock.createClockCheck({ now: () => T, mono: () => 0, request: async () => (++n === 1
      ? { date: header(T - 1700 * 1000), age: 0, sentAt: T, receivedAt: T + 50 }      // stale, and the cache did not say so
      : { date: header(T), age: 0, sentAt: T, receivedAt: T + 50 }) });
    await expect(c.check()).rejects.toThrow(/two answers disagreed/);
    expect(await c.time()).toMatchObject({ known: false, wrong: false });
  });
  it('a right clock is asked once', async () => {
    const w = world(800);
    await w.check.check();
    expect(w.calls).toBe(1);
  });
});

describe('time (what the codes are made from)', () => {
  it('gives the measured time for a wrong clock, to within the header\'s second', async () => {
    const w = world(19200);
    const t = await w.check.time();
    expect(t).toMatchObject({ known: true, wrong: true });
    expect(Math.abs(t.now - w.real)).toBeLessThanOrEqual(1000);
    w.advance(42000);
    const later = await w.check.time();
    expect(Math.abs(later.now - w.real)).toBeLessThanOrEqual(1000);
  });
  it('says a right clock is right, so the caller keeps the PC clock', async () => {
    expect(await world(800).check.time()).toMatchObject({ known: true, wrong: false });
  });
  it('does not follow the PC clock when it is set: the old answer is dropped and measured again', async () => {
    const w = world(19200);
    await w.check.time();
    w.advance(5000);
    w.setPc(-600000);                            // someone set the clock ten minutes back
    const t = await w.check.time();
    expect(w.calls).toBe(4);
    expect(t.wrong).toBe(true);
    expect(Math.abs(t.now - w.real)).toBeLessThanOrEqual(1000);
  });
  it('offline: the PC clock, and nothing is asked again for a minute', async () => {
    const w = world(19200, { online: false });
    const t = await w.check.time();
    expect(t).toMatchObject({ known: false, wrong: false, now: w.now() });
    await w.check.time();
    await w.check.time();
    expect(w.calls).toBe(1);
    w.advance(clock.FAIL_RETRY_MS + 1);
    w.online = true;
    expect((await w.check.time()).known).toBe(true);
    expect(w.calls).toBe(3);
  });
  it('a slow first answer does not hold the code up: the PC clock is used meanwhile', async () => {
    let release;
    const c = clock.createClockCheck({ now: () => T, mono: () => 0, request: () => new Promise((resolve) => { release = () => resolve({ date: header(T), sentAt: T, receivedAt: T + 10 }); }) });
    const t = await c.time({ waitMs: 20 });
    expect(t.known).toBe(false);
    release();
    await new Promise(r => setTimeout(r, 0));
    expect((await c.time()).known).toBe(true);
  });
});

describe('probeUrlFrom (the test-only stand-in)', () => {
  it('is the real probe unless a local stand-in is named', () => {
    expect(clock.probeUrlFrom({})).toBe(clock.PROBE_URL);
    expect(clock.probeUrlFrom({ VEX_CLOCK_PROBE: 'http://127.0.0.1:17200/' })).toBe('http://127.0.0.1:17200/');
  });
  it('refuses anything that is not a local http address', () => {
    for (const bad of ['https://example.com/', 'http://example.com:80/', 'http://127.0.0.1/', 'http://u:p@127.0.0.1:1/', 'nonsense']) {
      expect(() => clock.probeUrlFrom({ VEX_CLOCK_PROBE: bad }), bad).toThrow(/VEX_CLOCK_PROBE/);
    }
  });
});

describe('createRequest', () => {
  const fakeNet = (answer) => {
    const seen = [];
    return {
      seen,
      request(options) {
        seen.push(options);
        const em = new EventEmitter();
        em.abort = () => {};
        em.sent = {};
        em.setHeader = (k, v) => { em.sent[k] = v; };
        seen.headers = em.sent;
        em.end = () => setTimeout(() => answer(em), 0);
        return em;
      },
    };
  };
  it('sends one HEAD with no cookies and returns the Date header and the two times', async () => {
    const net = fakeNet((em) => { const res = new EventEmitter(); res.statusCode = 200; res.headers = { date: [header(T)] }; em.emit('response', res); });
    let now = 1000;
    const r = await clock.createRequest(net, { now: () => (now += 50) })(clock.PROBE_URL);
    expect([...net.seen]).toEqual([{ url: clock.PROBE_URL, method: 'HEAD', credentials: 'omit', useSessionCookies: false, cache: 'no-store' }]);
    expect(net.seen.headers).toEqual({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
    expect(r).toEqual({ status: 200, date: header(T), age: 0, sentAt: 1050, receivedAt: 1100 });
  });
  it('reports how long the answer sat in a cache, when a cache says so', async () => {
    const net = fakeNet((em) => { const res = new EventEmitter(); res.statusCode = 200; res.headers = { date: header(T), age: ['1840'] }; em.emit('response', res); });
    expect((await clock.createRequest(net)(clock.PROBE_URL)).age).toBe(1840);
  });
  it('rejects on a network error and on no answer', async () => {
    await expect(clock.createRequest(fakeNet((em) => em.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))))(clock.PROBE_URL)).rejects.toThrow(/DISCONNECTED/);
    await expect(clock.createRequest(fakeNet(() => {}), { timeoutMs: 20 })(clock.PROBE_URL)).rejects.toThrow(/timed out/);
  });
});

// main.js is not loaded under test; what it does with the measurement is pinned by reading it.
describe('main.js wiring', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const block = (start, len) => { const i = MAIN.indexOf(start); expect(i, start).toBeGreaterThan(-1); return MAIN.slice(i, i + len); };
  it('makes the codes from the measured time only when the clock is known, wrong and correction is on', () => {
    const codes = block("ipcMain.handle('totp:codes'", 500);
    expect(codes).toContain('const t = _clockCheckOn() ? await _clock.time() : { known: false };');
    expect(codes).toContain('const now = t.known && t.wrong && _clockCorrectOn() ? t.now : Date.now();');
  });
  it('the whole check has a switch: off asks no server, uses the PC clock and reports nothing', () => {
    expect(MAIN).toContain("const _clockCheckOn = () => String(_readPersistString('vex.totpClockCheck', '1')) !== '0';");
    expect(block("ipcMain.handle('totp:codes'", 500)).toContain('const t = _clockCheckOn() ? await _clock.time() : { known: false };');
    const check = block("ipcMain.handle('totp:clock-check'", 330);
    expect(check.indexOf('if (!_clockCheckOn()) return { off: true')).toBeGreaterThan(-1);
    expect(check.indexOf('if (!_clockCheckOn()) return { off: true')).toBeLessThan(check.indexOf('_clock.check()'));
  });
  it('the switch is in Settings, written to main at once, and the privacy document names the request', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    expect(read('src/renderer/index.html')).toContain('id="setting-totp-clock"');
    const app = read('src/renderer/js/app.js');
    expect(app).toContain("totpClockToggle.checked = localStorage.getItem('vex.totpClockCheck') !== '0';");
    expect(app).toContain("await window.vex.persistSet('vex.totpClockCheck', value);");
    const privacy = read('PRIVACY.md');
    expect(privacy).toMatch(/\| \*\*Authenticator clock check\*\* \(on by default\) \|[^\n]*detectportal\.firefox\.com[^\n]*"Check my PC clock for 2FA codes"/);
    expect(new URL(clock.PROBE_URL).hostname).toBe('detectportal.firefox.com');
  });
  it('correction is on unless the person turned it off', () => {
    expect(MAIN).toContain("const _clockCorrectOn = () => _readPersistString('vex.totpClockCorrect', true) !== false;");
  });
  it('the request goes through the egress ledger under its own name', () => {
    expect(block('const _clockFetch = _egressFetch(', 420)).toContain("{ feature: 'Authenticator clock check', kind: 'fetch' }");
  });
  it('the time-settings opener opens that one Windows page and nothing else', () => {
    const open = block("ipcMain.handle('totp:open-time-settings'", 330);
    expect(open).toContain("await shell.openExternal('ms-settings:dateandtime');");
    expect(open.match(/openExternal/g)).toHaveLength(1);
  });
});
