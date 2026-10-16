// @vitest-environment jsdom
//
// VexJobs.heavy(): indexing, OCR, local AI, summaries and audio digests run one at a time,
// at idle, never in Game mode or when committed memory is low; AI asks you made queue
// until the game ends; backlog waits for the night and the charger.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexJobs } = require('../../src/renderer/js/jobs.js');

let flags;
// Timers are faked here, so a real setTimeout would never fire.
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 9, 16, 14, 0, 0));          // 14:00, daytime
  flags = { hidden: false };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => flags.hidden });
  globalThis.GameMode = { gaming: false };
  globalThis.BatteryMode = undefined;
  window.VexProblems = globalThis.VexProblems = { note: vi.fn() };
  VexJobs._jobs.clear();
  VexJobs._heavy.length = 0;
  VexJobs._heavyRunning = false;
  VexJobs._memoryPressure = null;
  VexJobs._lastInput = 0;
  clearTimeout(VexJobs._heavyTimer); VexJobs._heavyTimer = null;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); clearTimeout(VexJobs._heavyTimer); VexJobs._heavyTimer = null; });

describe('VexJobs.heavy', () => {
  it('runs a job at once when it is idle and nothing blocks it, and hands back its value', async () => {
    const r = await VexJobs.heavy('index', () => 7, { kind: 'index' });
    expect(r).toEqual({ ran: true, value: 7 });
  });

  it('refuses index, OCR, local AI, summary and audio work in Game mode', async () => {
    globalThis.GameMode = { gaming: true };
    const fn = vi.fn();
    for (const kind of ['index', 'ocr', 'local-ai', 'summary', 'audio']) {
      expect(await VexJobs.heavy('x', fn, { kind })).toEqual({ ran: false, reason: 'a game is running' });
    }
    expect(fn).not.toHaveBeenCalled();
    expect(VexJobs.heavyQueue()).toEqual([]);
  });

  it('queues an AI ask in Game mode and runs it when the game ends', async () => {
    globalThis.GameMode = { gaming: true };
    const fn = vi.fn(() => 'answer');
    const p = VexJobs.heavy('ask', fn, { kind: 'ai-ask' });
    await settle();
    expect(fn).not.toHaveBeenCalled();
    expect(VexJobs.heavyQueue().map(q => q.name)).toEqual(['ask']);
    globalThis.GameMode = { gaming: false };
    VexJobs.resume();                                   // what game-mode.js does when the game ends
    expect(await p).toEqual({ ran: true, value: 'answer' });
  });

  it('refuses when committed memory is low (the hook another module fills), and says why', async () => {
    VexJobs.setMemoryPressure(() => ({ low: true, reason: 'less than 2 GB of commit left' }));
    expect(await VexJobs.heavy('x', vi.fn(), { kind: 'local-ai' })).toEqual({ ran: false, reason: 'less than 2 GB of commit left' });
    VexJobs.setMemoryPressure(() => 'memory is low');
    expect((await VexJobs.heavy('x', vi.fn(), { kind: 'index' })).reason).toBe('memory is low');
    VexJobs.setMemoryPressure(null);
    expect((await VexJobs.heavy('x', () => 1, { kind: 'index' })).ran).toBe(true);
  });

  it('reports a memory check that throws, and carries on as "not low" for that call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    VexJobs.setMemoryPressure(() => { throw new Error('probe failed'); });
    expect((await VexJobs.heavy('x', () => 1, { kind: 'index' })).ran).toBe(true);
    expect(VexProblems.note).toHaveBeenCalledWith('Background job', 'The memory check failed', expect.any(Error));
  });

  it('waits while you are using Vex and runs after a quiet moment', async () => {
    VexJobs._lastInput = Date.now();
    const fn = vi.fn(() => 'ok');
    const p = VexJobs.heavy('x', fn, { kind: 'summary' });
    expect(fn).not.toHaveBeenCalled();
    expect(VexJobs.heavyQueue().length).toBe(1);
    await vi.advanceTimersByTimeAsync(VexJobs.HEAVY_IDLE_MS + VexJobs.HEAVY_POLL_MS + 10);
    expect(await p).toEqual({ ran: true, value: 'ok' });
  });

  it('is refused if a game starts while it waits for a quiet moment', async () => {
    VexJobs._lastInput = Date.now();
    const p = VexJobs.heavy('x', vi.fn(), { kind: 'index' });
    globalThis.GameMode = { gaming: true };
    await vi.advanceTimersByTimeAsync(VexJobs.HEAVY_POLL_MS + 10);
    expect(await p).toEqual({ ran: false, reason: 'a game is running' });
  });

  it('runs one at a time, in order', async () => {
    const order = [];
    let release;
    const first = VexJobs.heavy('a', () => new Promise(r => { order.push('a start'); release = r; }), { kind: 'index' });
    const second = VexJobs.heavy('b', () => { order.push('b'); return 2; }, { kind: 'index' });
    await settle();
    expect(order).toEqual(['a start']);
    release(1);
    await first;
    await vi.advanceTimersByTimeAsync(10);
    expect(await second).toEqual({ ran: true, value: 2 });
    expect(order).toEqual(['a start', 'b']);
  });

  it('holds backlog work for the night and the charger', async () => {
    const BatteryMode = globalThis.BatteryMode = { hw: { hasBattery: true, onBattery: true }, holdingJobs: () => false };
    const fn = vi.fn(() => 'done');
    const p = VexJobs.heavy('digest', fn, { kind: 'audio', backlog: true });
    await vi.advanceTimersByTimeAsync(VexJobs.HEAVY_POLL_MS + 10);
    expect(fn).not.toHaveBeenCalled();                 // 14:00
    vi.setSystemTime(new Date(2026, 9, 17, 2, 0, 0));  // 02:00, still on battery
    await vi.advanceTimersByTimeAsync(VexJobs.HEAVY_POLL_MS + 10);
    expect(fn).not.toHaveBeenCalled();
    BatteryMode.hw.onBattery = false;                  // plugged in
    await vi.advanceTimersByTimeAsync(VexJobs.HEAVY_POLL_MS + 10);
    expect(await p).toEqual({ ran: true, value: 'done' });
  });

  it('passes a failure to the caller, reports it and counts it against the feature', async () => {
    VexJobs._heavy.length = 0;
    const err = new Error('ocr crashed');
    await expect(VexJobs.heavy('ocr', () => { throw err; }, { kind: 'ocr', feature: 'f' })).rejects.toBe(err);
    expect(VexProblems.note).toHaveBeenCalledWith('Background job', 'ocr failed', err);
    // and the next one still runs
    expect((await VexJobs.heavy('ok', () => 1, { kind: 'ocr' })).ran).toBe(true);
  });

  it('refuses bad calls loudly', () => {
    expect(() => VexJobs.heavy('', () => 1)).toThrow(/needs a name/);
    expect(() => VexJobs.heavy('x', null)).toThrow(/no function/);
    expect(() => VexJobs.heavy('x', () => 1, { kind: 'gaming' })).toThrow(/unknown kind/);
    expect(() => VexJobs.setMemoryPressure('no')).toThrow(/needs a function/);
  });
});

describe('the callers moved onto it', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js', f), 'utf8');

  it('knowledge-base indexing, recall by meaning, the journal and link memory all go through VexJobs.heavy', () => {
    expect(read('knowledge.js')).toMatch(/VexJobs\.heavy\(this\.JOB, \(\) => this\.tick\(\), \{ kind: 'index'/);
    expect(read('recall.js')).toMatch(/VexJobs\.heavy\(this\.MEANING_JOB, \(\) => this\.meaningStep\(\), \{ kind: 'local-ai'/);
    const mt = read('memory-tools.js');
    expect(mt).toMatch(/VexJobs\.heavy\('Journal'/);
    expect(mt).toMatch(/VexJobs\.heavy\('Link memory'/);
  });
});
