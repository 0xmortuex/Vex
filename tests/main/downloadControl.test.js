import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { createDownloadService } = createRequire(import.meta.url)('../../src/main/downloads.js');

// A DownloadItem stand-in with just the surface the service touches.
function fakeItem({ total = 1000, filename = 'thing.bin', canResume = true } = {}) {
  const handlers = {};
  return {
    paused: false, cancelled: false, received: 0,
    getFilename: () => filename,
    getURL: () => 'https://example.test/' + filename,
    getTotalBytes: () => total,
    getReceivedBytes() { return this.received; },
    setSavePath: vi.fn(),
    isPaused() { return this.paused; },
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
  const ipcMain = { handle: (channel, fn) => ipc.set(channel, fn) };
  const service = createDownloadService({
    app: { getPath: () => 'C:/downloads' },
    secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
    broadcast: (channel, data) => sent.push({ channel, data }),
    ipcMain,
  });
  const session = { on: (name, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
  return { service, session, sent, ipc, invoke: (channel, ...args) => ipc.get(channel)({ sender: { isDestroyed: () => false, downloadURL: vi.fn() } }, ...args) };
}

describe('download control service', () => {
  it('exposes the live item so it can be paused, resumed and cancelled', () => {
    const h = harness();
    const item = fakeItem();
    h.session._will({}, item, null);
    const id = h.sent[0].data.id;

    expect(h.service.control(id, 'pause')).toEqual({ ok: true, paused: true });
    expect(item.paused).toBe(true);
    // Pausing twice is not an error; it is already where the user asked for.
    expect(h.service.control(id, 'pause')).toEqual({ ok: true, paused: true });
    expect(h.service.control(id, 'resume')).toEqual({ ok: true, paused: false });
    expect(item.paused).toBe(false);
    expect(h.service.control(id, 'cancel')).toEqual({ ok: true });
    expect(item.cancelled).toBe(true);
  });

  it('refuses to resume a transfer the server will not let us resume', () => {
    const h = harness();
    const item = fakeItem({ canResume: false });
    h.session._will({}, item, null);
    const id = h.sent[0].data.id;
    h.service.control(id, 'pause');
    expect(h.service.control(id, 'resume')).toEqual({ ok: false, error: 'This download cannot be resumed' });
  });

  it('drops the handle once the download is done and says so', () => {
    const h = harness();
    const item = fakeItem();
    h.session._will({}, item, null);
    const id = h.sent[0].data.id;
    item.fire('done', 'completed');
    expect(h.service._liveDownloads.has(id)).toBe(false);
    expect(h.service.control(id, 'pause')).toEqual({ ok: false, error: 'That download has already finished' });
  });

  it('rejects an unknown action rather than doing nothing quietly', () => {
    const h = harness();
    h.session._will({}, fakeItem(), null);
    const id = h.sent[0].data.id;
    expect(() => h.service.control(id, 'destroy')).toThrow(/Unknown download action/);
  });

  it('reports the real byte counts on completion', () => {
    const h = harness();
    const item = fakeItem({ total: 0 });          // server sent no Content-Length
    h.session._will({}, item, null);
    item.received = 4096;
    item.fire('done', 'completed');
    const done = h.sent.find(e => e.channel === 'download-complete');
    expect(done.data.receivedBytes).toBe(4096);
    expect(done.data.totalBytes).toBe(0);
    expect(done.data.url).toBe('https://example.test/thing.bin');
  });

  it('carries the paused flag through progress events', () => {
    const h = harness();
    const item = fakeItem();
    h.session._will({}, item, null);
    item.pause();
    item.fire('updated', 'progressing');
    const progress = h.sent.find(e => e.channel === 'download-progress');
    expect(progress.data.paused).toBe(true);
    expect(progress.data.state).toBe('progressing');
  });

  it('only retries http(s) URLs', async () => {
    const h = harness();
    expect(await h.invoke('downloads:retry', 'file:///C:/Windows/System32/calc.exe'))
      .toEqual({ ok: false, error: 'Only http(s) downloads can be retried' });
    expect(await h.invoke('downloads:retry', 'https://example.test/x.bin')).toEqual({ ok: true });
  });

  it('turns a bad id into a reported error, not a thrown handler', async () => {
    const h = harness();
    expect(await h.invoke('downloads:control', 42, 'pause')).toEqual({ ok: false, error: 'Invalid download id' });
  });
});
