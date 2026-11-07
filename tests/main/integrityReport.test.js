// @vitest-environment node
//
// "What changed since the last launch" (src/main/integrity-report.js): real files
// in a temp folder, real SHA-256, nothing outside it. A packaged install is
// imitated by a fake program folder (Vex.exe, resources/app.asar, some .dll).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createIntegrityReport, CONFIG_FILES, BASELINE } = require('../../src/main/integrity-report.js');

let root, app, profile, lnk, log;
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// A different mtime so a same-size edit is seen as a candidate for re-hashing.
const bump = (file) => { const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000)); fs.utimesSync(file, t, t); };
const links = { target: 'C:\\Vex\\Vex.exe', args: '', cwd: 'C:\\Vex' };
const make = (over = {}) => createIntegrityReport({
  fs: over.fs || fs, userDataPath: profile, appDir: app, execPath: path.join(app, 'Vex.exe'), appVersion: '2.40.0', packaged: true,
  shortcuts: [{ id: 'start-menu', file: lnk }], readShortcut: () => links, signatureMode: () => 'on', log, ...over,
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-integrity-'));
  app = path.join(root, 'app'); profile = path.join(root, 'profile'); lnk = path.join(root, 'Vex.lnk');
  put(path.join(app, 'Vex.exe'), 'exe-bytes-v1');
  put(path.join(app, 'resources', 'app.asar'), 'asar-bytes-v1');
  put(path.join(app, 'ffmpeg.dll'), 'ffmpeg'); put(path.join(app, 'libEGL.dll'), 'egl');
  put(lnk, 'lnk');
  for (const rel of Object.values(CONFIG_FILES)) put(path.join(profile, rel), JSON.stringify({ file: rel }));
  log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const launch = async (over) => { const r = make(over); r.captureConfigs(); const out = await r.run(); return { r, out }; };
const quit = (r) => r.recordQuit();
const ids = (out) => out.notes.map(n => n.id + (n.name ? ':' + n.name : '') + (n.where ? ':' + n.where : ''));

describe('first launch and quiet launches', () => {
  it('records on the first launch and says nothing', async () => {
    const { out } = await launch();
    expect(out).toEqual({ ok: true, notes: [] });
    const b = JSON.parse(fs.readFileSync(path.join(profile, BASELINE), 'utf8'));
    expect(Object.keys(b.files).sort()).toEqual(['Vex.exe', 'ffmpeg.dll', 'libEGL.dll', 'resources/app.asar']);
    expect(b.files['Vex.exe'].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.cleanExit).toBe(false);
  });
  it('says nothing when nothing changed, and hashes nothing when size and date are unchanged', async () => {
    const first = await launch(); quit(first.r);
    const spy = vi.spyOn(fs, 'createReadStream');
    const { out } = await launch();
    expect(out.notes).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does nothing for a source/dev run', async () => {
    const r = make({ packaged: false });
    expect(await r.run()).toMatchObject({ skipped: 'not a packaged build', notes: [] });
    expect(fs.existsSync(path.join(profile, BASELINE))).toBe(false);
    expect(r.recordQuit()).toBe(false);
  });
});

describe('program files and shortcuts', () => {
  it('reports Vex.exe, app.asar and a dll that changed since the last update, without fixing anything', async () => {
    const first = await launch(); quit(first.r);
    put(path.join(app, 'Vex.exe'), 'exe-bytes-v2'); bump(path.join(app, 'Vex.exe'));
    put(path.join(app, 'resources', 'app.asar'), 'asar-bytes-XX'); bump(path.join(app, 'resources', 'app.asar'));
    put(path.join(app, 'libEGL.dll'), 'EGL'); bump(path.join(app, 'libEGL.dll'));
    const { out } = await launch();
    expect(ids(out)).toEqual(['exe', 'asar', 'dll']);
    expect(out.notes[2]).toMatchObject({ count: 1, names: ['libEGL.dll'] });
    expect(fs.readFileSync(path.join(app, 'Vex.exe'), 'utf8')).toBe('exe-bytes-v2');   // untouched
  });
  it('sees a same-size edit with a new date, but not a date-only touch', async () => {
    const first = await launch(); quit(first.r);
    bump(path.join(app, 'Vex.exe'));   // only the date moved: same content
    expect((await launch()).out.notes).toEqual([]);
    put(path.join(app, 'ffmpeg.dll'), 'ffmpag'); bump(path.join(app, 'ffmpeg.dll'));   // same length, other bytes
    expect(ids((await launch()).out)).toEqual(['dll']);
  });
  it('reports a new dll next to Vex.exe', async () => {
    const first = await launch(); quit(first.r);
    put(path.join(app, 'evil.dll'), 'x');
    expect((await launch()).out.notes[0]).toMatchObject({ id: 'dll', names: ['evil.dll'] });
  });
  it('reports a shortcut that now opens something else, once', async () => {
    const first = await launch(); quit(first.r);
    links.target = 'C:\\Temp\\evil.exe';
    try {
      const second = await launch();
      expect(ids(second.out)).toEqual(['shortcut:start-menu']);
      quit(second.r);
      expect((await launch()).out.notes).toEqual([]);   // reported once, then it is the new record
    } finally { links.target = 'C:\\Vex\\Vex.exe'; }
  });
  it('stays silent for a new version: an update replaces these files on purpose', async () => {
    const first = await launch(); quit(first.r);
    put(path.join(app, 'Vex.exe'), 'exe-bytes-v3'); put(path.join(app, 'resources', 'app.asar'), 'asar v3'); bump(path.join(app, 'Vex.exe'));
    const { out } = await launch({ appVersion: '2.41.0' });
    expect(out.notes).toEqual([]);
    const b = JSON.parse(fs.readFileSync(path.join(profile, BASELINE), 'utf8'));
    expect(b.appVersion).toBe('2.41.0');
  });
  it('skips a file over the size cap instead of hashing it', async () => {
    const { r, out } = await launch({ maxFileBytes: 5 });
    expect(out.notes).toEqual([]);
    const b = JSON.parse(fs.readFileSync(path.join(profile, BASELINE), 'utf8'));
    expect(b.files['Vex.exe']).toMatchObject({ skipped: 'too large' });
    quit(r);
    put(path.join(app, 'Vex.exe'), 'changed!!!!!'); bump(path.join(app, 'Vex.exe'));
    expect((await launch({ maxFileBytes: 5 })).out.notes).toEqual([]);
  });
  it('hashes in chunks and yields between files', async () => {
    const yieldNow = vi.fn(() => new Promise(r => setImmediate(r)));
    await launch({ yieldNow });
    expect(yieldNow.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('configuration files changed outside Vex', () => {
  it('reports a file edited while Vex was closed', async () => {
    const first = await launch(); quit(first.r);
    put(path.join(profile, 'site-rules.json'), '{"edited":"by hand"}');
    fs.rmSync(path.join(profile, 'session-routing.json'));
    const { out } = await launch();
    expect(ids(out)).toEqual(['config:site-rules', 'config:session-routing']);
    expect(out.notes[1].change).toBe('removed');
  });
  it('does not blame outside changes after a crash or kill (the last session never said goodbye)', async () => {
    await launch();   // no recordQuit
    put(path.join(profile, 'permissions.json'), '{"vex wrote this":"before the crash"}');
    expect((await launch()).out.notes).toEqual([]);
  });
  it('does not blame Vex\'s own writes of the previous session: they are recorded at quit', async () => {
    const first = await launch();
    put(path.join(profile, 'extension-installs.json'), '{"installed":["a"]}');   // Vex wrote it while running
    quit(first.r);
    expect((await launch()).out.notes).toEqual([]);
  });
  it('hashes the files at start, so a write made later in the same session is not a "change"', async () => {
    const first = await launch(); quit(first.r);
    const r = make(); r.captureConfigs();
    put(path.join(profile, 'site-rules.json'), '{"vex wrote this after start":1}');
    expect((await r.run()).notes).toEqual([]);
  });
  it('a missing file that never existed is not a change', async () => {
    fs.rmSync(path.join(profile, 'permissions.json'));
    const first = await launch(); quit(first.r);
    expect((await launch()).out.notes).toEqual([]);
  });
  it('recordQuit leaves the record alone when the check did not run this session', async () => {
    const r = make();
    expect(r.recordQuit()).toBe(false);
    expect(fs.existsSync(path.join(profile, BASELINE))).toBe(false);
  });
});

describe('the one-time note about the update feed', () => {
  it('is raised once while updates are not signature-checked, then never again', async () => {
    const a = await launch({ signatureMode: () => 'off' }); quit(a.r);
    expect(ids(a.out)).toEqual(['feed-unsigned']);
    expect((await launch({ signatureMode: () => 'off' })).out.notes).toEqual([]);
  });
  it('is not raised when a key is embedded or the mode is unknown', async () => {
    expect((await launch({ signatureMode: () => 'on' })).out.notes).toEqual([]);
    fs.rmSync(path.join(profile, BASELINE));
    expect((await launch({ signatureMode: () => 'unknown' })).out.notes).toEqual([]);
  });
});

describe('failing safe', () => {
  it('a damaged record is replaced, not fatal, and says nothing', async () => {
    put(path.join(profile, BASELINE), '{ not json');
    const { out } = await launch();
    expect(out).toEqual({ ok: true, notes: [] });
    expect(log.warn).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(profile, BASELINE), 'utf8')).v).toBe(1);
  });
  it('a record that cannot be written is logged and the report still answers', async () => {
    const { out } = await launch({ writeFile: () => { throw new Error('EPERM'); } });
    expect(out.ok).toBe(true);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/EPERM/);
  });
  it('a file that cannot be read turns the answer into an error, never a throw', async () => {
    const broken = { ...fs, statSync: (f) => { if (String(f).endsWith('Vex.exe')) throw Object.assign(new Error('boom'), { code: 'EIO' }); return fs.statSync(f); } };
    const { out } = await launch({ fs: broken });
    expect(out).toMatchObject({ ok: false, notes: [] });
    expect(log.error).toHaveBeenCalled();
  });
  it('answers every caller with the same single run', async () => {
    const r = make(); r.captureConfigs();
    const [a, b] = await Promise.all([r.run(), r.run()]);
    expect(a).toBe(b);
  });
});
