// A4: free-space preflight and the "cannot quit on a full disk" dead end. The disk is simulated: statfs is injected
// and every write error is an injected ENOSPC; nothing here touches a real disk or fills one.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createDiskGuard, DiskLowError, REFUSAL, FLOOR, WARN_BELOW } = require('../../src/main/disk-guard.js');
const { offerFlushRescue, BTN_SAVE, BTN_QUIT, BTN_RETRY } = require('../../src/main/flush-rescue.js');
const { createVoiceStore } = require('../../src/main/voice-model.js');
const { createRecordings } = require('../../src/main/recordings.js');

const MB = 1024 * 1024, GB = 1024 * MB;
const quiet = { warn() {}, error: vi.fn(), log() {} };
const free = (bytes) => async () => ({ bavail: Math.floor(bytes / 4096), bsize: 4096 });

describe('disk guard', () => {
  it('lets a write through when it leaves more than the floor free, refuses when it would not', async () => {
    const g = createDiskGuard({ dir: 'd', statfs: free(1 * GB), log: quiet });
    expect((await g.check({ need: 100 * MB })).ok).toBe(true);
    expect((await g.check({ need: 600 * MB })).ok).toBe(false);
    await expect(g.require({ need: 600 * MB, what: 'the update download' })).rejects.toMatchObject({ code: 'EDISKLOW', message: REFUSAL });
    await expect(g.require({ need: 600 * MB })).rejects.toBeInstanceOf(DiskLowError);
    expect((await g.require({ need: 100 * MB })).free).toBeGreaterThan(FLOOR);
  });

  it('reads the free space of the folder it was given', async () => {
    const seen = [];
    const g = createDiskGuard({ dir: 'C:/profile', statfs: async (d) => { seen.push(d); return { bavail: 10, bsize: 1024 }; }, log: quiet });
    expect(await g.freeBytes()).toBe(10240);
    expect(seen).toEqual(['C:/profile']);
  });

  it('a drive it cannot read does not block the write, and the failure is logged, not swallowed', async () => {
    const log = { warn() {}, error: vi.fn() };
    const g = createDiskGuard({ dir: 'd', statfs: async () => { throw new Error('no such drive'); }, log });
    const r = await g.check({ need: 5 * GB });
    expect(r).toMatchObject({ ok: true, unknown: true });
    expect(log.error).toHaveBeenCalled();
    expect(await g.warnIfLow()).toBeNull();
  });

  it('warns below 2 GB through the Attention Inbox notes, once a day, and stays quiet above', async () => {
    const posted = [];
    let t = 1_000_000, bytes = 1 * GB;
    const g = createDiskGuard({ dir: 'd', statfs: async () => ({ bavail: Math.floor(bytes / 4096), bsize: 4096 }), notes: { post: (n) => posted.push(n) }, log: quiet, now: () => t });
    await g.warnIfLow();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ feature: 'disk-space', title: 'Your disk is nearly full' });
    await g.warnIfLow();
    expect(posted).toHaveLength(1);
    t += 25 * 3600 * 1000;
    await g.warnIfLow();
    expect(posted).toHaveLength(2);
    bytes = WARN_BELOW + 100 * MB; t += 25 * 3600 * 1000;
    await g.warnIfLow();
    expect(posted).toHaveLength(2);
  });
});

describe('the large writes ask the guard first', () => {
  it('a voice model download is refused on a nearly full disk, before any request is made', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vm-'));
    try {
      const fetchImpl = vi.fn();
      const store = createVoiceStore({ dir, fetchImpl, catalogue: null, guard: createDiskGuard({ dir, statfs: free(300 * MB), log: quiet }) });
      await expect(store.download('base')).rejects.toMatchObject({ code: 'EDISKLOW' });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a recording is refused at the start on a nearly full disk, and stopped (not corrupted) when the disk fills mid-way', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-rec-'));
    try {
      let bytes = 2 * GB, t = 0;
      const guard = createDiskGuard({ dir, statfs: async () => ({ bavail: Math.floor(bytes / 4096), bsize: 4096 }), log: quiet });
      const rec = createRecordings({ fs, path, dir, dialog: {}, app: {}, randomId: () => 'r1', guard, now: () => new Date(t) });
      bytes = 100 * MB;
      await expect(rec.startChecked('webm')).rejects.toMatchObject({ code: 'EDISKLOW' });
      bytes = 2 * GB;
      const { id } = await rec.startChecked('webm');
      await rec.chunk(id, new Uint8Array(10));
      bytes = 50 * MB; t += 60_000;                              // the disk fills while recording
      await expect(rec.chunk(id, new Uint8Array(10))).rejects.toMatchObject({ code: 'EDISKLOW' });
      // what was already recorded is still there to save
      expect(fs.readdirSync(dir).filter(n => n.endsWith('.part'))).toHaveLength(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('flush failure rescue (the cannot-quit dead end)', () => {
  const mk = (responses, over = {}) => {
    const calls = { closed: 0, retried: 0, written: [] };
    const seq = [...responses];
    const dialog = { showMessageBox: vi.fn(async () => ({ response: seq.shift() })) };
    const base = {
      dialog, win: null, snapshot: async () => '{"v":1,"items":{}}', documentsDir: () => 'C:/Docs',
      writeNewFile: (f, t) => calls.written.push([f, t]), closeNow: () => { calls.closed++; }, retryClose: () => { calls.retried++; },
      now: () => new Date(2026, 10, 7, 9, 5, 3), log: quiet,
    };
    return { calls, dialog, run: () => offerFlushRescue({ ...base, ...over }) };
  };

  it('offers exactly the three ways out', async () => {
    const t = mk([2]);
    await t.run();
    const opts = t.dialog.showMessageBox.mock.calls[0][1];
    expect(opts.buttons).toEqual([BTN_SAVE, BTN_QUIT, BTN_RETRY]);
    expect(BTN_SAVE).toBe('Save an emergency copy to Documents and quit');
  });

  it('Save an emergency copy: writes a dated file to Documents, then quits', async () => {
    const t = mk([0]);
    const r = await t.run();
    expect(r.action).toBe('saved');
    expect(t.calls.written).toHaveLength(1);
    expect(t.calls.written[0][0].replace(/\\/g, '/')).toBe('C:/Docs/Vex-emergency-copy-2026-11-07-090503.json');
    expect(t.calls.closed).toBe(1);
  });

  it('Quit without saving closes without writing; Try again retries the close and does not quit', async () => {
    const a = mk([1]); await a.run();
    expect(a.calls).toMatchObject({ closed: 1, retried: 0, written: [] });
    const b = mk([2]); await b.run();
    expect(b.calls).toMatchObject({ closed: 0, retried: 1 });
  });

  it('a full disk (ENOSPC) while writing the copy: says so, asks again, never closes on its own; the owner can then still quit', async () => {
    const enospc = () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
    const t = mk([0, 0, 1], { writeNewFile: enospc });
    const r = await t.run();
    expect(r.action).toBe('quit');
    expect(t.dialog.showMessageBox).toHaveBeenCalledTimes(3);
    expect(t.dialog.showMessageBox.mock.calls[1][1].detail).toMatch(/emergency copy could not be saved: ENOSPC/);
    expect(t.calls.closed).toBe(1);        // only from the explicit "Quit without saving"
  });

  it('a snapshot that fails or is empty is also reported, not closed on', async () => {
    const t = mk([0, 1], { snapshot: async () => '' });
    const r = await t.run();
    expect(r.action).toBe('quit');
    expect(t.calls.written).toEqual([]);
  });
});

describe('main.js wiring (static: Electron itself is not started here)', () => {
  const src = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  it('a failed flush offers the rescue dialog instead of only a toast', () => {
    expect(src).toMatch(/ipcMain\.on\('storage:flush-failed'[\s\S]{0,600}_offerFlushRescue\(host\)/);
    expect(src).toMatch(/require\('\.\/main\/flush-rescue'\)\.offerFlushRescue/);
  });
  it('the large writes are given the guard: updater, voice models, recordings, the pre-update backup', () => {
    expect(src).toMatch(/keepFiles: \(\) => _updateRollback\.keepFiles\(\),\s+guard: \{ require/);
    expect(src).toMatch(/createVoiceStore\(\{[^\n]*guard: \{ require/);
    expect(src).toMatch(/downloadFolder: _chosenDownloadFolder, guard: \{ require/);
    expect(src).toMatch(/_recordings\.startChecked\(ext\)/);
    expect(src).toMatch(/updates:backup-save'[\s\S]{0,300}_diskGuard\.require/);
    expect(src).toMatch(/_diskGuard\.warnIfLow\(\)/);
  });
});
