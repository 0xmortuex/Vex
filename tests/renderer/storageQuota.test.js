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
      expect(() => localStorage.setItem('vex.settings', '[{"title":"a note"}]')).not.toThrow();
      expect(saved('vex.settings')).toEqual([{ op: 'set', key: 'vex.settings', value: '[{"title":"a note"}]' }]);
      const p = VexProblems.all()[0];
      expect(p.area).toBe('Storage');
      expect(p.message).toBe('Browser storage is full — "vex.settings" was saved to disk only');
      expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Browser storage is full.*Memory panel/), 'error');
    } finally { restore(); }
  });

  it('the log about the full store does not report itself into a loop', async () => {
    const restore = await loadStorage({ full: true });
    try {
      localStorage.setItem('vex.settings', 'x');
      // One problem recorded, and the log itself kept — not one problem per
      // attempt to write the problem, for ever.
      expect(VexProblems.all()).toHaveLength(1);
      expect(saved('vex.problems')).toHaveLength(1);
    } finally { restore(); }
  });

  it('says it once, not on every write', async () => {
    const restore = await loadStorage({ full: true });
    try {
      for (let i = 0; i < 20; i++) localStorage.setItem('vex.settings', 'x' + i);
      expect(window.showToast).toHaveBeenCalledTimes(1);
      // Twenty identical failures are one line with a count, not twenty lines.
      expect(VexProblems.all()).toHaveLength(1);
      expect(VexProblems.all()[0].n).toBe(20);
      expect(saved('vex.settings')).toHaveLength(20);         // and every one still saved
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
      localStorage.setItem('vex.settings', 'fine');
      expect(localStorage.getItem('vex.settings')).toBe('fine');
      expect(VexProblems.all()).toEqual([]);
      expect(window.showToast).not.toHaveBeenCalled();
      expect(saved('vex.settings')).toEqual([{ op: 'set', key: 'vex.settings', value: 'fine' }]);
    } finally { restore(); }
  });
});

describe('the storage meter in Health', () => {
  it('measures what is stored and names the biggest, and warns when nearly full', async () => {
    vi.resetModules();
    localStorage.clear();
    const { MemoryPanel } = await import('../../src/renderer/js/memory-panel.js?' + Math.random());
    localStorage.setItem('vex.bigStore', 'n'.repeat(120 * 1024));      // ~240 KB as UTF-16
    localStorage.setItem('vex.small', 'x');
    const use = MemoryPanel.storageUse();
    expect(use.error).toBe(null);
    expect(use.rows[0].key).toBe('vex.bigStore');
    expect(use.total).toBeGreaterThan(240 * 1024);
    const lines = MemoryPanel.storageLines();
    expect(lines[0]).toMatch(/^Browser storage: \d+\.\d\d MB of about 5\.00 MB used \(\d+%\)$/);
    expect(lines[1]).toMatch(/^ {2}vex.bigStore — 0\.2\d MB$/);
    expect(lines.some(l => /vex\.small/.test(l))).toBe(false);      // only what is worth clearing

    MemoryPanel.STORAGE_CAP = 300 * 1024;                            // pretend it is nearly full
    expect(MemoryPanel.storageLines()[0]).toMatch(/nearly full/);
    MemoryPanel.STORAGE_CAP = 5 * 1024 * 1024;
  });
});

describe('the stores that grow without limit live on disk, not in browser storage', () => {
  it('a note is saved to the file and read back, but takes no browser storage', async () => {
    const restore = await loadStorage({ full: false });
    try {
      localStorage.setItem('vex.notes', '[{"title":"a"}]');
      expect(localStorage.getItem('vex.notes')).toBe('[{"title":"a"}]');
      expect(Object.keys(localStorage)).not.toContain('vex.notes');
      expect(saved('vex.notes')).toEqual([{ op: 'set', key: 'vex.notes', value: '[{"title":"a"}]' }]);
      localStorage.removeItem('vex.notes');
      expect(localStorage.getItem('vex.notes')).toBeNull();
    } finally { restore(); }
  });

  it('an old copy in browser storage is moved out when Vex starts, freeing the space', async () => {
    localStorage.setItem('vex.aiConversations', '{"old":1}');
    const restore = await loadStorage({ full: false });
    try {
      window.vex.persistGetAll = vi.fn(async () => ({ 'vex.aiConversations': '{"chats":2}', 'vex.theme': 'dark' }));
      await window.PersistentStorage.init();
      expect(Object.keys(localStorage)).not.toContain('vex.aiConversations');
      expect(localStorage.getItem('vex.aiConversations')).toBe('{"chats":2}');
      expect(localStorage.getItem('vex.theme')).toBe('dark');
      expect(window.PersistentStorage.fileOnlyEntries().map(e => e[0])).toEqual(['vex.aiConversations']);
    } finally { restore(); }
  });

  it('a value that stops fitting is read back as written, not as the old copy', async () => {
    localStorage.setItem('vex.settings', 'old');
    const restore = await loadStorage({ full: true });
    try {
      localStorage.setItem('vex.settings', 'new');
      expect(localStorage.getItem('vex.settings')).toBe('new');
    } finally { restore(); }
  });
});

describe('the 80% warning', () => {
  it('is said once a day, from 80% full', async () => {
    const restore = await loadStorage({ full: false });
    try {
      const PS = window.PersistentStorage;
      localStorage.setItem('vex.bigStore', 'n'.repeat(50 * 1024));   // ~100 KB
      PS.CAP_BYTES = 1000 * 1024;
      expect(PS.warnIfNearlyFull()).toBe(false);
      PS.CAP_BYTES = 110 * 1024;
      const now = Date.now();
      expect(PS.warnIfNearlyFull(now)).toBe(true);
      expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Browser storage is \d+% full\. Memory panel › Health/), 'error', 10000);
      expect(PS.warnIfNearlyFull(now + 3600 * 1000)).toBe(false);
      expect(PS.warnIfNearlyFull(now + 25 * 3600 * 1000)).toBe(true);
    } finally { restore(); }
  });
});
