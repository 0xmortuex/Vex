// @vitest-environment jsdom
//
// localStorage has a hard size cap, and a write past it THROWS. Vex keeps 60
// kinds of thing there — notes, chats, agent runs, settings — and sixty call
// sites write through a try/catch that says nothing, so a full store meant
// notes and chats quietly failing to save.
//
// The shim in js/storage.js is the one place that sees every write: it records
// the failure, says so once, and still sends the value to the file store,
// which has no such cap.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The true native, captured before any Vex module has wrapped it.
const NATIVE_SET = Storage.prototype.setItem;
const ORIGINALS = Symbol.for('vex.storage.originals');

let VexProblems, enqueued;
const saved = (key) => enqueued.filter(e => e.key === key);

async function loadStorage({ full }) {
  vi.resetModules();
  delete window.__vexProblemsWired;
  delete window.__vexQuotaToldAt;
  enqueued = [];
  window.showToast = vi.fn();
  window.vex = { persistSet: vi.fn(async () => true), persistDelete: vi.fn(async () => true), persistGetAll: vi.fn(async () => ({})) };
  ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
  window.VexProblems = VexProblems;
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // The shim keeps the real setItem on the prototype under a Symbol, defined
  // once and not removable — so a full quota is simulated by changing what
  // that holds, before the import that reads it.
  if (!Storage.prototype[ORIGINALS]) {
    Storage.prototype.setItem = NATIVE_SET;
    await import('../../src/renderer/js/storage.js?prime');
  }
  Storage.prototype[ORIGINALS].setItem = full
    ? function () { throw Object.assign(new Error('Failed to execute setItem: the quota has been exceeded.'), { name: 'QuotaExceededError' }); }
    : NATIVE_SET;
  await import('../../src/renderer/js/storage.js?' + Math.random());
  window.PersistentStorage._enqueue = (op, key, value) => enqueued.push({ op, key, value });
  return () => { Storage.prototype[ORIGINALS].setItem = NATIVE_SET; };
}

beforeEach(() => { localStorage.clear(); });

describe('when browser storage is full', () => {
  it('the write does not throw at the call site, is recorded, and still reaches the disk', async () => {
    const restore = await loadStorage({ full: true });
    try {
      expect(() => localStorage.setItem('vex.notes', '[{"title":"a note"}]')).not.toThrow();
      expect(saved('vex.notes')).toEqual([{ op: 'set', key: 'vex.notes', value: '[{"title":"a note"}]' }]);
      const p = VexProblems.all()[0];
      expect(p.area).toBe('Storage');
      expect(p.message).toBe('Browser storage is full — "vex.notes" was saved to disk only');
      expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Browser storage is full.*Memory panel/), 'error');
    } finally { restore(); }
  });

  it('the log about the full store does not report itself into a loop', async () => {
    const restore = await loadStorage({ full: true });
    try {
      localStorage.setItem('vex.notes', 'x');
      // One problem recorded, and the log itself kept — not one problem per
      // attempt to write the problem, for ever.
      expect(VexProblems.all()).toHaveLength(1);
      expect(saved('vex.problems')).toHaveLength(1);
    } finally { restore(); }
  });

  it('says it once, not on every write', async () => {
    const restore = await loadStorage({ full: true });
    try {
      for (let i = 0; i < 20; i++) localStorage.setItem('vex.notes', 'x' + i);
      expect(window.showToast).toHaveBeenCalledTimes(1);
      // Twenty identical failures are one line with a count, not twenty lines.
      expect(VexProblems.all()).toHaveLength(1);
      expect(VexProblems.all()[0].n).toBe(20);
      expect(saved('vex.notes')).toHaveLength(20);         // and every one still saved
    } finally { restore(); }
  });

  it("a key Vex does not mirror still throws, because Vex cannot rescue it", async () => {
    const restore = await loadStorage({ full: true });
    try {
      expect(() => localStorage.setItem('someone-elses-key', 'x')).toThrow(/quota/i);
      expect(VexProblems.all()[0].message).toMatch(/was not saved/);
      expect(saved('someone-elses-key')).toEqual([]);
    } finally { restore(); }
  });

  it('an ordinary write is untouched', async () => {
    const restore = await loadStorage({ full: false });
    try {
      localStorage.setItem('vex.notes', 'fine');
      expect(localStorage.getItem('vex.notes')).toBe('fine');
      expect(VexProblems.all()).toEqual([]);
      expect(window.showToast).not.toHaveBeenCalled();
      expect(saved('vex.notes')).toEqual([{ op: 'set', key: 'vex.notes', value: 'fine' }]);
    } finally { restore(); }
  });
});

describe('the storage meter in Health', () => {
  it('measures what is stored and names the biggest, and warns when nearly full', async () => {
    vi.resetModules();
    localStorage.clear();
    const { MemoryPanel } = await import('../../src/renderer/js/memory-panel.js?' + Math.random());
    localStorage.setItem('vex.notes', 'n'.repeat(120 * 1024));      // ~240 KB as UTF-16
    localStorage.setItem('vex.small', 'x');
    const use = MemoryPanel.storageUse();
    expect(use.error).toBe(null);
    expect(use.rows[0].key).toBe('vex.notes');
    expect(use.total).toBeGreaterThan(240 * 1024);
    const lines = MemoryPanel.storageLines();
    expect(lines[0]).toMatch(/^Browser storage: \d+\.\d\d MB of about 5\.00 MB used \(\d+%\)$/);
    expect(lines[1]).toMatch(/^ {2}vex\.notes — 0\.2\d MB$/);
    expect(lines.some(l => /vex\.small/.test(l))).toBe(false);      // only what is worth clearing

    MemoryPanel.STORAGE_CAP = 300 * 1024;                            // pretend it is nearly full
    expect(MemoryPanel.storageLines()[0]).toMatch(/nearly full/);
    MemoryPanel.STORAGE_CAP = 5 * 1024 * 1024;
  });
});
