import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDownloadService } = require('../../src/main/downloads.js');
const { createDownloadPrefs } = require('../../src/main/download-prefs.js');
const { validate } = require('../../src/main/ipc-schemas.js');

// Chrome's two download settings: where files go, and "Ask where to save each
// file before downloading". Every download went to the Downloads folder.

let tmp, downloads, chosen, file;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dl-'));
  downloads = path.join(tmp, 'Downloads'); fs.mkdirSync(downloads);
  chosen = path.join(tmp, 'Elsewhere'); fs.mkdirSync(chosen);
  file = path.join(tmp, 'download-prefs.json');
});
const makePrefs = () => createDownloadPrefs({ fs, file, defaultFolder: () => downloads });

function fakeItem(url = 'https://files.example/report.pdf') {
  return {
    getFilename: () => 'report.pdf', getURL: () => url, getURLChain: () => [url],
    getTotalBytes: () => 10, getReceivedBytes: () => 10, getSavePath: () => '',
    setSavePath: vi.fn(), setSaveDialogOptions: vi.fn(),
    isPaused: () => false, canResume: () => false, on() {}, once() {},
  };
}
function harness(prefs) {
  const service = createDownloadService({
    app: { getPath: () => downloads },
    secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
    broadcast: () => {}, ipcMain: null, prefs: () => prefs.current(),
  });
  const session = { on: (name, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
  return session;
}

describe('the download folder', () => {
  it('is the Downloads folder by default', () => {
    const prefs = makePrefs();
    expect(prefs.get()).toMatchObject({ folder: downloads, custom: false, ask: false });
    const item = fakeItem();
    harness(prefs)._will({}, item, null);
    expect(item.setSavePath).toHaveBeenCalledWith(path.join(downloads, 'report.pdf'));
  });

  it('is the folder chosen, and stays chosen after a restart', () => {
    makePrefs().setFolder(chosen);
    const prefs = makePrefs();
    expect(prefs.get()).toMatchObject({ folder: chosen, custom: true });
    const item = fakeItem();
    harness(prefs)._will({}, item, null);
    expect(item.setSavePath).toHaveBeenCalledWith(path.join(chosen, 'report.pdf'));
    expect(item.setSaveDialogOptions).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a folder on this computer', () => {
    const prefs = makePrefs();
    expect(() => prefs.setFolder('relative/dir')).toThrow();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    expect(() => prefs.setFolder(path.join(tmp, 'a.txt'))).toThrow('not a folder');
    expect(() => prefs.setFolder(path.join(tmp, 'missing'))).toThrow();
    expect(prefs.get().custom).toBe(false);
  });

  it('a chosen folder that has gone asks where to save, starting in Downloads, instead of failing', () => {
    const prefs = makePrefs();
    prefs.setFolder(chosen);
    fs.rmSync(chosen, { recursive: true });
    const item = fakeItem();
    harness(prefs)._will({}, item, null);
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(item.setSaveDialogOptions.mock.calls[0][0]).toMatchObject({ title: 'Save as', defaultPath: path.join(downloads, 'report.pdf') });
  });

  it('can only be set from main\'s own folder dialog: the channel takes no path from the window', () => {
    expect(() => validate('downloads:choose-folder', [])).not.toThrow();
    expect(() => validate('downloads:choose-folder', ['C:\\Windows\\System32'])).toThrow();
  });
});

describe('Ask where to save each file', () => {
  it('shows the Save dialog for every download, starting in the chosen folder', () => {
    const prefs = makePrefs();
    prefs.setFolder(chosen);
    prefs.setAsk(true);
    const session = harness(prefs);
    for (let i = 0; i < 2; i++) {
      const item = fakeItem();
      session._will({}, item, null);
      expect(item.setSavePath).not.toHaveBeenCalled();
      expect(item.setSaveDialogOptions.mock.calls[0][0]).toMatchObject({ title: 'Save as', defaultPath: path.join(chosen, 'report.pdf') });
    }
  });

  it('a Save dialog closed with Cancel leaves no row and no toast; a chosen place is announced with its real path', () => {
    const prefs = makePrefs();
    prefs.setAsk(true);
    const sent = [];
    const service = createDownloadService({
      app: { getPath: () => downloads },
      secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
      broadcast: (channel, data) => sent.push({ channel, data }), ipcMain: null, prefs: () => prefs.current(),
    });
    const session = { on: (name, fn) => { session._will = fn; } };
    service.wireDownloadsOnSession(session, 'test');
    const live = (savePath) => {
      const handlers = {};
      const item = { ...fakeItem(), getSavePath: () => savePath, on: (n, fn) => { handlers[n] = fn; }, once: (n, fn) => { handlers[n] = fn; } };
      session._will({}, item, null);
      return handlers;
    };
    live('').done(null, 'cancelled');
    expect(sent).toEqual([]);
    const picked = path.join(chosen, 'mine.pdf');
    const h = live(picked);
    expect(sent).toEqual([]);
    h.updated(null, 'progressing');
    expect(sent.map(s => s.channel)).toEqual(['download-started', 'download-progress']);
    expect(sent[0].data).toMatchObject({ path: picked, fileName: 'mine.pdf' });
    h.done(null, 'completed');
    expect(sent.at(-1)).toMatchObject({ channel: 'download-complete', data: { state: 'completed', path: picked } });
  });

  it('Reset to Defaults puts both back: the Downloads folder, and no asking', () => {
    const prefs = makePrefs();
    prefs.setFolder(chosen);
    prefs.setAsk(true);
    expect(prefs.reset()).toMatchObject({ folder: downloads, custom: false, ask: false });
    expect(makePrefs().get()).toMatchObject({ custom: false, ask: false });
  });

  it('is a switch: only true or false', () => {
    expect(() => makePrefs().setAsk('yes')).toThrow();
    expect(() => validate('downloads:set-ask', ['yes'])).toThrow();
    expect(() => validate('downloads:set-ask', [true])).not.toThrow();
  });
});
