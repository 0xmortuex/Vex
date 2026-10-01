import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { createDownloadService } = createRequire(import.meta.url)('../../src/main/downloads.js');

// "Save Image As…" used to be a plain download straight into Downloads: the
// label promised a choice it never offered. Now the next download of that
// address shows the system Save dialog, and where the user put it is what the
// Downloads panel reports.

function fakeItem(url = 'https://img.example/moon.png') {
  const handlers = {};
  return {
    chosen: '',
    getFilename: () => 'moon.png',
    getURL: () => url,
    getURLChain: () => [url],
    getTotalBytes: () => 10,
    getReceivedBytes: () => 10,
    getSavePath() { return this.chosen; },
    setSavePath: vi.fn(),
    setSaveDialogOptions: vi.fn(),
    isPaused: () => false,
    canResume: () => false,
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
    secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
    broadcast: (channel, data) => sent.push({ channel, data }),
    ipcMain: { handle: (channel, fn) => ipc.set(channel, fn) },
  });
  const session = { on: (name, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
  return { service, session, sent, ipc };
}

describe('Save Image As', () => {
  it('asks where to save instead of landing in Downloads', async () => {
    const h = harness();
    expect(await h.ipc.get('downloads:ask-where')({}, 'https://img.example/moon.png')).toEqual({ ok: true });
    const item = fakeItem();
    h.session._will({}, item, null);
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(item.setSaveDialogOptions).toHaveBeenCalledTimes(1);
    expect(item.setSaveDialogOptions.mock.calls[0][0].title).toBe('Save image as');
  });

  it('reports where the user put it', () => {
    const h = harness();
    h.service.askWhere('https://img.example/moon.png');
    const item = fakeItem();
    h.session._will({}, item, null);
    item.chosen = 'D:\\Pictures\\moon knight.png';
    item.fire('updated', 'progressing');
    item.fire('done', 'completed');
    const done = h.sent.find(s => s.channel === 'download-complete').data;
    expect(done.path).toBe('D:\\Pictures\\moon knight.png');
    expect(done.fileName).toBe('moon knight.png');
  });

  it('asks once: the next download of the same address goes to Downloads', () => {
    const h = harness();
    h.service.askWhere('https://img.example/moon.png');
    h.session._will({}, fakeItem(), null);
    const again = fakeItem();
    h.session._will({}, again, null);
    expect(again.setSavePath).toHaveBeenCalledTimes(1);
    expect(again.setSaveDialogOptions).not.toHaveBeenCalled();
  });

  it('does not ask for a different download', () => {
    const h = harness();
    h.service.askWhere('https://img.example/moon.png');
    const other = fakeItem('https://img.example/other.png');
    h.session._will({}, other, null);
    expect(other.setSavePath).toHaveBeenCalledTimes(1);
  });

  it('a request that is never followed by a download expires', () => {
    const h = harness();
    h.service.askWhere('https://img.example/moon.png', 0);
    expect(h.service._takeAsk(['https://img.example/moon.png'], 60000)).toBe(false);
  });

  it('follows the address through a redirect', () => {
    const h = harness();
    h.service.askWhere('https://short.example/x');
    const item = fakeItem('https://cdn.example/final.png');
    item.getURLChain = () => ['https://short.example/x', 'https://cdn.example/final.png'];
    h.session._will({}, item, null);
    expect(item.setSaveDialogOptions).toHaveBeenCalledTimes(1);
  });
});
