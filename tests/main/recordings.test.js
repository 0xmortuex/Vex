// src/main/recordings.js — a recording written to disk as it is made.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecordings, MAX_BYTES } = require('../../src/main/recordings.js');

let dir, out, n;
function make(saveTo = 'auto') {
  n = 0;
  const dialog = { showSaveDialog: vi.fn(async (_w, opts) => (saveTo === null ? { canceled: true } : { canceled: false, filePath: path.join(out, 'saved-' + (++n) + '.' + opts.filters[0].extensions[0]) })) };
  const recs = createRecordings({ fs, path, dir, dialog, app: { getPath: () => out }, getWindow: () => null, randomId: () => 'r' + Math.random().toString(36).slice(2, 8), now: () => new Date(2026, 8, 19, 14, 5) });
  return { recs, dialog };
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-rec-'));
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-rec-out-'));
});

describe('recording to disk', () => {
  it('appends chunks in order, then moves the file where the user chose', async () => {
    const { recs, dialog } = make();
    const { id } = recs.start('mp4');
    // Sent without waiting — as the renderer would if it were careless.
    const p = [recs.chunk(id, new Uint8Array([1, 2])), recs.chunk(id, new Uint8Array([3])), recs.chunk(id, new Uint8Array([4, 5, 6]))];
    await Promise.all(p);
    const r = await recs.finish(id);
    expect(r.ok).toBe(true);
    expect([...fs.readFileSync(r.path)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.bytes).toBe(6);
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toMatch(/Vex recording 2026-09-19 14\.05\.mp4$/);
    expect(fs.readdirSync(dir)).toEqual([]);             // nothing left behind
  });

  it('declining to save deletes the recording rather than leaving it hidden somewhere', async () => {
    const { recs } = make(null);
    const { id } = recs.start('webm');
    await recs.chunk(id, new Uint8Array([1]));
    expect(await recs.finish(id)).toEqual({ ok: false, cancelled: true });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('discarding removes it', async () => {
    const { recs } = make();
    const { id } = recs.start('mp4');
    await recs.chunk(id, new Uint8Array([1, 2, 3]));
    await recs.cancel(id);
    expect(fs.readdirSync(dir)).toEqual([]);
    await expect(recs.chunk(id, new Uint8Array([1]))).rejects.toThrow(/already ended/);
  });

  it('an empty recording is not saved as a broken file', async () => {
    const { recs, dialog } = make();
    const { id } = recs.start('mp4');
    await expect(recs.finish(id)).rejects.toThrow(/Nothing was recorded/);
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('refuses a format it does not write, and chunks that are not bytes', async () => {
    const { recs } = make();
    expect(() => recs.start('avi')).toThrow(/MP4, WebM or GIF/);
    const { id } = recs.start('mp4');
    await expect(recs.chunk(id, 'text')).rejects.toThrow(/must be bytes/);
  });

  it('stops accepting past the size ceiling', async () => {
    const { recs } = make();
    const { id } = recs.start('mp4');
    recs._live.get(id).bytes = MAX_BYTES - 1;
    await expect(recs.chunk(id, new Uint8Array([1, 2]))).rejects.toThrow(/too large/);
  });

  it('clears leftovers from a crash on start, and only those', () => {
    fs.writeFileSync(path.join(dir, 'rec-old.part'), 'x');
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
    make().recs.cleanLeftovers();
    expect(fs.readdirSync(dir)).toEqual(['keep.txt']);
  });
});

// Vex's own window may capture the screen (the user pressed Record and
// chooses in Vex's picker); a web page may not without the usual prompt.
describe('who may capture the screen without a prompt', () => {
  const { isVexUi } = require('../../src/main/permissions.js');
  const wc = (type, url) => ({ getType: () => type, getURL: () => url, isDestroyed: () => false });
  it('Vex\'s own interface', () => {
    expect(isVexUi(wc('window', 'file:///C:/Program%20Files/Vex/resources/app.asar/src/renderer/index.html'))).toBe(true);
  });
  it('not a web page, not a tab, not a lookalike path on the web, not the start page', () => {
    expect(isVexUi(wc('webview', 'file:///C:/app/src/renderer/index.html'))).toBe(false);
    expect(isVexUi(wc('window', 'https://evil.example/renderer/index.html'))).toBe(false);
    expect(isVexUi(wc('window', 'file:///C:/app/src/renderer/start.html'))).toBe(false);
    expect(isVexUi(null)).toBe(false);
  });
});
