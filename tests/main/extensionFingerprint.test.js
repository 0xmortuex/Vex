// @vitest-environment node
//
// "Did an extension's files change without Vex installing or updating it?" (src/main/extension-fingerprint.js):
// real files in a temp folder, real SHA-256, a counted reader so "a normal launch reads nothing" is checked, no clock dependence
// (every file gets an explicit modified time).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createExtensionFingerprints } = require('../../src/main/extension-fingerprint.js');

let root, extDir, recordFile, reads, log;
const T0 = 1700000000;   // seconds
const put = (folder, rel, text, at = T0) => {
  const f = path.join(extDir, folder, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  fs.utimesSync(f, at, at);
};
const make = (over = {}) => createExtensionFingerprints({
  fs: { ...fs, createReadStream: (...a) => { reads.push(a[0]); return fs.createReadStream(...a); } },
  extensionsDir: extDir, file: recordFile, appVersion: '2.40.0', log, yieldNow: async () => {}, ...over,
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-extfp-'));
  extDir = path.join(root, 'extensions');
  recordFile = path.join(root, 'extension-fingerprints.json');
  reads = [];
  log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  put('dark-1', 'manifest.json', '{"name":"Dark"}');
  put('dark-1', 'js/content.js', 'console.log(1)');
  put('tabs-2', 'manifest.json', '{"name":"Tabs"}');
});

describe('extension fingerprints', () => {
  it('records an extension that Vex just installed, and a later look finds nothing and reads nothing', async () => {
    const fp = make();
    await fp.record('dark-1');
    await fp.record('tabs-2');
    reads = [];
    const r = await fp.check(['dark-1', 'tabs-2']);
    expect(r).toEqual({ changed: [], skipped: [], recorded: 0, unreadable: [] });
    expect(reads).toEqual([]);
  });

  it('reports files that changed outside Vex, once, and does not touch them', async () => {
    const fp = make();
    await fp.record('dark-1');
    put('dark-1', 'js/content.js', 'console.log(2)', T0 + 60);       // same size, new content and date
    const r = await fp.check(['dark-1']);
    expect(r.changed).toEqual([{ folder: 'dark-1', files: 2, bytes: expect.any(Number) }]);
    expect(fs.readFileSync(path.join(extDir, 'dark-1/js/content.js'), 'utf8')).toBe('console.log(2)');
    const again = await fp.check(['dark-1']);
    expect(again.changed).toEqual([]);                                // told already
    // and a later change is a new report
    put('dark-1', 'js/content.js', 'console.log(3) // more', T0 + 120);
    expect((await fp.check(['dark-1'])).changed).toHaveLength(1);
  });

  it('a new or removed file counts as a change too', async () => {
    const fp = make();
    await fp.record('dark-1');
    put('dark-1', 'extra.js', 'x', T0 + 30);
    expect((await fp.check(['dark-1'])).changed).toHaveLength(1);
    await fp.record('dark-1');                                        // Vex accepted it (an update)
    fs.rmSync(path.join(extDir, 'dark-1/extra.js'));
    expect((await fp.check(['dark-1'])).changed).toHaveLength(1);
  });

  it('a file only touched (same content, new date) is read but not reported', async () => {
    const fp = make();
    await fp.record('dark-1');
    put('dark-1', 'js/content.js', 'console.log(1)', T0 + 500);
    reads = [];
    const r = await fp.check(['dark-1']);
    expect(r.changed).toEqual([]);
    expect(reads.length).toBeGreaterThan(0);
    reads = [];
    await fp.check(['dark-1']);
    expect(reads).toEqual([]);                                        // the new date was kept
  });

  it('an install or update by Vex replaces the approved files and clears an earlier report', async () => {
    const fp = make();
    await fp.record('dark-1');
    put('dark-1', 'js/content.js', 'console.log(9)', T0 + 60);
    expect((await fp.check(['dark-1'])).changed).toHaveLength(1);
    await fp.record('dark-1');
    expect((await fp.check(['dark-1'])).changed).toEqual([]);
    put('dark-1', 'js/content.js', 'console.log(8)', T0 + 90);
    expect((await fp.check(['dark-1'])).changed).toHaveLength(1);
  });

  it('an extension seen for the first time is recorded silently', async () => {
    const fp = make();
    const r = await fp.check(['dark-1', 'tabs-2']);
    expect(r.changed).toEqual([]);
    expect(r.recorded).toBe(2);
    const saved = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    expect(Object.keys(saved.items).sort()).toEqual(['dark-1', 'tabs-2']);
    expect(saved.items['dark-1'].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('after a Vex update the first look re-records instead of reporting', async () => {
    await make().record('dark-1');
    put('dark-1', 'js/content.js', 'console.log(5)', T0 + 60);
    const r = await make({ appVersion: '2.41.0' }).check(['dark-1']);
    expect(r.changed).toEqual([]);
    expect(r.recorded).toBe(1);
    put('dark-1', 'js/content.js', 'console.log(6)', T0 + 120);
    expect((await make({ appVersion: '2.41.0' }).check(['dark-1'])).changed).toHaveLength(1);
  });

  it('a file Vex rewrites itself (the storage shim) is not part of the fingerprint', async () => {
    put('dark-1', 'vex-storage-sync.js', 'shim v1');
    const fp = make({ ignore: ['vex-storage-sync.js'] });
    await fp.record('dark-1');
    put('dark-1', 'vex-storage-sync.js', 'shim v2 after a Vex update', T0 + 60);
    expect((await fp.check(['dark-1'])).changed).toEqual([]);
  });

  it('skips an extension over the cap and says so once', async () => {
    for (let i = 0; i < 5; i++) put('dark-1', 'many/f' + i + '.js', 'x');
    const fp = make({ maxFiles: 4 });
    await fp.record('dark-1');                                        // skipped: stored as such
    const first = await fp.check(['dark-1']);
    expect(first.skipped).toEqual([{ folder: 'dark-1', reason: 'files', fresh: false }]);
    const fresh = await make({ maxFiles: 4, file: path.join(root, 'other.json') }).check(['dark-1']);
    expect(fresh.skipped).toEqual([{ folder: 'dark-1', reason: 'files', fresh: true }]);
    expect(fresh.changed).toEqual([]);
    const big = await make({ maxBytes: 10, file: path.join(root, 'third.json') }).check(['dark-1']);
    expect(big.skipped[0].reason).toBe('bytes');
  });

  it('forgets a folder that is gone, and re-records after forget()', async () => {
    const fp = make();
    await fp.record('dark-1');
    await fp.record('tabs-2');
    await fp.check(['dark-1']);                                       // tabs-2 was uninstalled
    expect(Object.keys(JSON.parse(fs.readFileSync(recordFile, 'utf8')).items)).toEqual(['dark-1']);
    expect(fp.forget('dark-1')).toBe(true);
    expect(fp.forget('dark-1')).toBe(false);
    put('dark-1', 'js/content.js', 'changed while not yet recorded', T0 + 70);
    const r = await fp.check(['dark-1']);
    expect(r.changed).toEqual([]);
    expect(r.recorded).toBe(1);
  });

  it('a folder that cannot be read is reported as such and does not stop the others', async () => {
    const fp = make();
    const r = await fp.check(['missing-3', 'dark-1']);
    expect(r.unreadable).toHaveLength(1);
    expect(r.unreadable[0].folder).toBe('missing-3');
    expect(r.recorded).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });

  it('a damaged record is kept aside and everything is recorded again, quietly', async () => {
    fs.writeFileSync(recordFile, '{not json');
    const r = await make().check(['dark-1']);
    expect(r.changed).toEqual([]);
    expect(r.recorded).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });

  it('needs its folder, record file and version', () => {
    expect(() => createExtensionFingerprints({ extensionsDir: extDir })).toThrow();
  });
});

describe('wiring', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  it('every install and update goes through the recording hook, and the look runs after start-up', () => {
    const main = read('src', 'main.js');
    expect(main).toMatch(/_extFingerprintAfter\(await _activateInstalledFolder\(destFolder, copyToUpdate, opts\.match\)\)/);
    expect(main).toMatch(/_extFingerprintAfter\(await _activateInstalledFolder\(destFolder\)\)/);
    expect(main).toMatch(/_extFingerprintLook\(\)\.catch/);
  });
  it('the inbox button uses the existing on/off path and never removes anything', () => {
    const inbox = read('src', 'renderer', 'js', 'attention-inbox.js');
    const block = inbox.slice(inbox.indexOf("AttentionInbox.handle('extension-changed'"), inbox.indexOf("AttentionInbox.handle('extensions-state'"));
    expect(block).toMatch(/extensionsSetEnabled\(row\.sub, false\)/);
    expect(block).not.toMatch(/uninstall|remove/i);
  });
});
