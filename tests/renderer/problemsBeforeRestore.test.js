// @vitest-environment jsdom
//
// When browser storage starts empty, Vex copies its saved data back from
// vex-persist.json (PersistentStorage.init). A problem noted during start-up,
// before that copy, was saved as a one-item list; the key was then waiting to
// be written, so the copy skipped it and the one item went to the file over
// the real problem list. Problems noted before the copy are now merged with
// the restored list instead (js/problems.js restored()).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let VexProblems, PersistentStorage, file, answer;

const saved = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ at: 1000 + i, area: 'Sync', message: 'Old problem ' + i, detail: '', n: 1, v: '2.38.0', ...extra }));

async function start() {
  vi.resetModules();
  delete window.__vexProblemsWired;
  window.vex = {
    // Answers only when the test says, so a problem can be noted first.
    persistGetAll: vi.fn(() => new Promise(r => { answer = () => r({ ...file }); })),
    persistSet: vi.fn(async (k, v) => { file[k] = v; return true; }),
    persistDelete: vi.fn(async (k) => { delete file[k]; return true; }),
  };
  ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
  window.VexProblems = VexProblems;
  ({ PersistentStorage } = await import('../../src/renderer/js/storage.js?' + Math.random()));
}

beforeEach(() => {
  // Each test loads its own storage.js, whose clear() mirrors to the file: the
  // previous test's copy would queue deletes that land in this test's file
  // before it is read. Clear browser storage only.
  const originals = Storage.prototype[Symbol.for('vex.storage.originals')];
  (originals ? originals.clear : Storage.prototype.clear).call(localStorage);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('a problem noted before the saved list is restored', () => {
  it('is added to the restored list, which is not overwritten', async () => {
    file = { 'vex.problems': JSON.stringify(saved(3)), 'vex.theme': 'dark' };
    await start();
    const ready = PersistentStorage.init();
    VexProblems.note('Startup', 'Something failed early');
    expect(VexProblems.all()).toHaveLength(1);   // browser storage was empty
    answer();
    await ready;

    const messages = VexProblems.all().map(p => p.message);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toBe('Something failed early');   // newest first
    expect(messages.slice(1).sort()).toEqual(['Old problem 0', 'Old problem 1', 'Old problem 2']);
    expect(JSON.parse(file['vex.problems'])).toHaveLength(4);
    expect(JSON.parse(localStorage.getItem('vex.problems'))).toHaveLength(4);
  });

  it('counts a saved problem happening again before the restore once more', async () => {
    file = { 'vex.problems': JSON.stringify(saved(2, { n: 5 })) };
    await start();
    const ready = PersistentStorage.init();
    VexProblems.note('Sync', 'Old problem 1');
    VexProblems.note('Sync', 'Old problem 1');
    answer();
    await ready;
    const list = JSON.parse(file['vex.problems']);
    expect(list).toHaveLength(2);
    expect(list.find(p => p.message === 'Old problem 1').n).toBe(7);
    expect(VexProblems.all()[0].message).toBe('Old problem 1');
  });

  it('does not count twice when browser storage already held the list', async () => {
    file = { 'vex.problems': JSON.stringify(saved(2, { n: 5 })) };
    localStorage.setItem('vex.problems', file['vex.problems']);
    await start();
    const ready = PersistentStorage.init();
    VexProblems.note('Sync', 'Old problem 0');
    answer();
    await ready;
    const list = JSON.parse(file['vex.problems']);
    expect(list.find(p => p.message === 'Old problem 0').n).toBe(6);
    expect(list.find(p => p.message === 'Old problem 1').n).toBe(5);
  });

  it('keeps the problem on a first run, when the file is empty', async () => {
    file = {};
    await start();
    const ready = PersistentStorage.init();
    VexProblems.note('Startup', 'Something failed early');
    answer();
    await ready;
    expect(VexProblems.all().map(p => p.message)).toEqual(['Something failed early']);
    expect(JSON.parse(file['vex.problems'])).toHaveLength(1);
  });

  it('reads the restored list when nothing was noted before it', async () => {
    file = { 'vex.problems': JSON.stringify(saved(3)) };
    await start();
    const ready = PersistentStorage.init();
    answer();
    await ready;
    expect(VexProblems.all()).toHaveLength(3);
    VexProblems.note('Startup', 'After the restore');
    expect(VexProblems.all()).toHaveLength(4);
  });
});
