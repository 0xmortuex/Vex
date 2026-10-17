import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDownloadService } = require('../../src/main/downloads.js');
const { createDownloadPrefs } = require('../../src/main/download-prefs.js');
const { validate } = require('../../src/main/ipc-schemas.js');

// T2-072: some file kinds (installers) always ask where to save, whatever the general choice is.

let tmp, downloads, file;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dl-kinds-'));
  downloads = path.join(tmp, 'Downloads'); fs.mkdirSync(downloads);
  file = path.join(tmp, 'download-prefs.json');
});
const makePrefs = () => createDownloadPrefs({ fs, file, defaultFolder: () => downloads });

function item(name) {
  const url = 'https://files.example/' + name;
  return {
    getFilename: () => name, getURL: () => url, getURLChain: () => [url],
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

describe('file kinds that always ask where to save', () => {
  it('keeps and validates a list of extensions, and Reset forgets it', () => {
    const p = makePrefs();
    expect(p.get().askTypes).toEqual([]);
    expect(p.setAskTypes(['exe', 'msi', 'exe']).askTypes).toEqual(['exe', 'msi']);
    expect(makePrefs().get().askTypes).toEqual(['exe', 'msi']);
    expect(() => p.setAskTypes(['.exe'])).toThrow(/lowercase letters and digits/);
    expect(() => p.setAskTypes('exe')).toThrow(/list/);
    expect(p.reset().askTypes).toEqual([]);
  });

  it('shows the Save dialog for an installer and not for a PDF', () => {
    const p = makePrefs();
    p.setAskTypes(['exe']);
    const session = harness(p);
    const installer = item('setup.exe');
    session._will({}, installer, null);
    expect(installer.setSaveDialogOptions).toHaveBeenCalledTimes(1);
    expect(installer.setSavePath).not.toHaveBeenCalled();
    const pdf = item('report.pdf');
    session._will({}, pdf, null);
    expect(pdf.setSavePath).toHaveBeenCalledTimes(1);
    expect(pdf.setSaveDialogOptions).not.toHaveBeenCalled();
  });

  it('asks for nothing special when the list is empty', () => {
    const session = harness(makePrefs());
    const installer = item('setup.exe');
    session._will({}, installer, null);
    expect(installer.setSavePath).toHaveBeenCalledTimes(1);
    expect(installer.setSaveDialogOptions).not.toHaveBeenCalled();
  });

  it('the channel takes extensions only, never a path', () => {
    expect(() => validate('downloads:set-ask-types', [['exe', 'msi']])).not.toThrow();
    expect(() => validate('downloads:set-ask-types', [['C:\\Windows']])).toThrow();
    expect(() => validate('downloads:set-ask-types', [['exe/../x']])).toThrow();
    expect(() => validate('downloads:set-ask-types', ['exe'])).toThrow();
  });
});
