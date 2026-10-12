// The page-text index (Recall) is written at most once a minute and when
// asked, not on every page read (audit S8: about 3.9 MB plus a .bak per read).
import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { createRecallWriter, WRITE_DELAY_MS } = require('../../src/main/recall-writer.js');

afterEach(() => { vi.useRealTimers(); });

function setup() {
  vi.useFakeTimers();
  let entries = [];
  const written = [];
  const errors = [];
  let fail = false;
  const writer = createRecallWriter({
    serialize: () => JSON.stringify(entries),
    write: vi.fn(async (bytes, opts) => { if (fail) throw new Error('disk busy'); written.push({ bytes, erase: opts.erase }); }),
    onError: (err) => errors.push(err.message),
  });
  return {
    writer, written, errors,
    read: (url) => { entries = [...entries, url]; writer.touch(); },
    setFail: (v) => { fail = v; },
    clear: () => { entries = []; },
  };
}

describe('Recall index writes', () => {
  it('a minute of page reads is one write, holding every page', async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) { t.read('https://site.test/' + i); await vi.advanceTimersByTimeAsync(1600); }
    // 30 reads 1.6 s apart: the old 1.5 s window wrote 30 times.
    expect(t.written.length).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    const total = t.written.length;
    expect(total).toBeLessThanOrEqual(2);
    expect(JSON.parse(t.written.at(-1).bytes)).toHaveLength(30);
    expect(WRITE_DELAY_MS).toBeGreaterThanOrEqual(60000);
  });

  it('nothing is written with nothing new, and a flush writes at once', async () => {
    const t = setup();
    await t.writer.flush();
    expect(t.written).toEqual([]);
    t.read('https://site.test/a');
    await t.writer.flush();
    expect(t.written).toHaveLength(1);
    expect(t.writer.dirty).toBe(false);
    expect(t.writer.waiting).toBe(false);          // the timer was dropped
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);
    expect(t.written).toHaveLength(1);
  });

  it('clearing writes even with nothing new, and says erase', async () => {
    const t = setup();
    t.clear();
    await t.writer.flush(true);
    expect(t.written).toEqual([{ bytes: '[]', erase: true }]);
  });

  it('a failed write loses nothing: it is said, and the next write has every page', async () => {
    const t = setup();
    t.setFail(true);
    t.read('https://site.test/a');
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(t.errors).toEqual(['disk busy']);
    expect(t.writer.dirty).toBe(true);
    await expect(t.writer.flush()).rejects.toThrow('disk busy');
    t.setFail(false);
    t.read('https://site.test/b');
    await t.writer.flush();
    expect(JSON.parse(t.written.at(-1).bytes)).toEqual(['https://site.test/a', 'https://site.test/b']);
  });

  it('refuses to be made without somewhere to report a failed timed write', () => {
    expect(() => createRecallWriter({ serialize: () => '', write: async () => {} })).toThrow('onError');
  });
});

describe('main.js wiring', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('writes on quit and on forget, and no longer on a 1.5 s timer', () => {
    expect(MAIN).not.toContain('RECALL_WRITE_DELAY = 1500');
    expect(MAIN).toMatch(/app\.on\('will-quit', \(event\) => \{\s*if \(_recallQuitSaved \|\| !_recallWriter\.dirty\) return;/);
    expect(MAIN).toContain('if (removed) { recallTouch(); await recallFlush(); }');
    expect(MAIN).toMatch(/ipcMain\.handle\('storage:flush'[^\n]*await recallFlush\(\)/);
  });
});
