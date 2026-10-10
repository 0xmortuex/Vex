import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDownloadService } = require('../../src/main/downloads.js');
const { createPermissionService } = require('../../src/main/permissions.js');

// Chrome's "automatic downloads": a page that starts download after download
// with no click is asked about once per site. Electron has no limiter, so a
// page could drop any number of files into Downloads without a question.

function fakeItem(url) {
  const handlers = {};
  const add = (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); };
  return {
    getFilename: () => path.basename(new URL(url).pathname), getURL: () => url, getURLChain: () => [url],
    getTotalBytes: () => 10, getReceivedBytes: () => 10, getSavePath: () => '',
    setSavePath: vi.fn(), setSaveDialogOptions: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
    isPaused: () => false, canResume: () => false,
    on: add, once: add,
    // Ends as Chromium would: the file written at the path it was given.
    finish(state = 'completed') { const p = this.setSavePath.mock.calls[0][0]; if (state === 'completed') fs.writeFileSync(p, 'data'); for (const fn of handlers.done || []) fn(null, state); handlers.done = []; },
  };
}
function fakePage(id, url, partition = 'persist:main') {
  return { id, getURL: () => url, once() {}, partition, session: {} };
}

let tmp, perms, prompts, gestures, service, session, started, completed, folder, profile;
function setup() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-autodl-'));
  prompts = [];
  gestures = new Map();
  started = []; completed = [];
  folder = path.join(tmp, 'Downloads'); profile = path.join(tmp, 'profile');
  fs.mkdirSync(folder); fs.mkdirSync(profile);
  const handlers = new Map();
  const win = { isDestroyed: () => false, webContents: { send: (ch, payload) => { if (ch === 'permission:request') prompts.push(payload); } } };
  const host = { win };
  const secureSessions = { owner: () => host, partitionOf: (c) => c.partition || 'persist:main' };
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) };
  perms = createPermissionService({ userDataPath: tmp, secureSessions, ipcMain, _markHidRequestActive() {} });
  perms.permissionsReady();
  perms.respond = (decision, remember = true) => handlers.get('permission:respond')({ sender: {} }, { id: prompts.at(-1).id, decision, remember });
  service = createDownloadService({
    app: { getPath: (n) => (n === 'userData' ? profile : folder) }, secureSessions,
    broadcast: (channel, data) => { if (channel === 'download-started') started.push(data.url); if (channel === 'download-complete') completed.push(data); },
    ipcMain: null,
    lastGestureAt: (c) => gestures.get(c.id), askAutoDownloads: perms.askAutomaticDownloads,
  });
  session = { on: (n, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
}
const download = (page, url) => {
  const item = fakeItem(url);
  const event = { preventDefault: vi.fn() };
  session._will(event, item, page);
  return { item, event };
};
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(setup);

describe('a page starting downloads by itself', () => {
  it('the first goes ahead; the second asks, paused, and Allow lets it go on and is kept for the site', async () => {
    const page = fakePage(1, 'https://files.example/list');
    download(page, 'https://files.example/a.bin');
    expect(prompts).toEqual([]);
    const second = download(page, 'https://files.example/b.bin');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ origin: 'https://files.example', permission: 'automatic-downloads', choice: 'allow-block', remember: true });
    expect(second.item.pause).toHaveBeenCalled();
    expect(started).toEqual(['https://files.example/a.bin']);
    await perms.respond('allow');
    await settle();
    expect(second.item.resume).toHaveBeenCalled();
    expect(started).toEqual(['https://files.example/a.bin', 'https://files.example/b.bin']);
    expect(perms.decisionsFor(page)['https://files.example::automatic-downloads']).toBe('allow');
    // A new tab of the same site later is not asked again.
    const later = fakePage(2, 'https://files.example/other');
    download(later, 'https://files.example/c.bin');
    const fourth = download(later, 'https://files.example/d.bin');
    expect(prompts).toHaveLength(1);
    expect(fourth.event.preventDefault).not.toHaveBeenCalled();
  });

  it('Block cancels it without it ever reaching the panel, and later ones are refused at once', async () => {
    const page = fakePage(1, 'https://spam.example/');
    download(page, 'https://spam.example/1.exe');
    const second = download(page, 'https://spam.example/2.exe');
    await perms.respond('deny');
    await settle();
    expect(second.item.cancel).toHaveBeenCalled();
    expect(started).toEqual(['https://spam.example/1.exe']);
    const third = download(page, 'https://spam.example/3.exe');
    expect(third.event.preventDefault).toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
  });

  it('several more while it is being asked wait for the one answer', async () => {
    const page = fakePage(1, 'https://files.example/');
    download(page, 'https://files.example/1');
    const a = download(page, 'https://files.example/2');
    const b = download(page, 'https://files.example/3');
    expect(prompts).toHaveLength(1);
    await perms.respond('allow');
    await settle();
    expect(a.item.resume).toHaveBeenCalled();
    expect(b.item.resume).toHaveBeenCalled();
  });

  it('downloads the user clicked are never asked: one click, one download', () => {
    const page = fakePage(1, 'https://files.example/');
    gestures.set(1, Date.now() - 5);
    download(page, 'https://files.example/1');
    gestures.set(1, Date.now() - 1);
    download(page, 'https://files.example/2');
    expect(prompts).toEqual([]);
    // The same click does not cover a third the page adds by itself.
    download(page, 'https://files.example/3');
    expect(prompts).toHaveLength(1);
  });

  it('downloads Vex starts for you (Save image, Retry, a media download) are not counted', () => {
    const page = fakePage(1, 'https://files.example/');
    download(page, 'https://files.example/1');
    service.markMine('https://files.example/pic.png');
    const mine = download(page, 'https://files.example/pic.png');
    expect(prompts).toEqual([]);
    expect(mine.item.pause).not.toHaveBeenCalled();
  });

  it('a second download well after the first is not asked', () => {
    const page = fakePage(1, 'https://files.example/');
    const t0 = Date.now();
    expect(service.autoDownloadCheck(page, ['https://files.example/1'], 'persist:main', t0)).toBeNull();
    expect(service.autoDownloadCheck(page, ['https://files.example/2'], 'persist:main', t0 + 60000)).toBeNull();
    expect(service.autoDownloadCheck(page, ['https://files.example/3'], 'persist:main', t0 + 61000)).toMatchObject({ origin: 'https://files.example' });
  });

  it('a private window or Tor tab is asked the same way, but nothing is kept beyond the tab', async () => {
    for (const partition of ['private-1', 'persist:route-tor']) {
      setup();
      const page = fakePage(1, 'https://files.example/', partition);
      download(page, 'https://files.example/1');
      download(page, 'https://files.example/2');
      expect(prompts[0]).toMatchObject({ choice: 'allow-block', remember: false });
      await perms.respond('allow', false);
      await settle();
      expect(perms.decisionsFor(fakePage(9, 'x', 'persist:main'))['https://files.example::automatic-downloads']).toBeUndefined();
      expect(fs.existsSync(path.join(tmp, 'permissions.json'))).toBe(false);
      // The tab itself is not asked twice.
      download(page, 'https://files.example/3');
      expect(prompts).toHaveLength(1);
      // Another tab is asked again.
      const other = fakePage(2, 'https://files.example/', partition);
      download(other, 'https://files.example/4');
      download(other, 'https://files.example/5');
      expect(prompts).toHaveLength(2);
    }
  });

  it('while asked, the file is written only in the profile\'s holding folder — even one that finishes before the answer — and Allow moves it into the download folder', async () => {
    const page = fakePage(1, 'https://files.example/');
    download(page, 'https://files.example/1.bin').item.finish();
    const second = download(page, 'https://files.example/2.bin');
    const held = second.item.setSavePath.mock.calls[0][0];
    expect(held.startsWith(path.join(profile, 'held-downloads'))).toBe(true);
    second.item.finish();                          // a small file completes while paused
    expect(fs.readdirSync(folder)).toEqual(['1.bin']);
    await perms.respond('allow');
    await settle();
    expect(fs.readdirSync(folder).sort()).toEqual(['1.bin', '2.bin']);
    expect(fs.existsSync(path.dirname(held))).toBe(false);
    expect(completed.at(-1)).toMatchObject({ state: 'completed', path: path.join(folder, '2.bin') });
    expect(service.isDownloadedFile(path.join(folder, '2.bin'))).toBe(true);
  });

  it('Block deletes what was held and leaves the download folder as it was', async () => {
    const page = fakePage(1, 'https://spam.example/');
    download(page, 'https://spam.example/1.bin').item.finish();
    const second = download(page, 'https://spam.example/2.bin');
    const held = second.item.setSavePath.mock.calls[0][0];
    second.item.finish();
    await perms.respond('deny');
    await settle();
    expect(fs.readdirSync(folder)).toEqual(['1.bin']);
    expect(fs.existsSync(path.dirname(held))).toBe(false);
    expect(completed.map(c => c.fileName)).toEqual(['1.bin']);
  });

  it('with "Ask where to save each file" on, an allowed one is asked where to go after the site is allowed', async () => {
    const asked = [];
    const prefsFolder = folder;
    service = createDownloadService({
      app: { getPath: (n) => (n === 'userData' ? profile : prefsFolder) },
      secureSessions: { owner: () => ({ win: { isDestroyed: () => false, webContents: { send: (ch, p) => { if (ch === 'permission:request') prompts.push(p); } } } }), partitionOf: () => 'persist:main' },
      broadcast: (ch, d) => { if (ch === 'download-complete') completed.push(d); }, ipcMain: null,
      prefs: () => ({ folder: null, ask: true }),
      lastGestureAt: () => undefined, askAutoDownloads: perms.askAutomaticDownloads,
      dialog: { showSaveDialog: async (_w, o) => { asked.push(o); return { canceled: false, filePath: path.join(prefsFolder, 'picked.bin') }; } },
    });
    session = { on: (n, fn) => { session._will = fn; } };
    service.wireDownloadsOnSession(session, 'test');
    const page = fakePage(5, 'https://files.example/');
    download(page, 'https://files.example/1.bin');
    const second = download(page, 'https://files.example/2.bin');
    expect(second.item.setSaveDialogOptions).not.toHaveBeenCalled();   // no dialog while the site is asked
    second.item.finish();
    await perms.respond('allow');
    await settle(); await settle();
    expect(asked).toHaveLength(1);
    expect(fs.existsSync(path.join(folder, 'picked.bin'))).toBe(true);
  });

  it('the site panel can set it', async () => {
    const page = fakePage(1, 'https://files.example/');
    await perms.setPageDecision(page, 'https://files.example', 'automatic-downloads', 'deny');
    download(page, 'https://files.example/1');
    expect(download(page, 'https://files.example/2').event.preventDefault).toHaveBeenCalled();
    expect(prompts).toEqual([]);
  });
});
