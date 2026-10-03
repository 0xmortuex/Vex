// @vitest-environment jsdom
//
// Performance pass (2026-10-03): work Vex did at every start or on a timer
// while nothing needed it.
//   - VexJobs ticked every second although its jobs run every half-minute or
//     more: now one timer, set for the next job that is due.
//   - The Clock's half-second timer tick ran all day with no timer running:
//     now it runs only while one does.
//   - The QR reader (vendor/jsQR.js, 250 KB) was parsed at every start for the
//     Authenticator's "paste a QR screenshot": now it loads on first use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;

describe('VexJobs wakes only when a job is due', () => {
  const { VexJobs } = require('../../src/renderer/js/jobs.js');
  beforeEach(() => {
    vi.useFakeTimers();
    VexJobs._jobs.clear();
    if (VexJobs._tick) { clearTimeout(VexJobs._tick); VexJobs._tick = null; }
    globalThis.GameMode = { gaming: false };
    window.VexProblems = { note: vi.fn() };
  });
  afterEach(() => { for (const n of [...VexJobs._jobs.keys()]) VexJobs.stop(n); vi.useRealTimers(); });

  it('sleeps until the next job instead of ticking every second', () => {
    const tick = vi.spyOn(VexJobs, 'tick');
    const fn = vi.fn();
    VexJobs.every('slow', 30000, fn);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(29000);
    expect(tick).not.toHaveBeenCalled();          // was 29 wake-ups
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(tick).toHaveBeenCalledTimes(2);
    tick.mockRestore();
  });

  it('a job added later with a shorter interval is not kept waiting by the longer one', () => {
    const slow = vi.fn(), fast = vi.fn();
    VexJobs.every('slow', 60000, slow);
    vi.advanceTimersByTime(1000);
    VexJobs.every('fast', 5000, fast);
    vi.advanceTimersByTime(5000);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);           // still one timer
  });

  it('keeps no timer at all once every job has stopped', () => {
    VexJobs.every('a', 10000, () => {});
    VexJobs.every('b', 20000, () => {});
    VexJobs.stop('a'); VexJobs.stop('b');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a job held while hidden still runs once when Vex is shown, and keeps its schedule after', () => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const fn = vi.fn();
    VexJobs.every('ui', 10000, fn);
    vi.advanceTimersByTime(25000);
    expect(fn).not.toHaveBeenCalled();
    hidden = false;
    VexJobs.resume();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(fn).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
});

describe('the Clock ticks only while a timer runs', () => {
  const { VexClock } = require('../../src/renderer/js/clock-panel.js');
  let bridge;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<button id="timer-pill" hidden><span></span></button>';
    bridge = {
      create: vi.fn(async (message, at, extra) => ({ id: 'r1', message, at, ...extra })),
      delete: vi.fn(async () => ({ ok: true })), list: vi.fn(async () => []), ack: vi.fn(), onFired: vi.fn(),
    };
    window.vex = { reminders: bridge, focusWindow: vi.fn() };
    window.showToast = vi.fn();
    if (VexClock._ticker) { clearInterval(VexClock._ticker); VexClock._ticker = null; }
    VexClock._timers = [];
  });
  afterEach(() => { VexClock.stopSound(); document.getElementById('vex-ringing')?.remove(); vi.useRealTimers(); });

  it('starts with no ticker when no timer was running', () => {
    VexClock.init();
    expect(VexClock._ticker).toBe(null);
  });

  it('a timer restored at start is counted down', () => {
    localStorage.setItem(VexClock.KEY_TIMERS, JSON.stringify([{ id: 't1', label: 'Tea', endAt: Date.now() + 60000, total: 60000, reminderId: null }]));
    VexClock.init();
    expect(VexClock._ticker).not.toBe(null);
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('#timer-pill span').textContent).toBe(VexClock.fmtLeft(59000));
  });

  it('runs while a timer does, rings it on time, then stops', async () => {
    const ring = vi.spyOn(VexClock, 'ring').mockImplementation(() => null);
    await VexClock.addTimer('5s', 'Eggs');
    expect(VexClock._ticker).not.toBe(null);
    vi.advanceTimersByTime(4000);
    expect(ring).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(ring).toHaveBeenCalledWith(expect.objectContaining({ message: 'Eggs', kind: 'timer' }));
    expect(VexClock._ticker).toBe(null);
    ring.mockRestore();
  });

  it('stops when the last timer is removed', async () => {
    const t = await VexClock.addTimer('5 min', 'Tea');
    expect(VexClock._ticker).not.toBe(null);
    await VexClock.removeTimer(t.id);
    expect(VexClock._ticker).toBe(null);
  });
});

describe('the QR reader loads on first use', () => {
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.VexLazy; delete globalThis.jsQR; });
  it('is not among the scripts loaded at start', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+jsQR/);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'vendor', 'jsQR.js'))).toBe(true);
  });

  const load = () => {
    delete globalThis.jsQR;
    require('../../src/renderer/js/authenticator.js');
    const A = window.Authenticator;
    const el = document.createElement('div');
    el.innerHTML = '<div id="auth-status"></div><form id="auth-add-form" style="display:block"></form><input id="auth-secret">';
    A._el = el;
    return { A, el };
  };
  const png = () => new File(['x'], 'qr.png', { type: 'image/png' });

  it('a pasted QR image loads the reader, then reads and adds the code', async () => {
    const { A, el } = load();
    globalThis.VexLazy = { ensure: vi.fn(async () => { globalThis.jsQR = () => ({ data: 'otpauth://totp/Vex?secret=JBSWY3DPEHPK3PXP' }); return true; }) };
    vi.spyOn(A, '_decodeQrFromFile').mockImplementation(async () => globalThis.jsQR().data);
    const add = vi.spyOn(A, '_add').mockImplementation(async () => {});
    await A._handleQrFile(png());
    expect(VexLazy.ensure).toHaveBeenCalledWith('vendor/jsQR.js');
    expect(el.querySelector('#auth-secret').value).toBe('otpauth://totp/Vex?secret=JBSWY3DPEHPK3PXP');
    expect(add).toHaveBeenCalled();
  });

  it('says so when the reader cannot be loaded', async () => {
    const { A, el } = load();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.VexLazy = { ensure: vi.fn(async () => { throw new Error('lazy load failed: vendor/jsQR.js'); }) };
    const add = vi.spyOn(A, '_add').mockImplementation(async () => {});
    await A._handleQrFile(png());
    expect(el.querySelector('#auth-status').textContent).toBe('QR reader failed to load.');
    expect(err).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
