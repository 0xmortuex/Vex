// Pause all / resume all downloads (main/downloads.js setAllPaused and its channel), with a stand-in DownloadItem.
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDownloadService } = require('../../src/main/downloads.js');
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

function fakeItem({ filename = 'thing.bin', canResume = true, throwOnPause = false } = {}) {
  const handlers = {};
  return {
    paused: false, cancelled: false, received: 0,
    getFilename: () => filename,
    getURL: () => 'https://example.test/' + filename,
    getTotalBytes: () => 1000,
    getReceivedBytes() { return this.received; },
    setSavePath: vi.fn(),
    isPaused() { if (throwOnPause) throw new Error('Object has been destroyed'); return this.paused; },
    canResume: () => canResume,
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    cancel() { this.cancelled = true; handlers.done?.(null, 'cancelled'); },
    on: (name, fn) => { handlers[name] = fn; },
    once: (name, fn) => { handlers[name] = fn; },
    fire: (name, ...args) => handlers[name]?.(null, ...args),
  };
}

function harness() {
  const sent = [];
  const ipc = new Map();
  const service = createDownloadService({
    app: { getPath: () => 'C:/downloads' },
    secureSessions: { owner: () => null, partitionOf: () => 'persist:main', fromPartition: () => ({ downloadURL: vi.fn() }), sessions: new Set() },
    broadcast: (channel, data) => sent.push({ channel, data }),
    ipcMain: { handle: (channel, fn) => ipc.set(channel, fn) },
    webContents: { getAllWebContents: () => [] },
  });
  const session = { on: (name, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
  const start = (item) => { session._will({}, item, null); return sent.filter(e => e.channel === 'download-started').pop().data.id; };
  return { service, ipc, start, invoke: (channel, ...args) => ipc.get(channel)({ sender: { isDestroyed: () => false } }, ...args) };
}

describe('setAllPaused', () => {
  it('pauses every running download and counts them', () => {
    const h = harness();
    const a = fakeItem({ filename: 'a.bin' }), b = fakeItem({ filename: 'b.bin' });
    h.start(a); h.start(b);
    expect(h.service.setAllPaused(true)).toEqual({ ok: true, changed: 2, failed: 0 });
    expect(a.paused && b.paused).toBe(true);
  });
  it('leaves one the person already paused alone, and does not count it', () => {
    const h = harness();
    const a = fakeItem({ filename: 'a.bin' }), b = fakeItem({ filename: 'b.bin' });
    h.start(a); h.start(b);
    a.pause();
    expect(h.service.setAllPaused(true).changed).toBe(1);
  });
  it('resumes only the paused ones', () => {
    const h = harness();
    const a = fakeItem({ filename: 'a.bin' }), b = fakeItem({ filename: 'b.bin' });
    h.start(a); h.start(b);
    a.pause();
    expect(h.service.setAllPaused(false)).toEqual({ ok: true, changed: 1, failed: 0 });
    expect(a.paused).toBe(false);
    expect(b.paused).toBe(false);
  });
  it('reports a transfer that cannot be resumed instead of forcing it', () => {
    const h = harness();
    const a = fakeItem({ filename: 'a.bin', canResume: false });
    h.start(a);
    a.pause();
    expect(h.service.setAllPaused(false)).toEqual({ ok: true, changed: 0, failed: 1 });
    expect(a.paused).toBe(true);
  });
  it('counts an item that throws as failed, says so on the console, and carries on with the others', () => {
    const h = harness();
    const bad = fakeItem({ filename: 'bad.bin', throwOnPause: true }), good = fakeItem({ filename: 'good.bin' });
    h.start(bad); h.start(good);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = h.service.setAllPaused(true);
    expect(r).toEqual({ ok: true, changed: 1, failed: 1 });
    expect(good.paused).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('does nothing for a download that has finished', () => {
    const h = harness();
    const a = fakeItem();
    h.start(a);
    a.fire('done', 'completed');
    expect(h.service.setAllPaused(true)).toEqual({ ok: true, changed: 0, failed: 0 });
  });
  it('never cancels a download', () => {
    const h = harness();
    const a = fakeItem();
    h.start(a);
    h.service.setAllPaused(true);
    h.service.setAllPaused(false);
    expect(a.cancelled).toBe(false);
  });
  it('refuses anything but true or false', () => {
    const h = harness();
    expect(() => h.service.setAllPaused('yes')).toThrow(/true or false/);
    expect(() => h.service.setAllPaused(undefined)).toThrow(/true or false/);
  });
});

describe('the channel', () => {
  it('answers with the counts, and with an error message instead of throwing', async () => {
    const h = harness();
    h.start(fakeItem());
    expect(await h.invoke('downloads:set-all-paused', true)).toEqual({ ok: true, changed: 1, failed: 0 });
    expect(await h.invoke('downloads:set-all-paused', 'x')).toEqual({ ok: false, error: 'Pause or resume: true or false' });
  });
  it('has a schema, a preload call, and is window-only', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('downloads:set-all-paused', [true])).not.toThrow();
    expect(() => validate('downloads:set-all-paused', ['true'])).toThrow();
    expect(read('src/preload.js')).toContain("ipcRenderer.invoke('downloads:set-all-paused'");
    expect(require('../../src/main/ipc-policy.js').UI_ONLY_CHANNELS.has('downloads:set-all-paused')).toBe(true);
  });
  it('does not release a download that is being held for permission: the holding code never enters the live list', () => {
    const src = read('src/main/downloads.js');
    const start = src.indexOf('function setAllPaused');
    expect(src.slice(start, start + 900)).toContain('_liveDownloads');
    expect(src).toMatch(/_liveDownloads\.set\(info\.id, item\)/);
  });
});
