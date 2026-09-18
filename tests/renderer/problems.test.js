// @vitest-environment jsdom
//
// The quiet-problems log. 907 places in Vex catch an error and say nothing,
// which is how the two worst bugs of the week stayed hidden: the screen share
// was refused and the refusal was thrown away, and an agent run was never
// saved with the chat while nothing said so.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let VexProblems;
beforeEach(async () => {
  localStorage.clear();
  delete window.__vexProblemsWired;
  vi.resetModules();
  ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('recording a problem', () => {
  it('keeps what failed, where, and when, and says it out loud in the console', () => {
    const p = VexProblems.note('Screen share', 'The share was refused', new Error('Invalid capture constraints'));
    expect(p).toMatchObject({ area: 'Screen share', message: 'The share was refused', detail: 'Invalid capture constraints', n: 1 });
    expect(typeof p.at).toBe('number');
    expect(console.warn).toHaveBeenCalledWith('[Problem] Screen share: The share was refused — Invalid capture constraints');
    expect(VexProblems.all()).toHaveLength(1);
    expect(VexProblems.count()).toBe(1);
  });

  it('collapses repeats instead of sixty identical lines', () => {
    for (let i = 0; i < 60; i++) VexProblems.note('AI', 'local failed for "chat"', 'Ollama is not running');
    expect(VexProblems.all()).toHaveLength(1);
    expect(VexProblems.all()[0].n).toBe(60);
    expect(VexProblems.count()).toBe(60);
    expect(VexProblems.lines()[0]).toMatch(/AI: local failed for "chat" \(×60\) — Ollama is not running/);
  });

  it('survives a restart, newest first, and never grows past its cap', () => {
    for (let i = 0; i < 80; i++) VexProblems.note('Area ' + i, 'thing ' + i);
    expect(VexProblems.all()).toHaveLength(VexProblems.MAX);
    const saved = JSON.parse(localStorage.getItem(VexProblems.KEY));
    expect(saved).toHaveLength(VexProblems.MAX);
    expect(saved[0].area).toBe('Area 20');                    // the oldest went
    expect(VexProblems.all()[0].area).toBe('Area 79');        // newest first
  });

  it('takes an Error or a string, and a message that is missing', () => {
    expect(VexProblems.note('X', 'failed', new Error('boom')).detail).toBe('boom');
    expect(VexProblems.note('X', 'failed', 'boom2').detail).toBe('boom2');
    expect(VexProblems.note('X').message).toBe('Something failed');
    expect(VexProblems.note('X', 'no detail').detail).toBe('');
  });

  it('a store that cannot be written does not throw at the call site', () => {
    const real = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      expect(() => VexProblems.note('Storage', 'full')).not.toThrow();
      expect(VexProblems.all()).toHaveLength(1);              // the session still shows it
    } finally { localStorage.setItem = real; }
  });

  it('clearing empties it, and tells anything listening', () => {
    const seen = [];
    document.addEventListener('vex:problem', (e) => seen.push(e.detail));
    VexProblems.note('A', 'one');
    VexProblems.clear();
    expect(VexProblems.all()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(VexProblems.KEY))).toEqual([]);
    expect(seen).toEqual([expect.objectContaining({ area: 'A' }), null]);
  });
});

describe('guard', () => {
  it('records a rejection and hands back the fallback, so the caller carries on', async () => {
    const out = await VexProblems.guard('Sync', 'could not read tabs', Promise.reject(new Error('offline')), []);
    expect(out).toEqual([]);
    expect(VexProblems.all()[0]).toMatchObject({ area: 'Sync', message: 'could not read tabs', detail: 'offline' });
  });

  it('passes a success through untouched', async () => {
    expect(await VexProblems.guard('Sync', 'x', Promise.resolve(42), 0)).toBe(42);
    expect(VexProblems.all()).toEqual([]);
  });
});

describe('what nothing else was catching', () => {
  it('an uncaught error in the interface', () => {
    VexProblems.init();
    window.dispatchEvent(Object.assign(new Event('error'), { message: 'Uncaught TypeError: x is not a function', filename: 'file:///C:/vex/js/tabs.js', lineno: 42 }));
    expect(VexProblems.all()[0]).toMatchObject({ area: 'Vex interface', message: 'TypeError: x is not a function', detail: 'tabs.js:42' });
  });

  it('a rejected promise nobody handled', () => {
    VexProblems.init();
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('save failed') }));
    expect(VexProblems.all()[0].message).toBe('A background step failed: save failed');
  });

  it('but not an image or script that failed to load — that is not a fault', () => {
    VexProblems.init();
    const img = document.createElement('img');
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error', { bubbles: true }));
    expect(VexProblems.all()).toEqual([]);
  });

  it('is wired once, however many times it is asked', () => {
    expect(VexProblems.init()).toBe(false);      // already wired at load
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('once') }));
    expect(VexProblems.all()).toHaveLength(1);
  });
});
