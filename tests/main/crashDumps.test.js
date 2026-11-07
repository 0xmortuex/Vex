// Audit E3: crash dumps stay on this computer. src/main/crash-dumps.js starts the reporter without any address to
// send to, lists the dumps for Health, deletes those older than 14 days, and stays out of backups and sync.
import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startLocalDumps, list, sweep, KEEP_DAYS } = require('../../src/main/crash-dumps.js');

const DAY = 24 * 3600 * 1000;
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dumps-')); });
function dump(sub, name, ageDays, size = 2048, now = Date.now()) {
  fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const f = path.join(dir, sub, name);
  fs.writeFileSync(f, Buffer.alloc(size));
  const t = new Date(now - ageDays * DAY);
  fs.utimesSync(f, t, t);
  return f;
}

describe('starting the reporter', () => {
  it('keeps dumps in <profile>/crashes and uploads nothing', () => {
    const calls = {};
    const app = { setPath: (k, v) => { calls.path = [k, v]; } };
    const crashReporter = { start: (o) => { calls.opts = o; }, getUploadToServer: () => false };
    const r = startLocalDumps({ app, crashReporter, userData: 'C:\\profile' });
    expect(calls.path).toEqual(['crashDumps', path.join('C:\\profile', 'crashes')]);
    expect(calls.opts).toEqual({ uploadToServer: false, compress: true });
    expect(calls.opts.submitURL).toBeUndefined();
    expect(r.dir).toBe(path.join('C:\\profile', 'crashes'));
  });
  it('refuses to run if the reporter says it would upload', () => {
    const crashReporter = { start() {}, getUploadToServer: () => true };
    expect(() => startLocalDumps({ app: { setPath() {} }, crashReporter, userData: 'x' })).toThrow(/uploaded/);
  });
});

describe('listing for Health', () => {
  it('lists dumps newest first with size and time, and nothing else in the folder', () => {
    dump('reports', 'a.dmp', 3); dump('reports', 'b.dmp', 1, 4096); dump('pending', 'c.dmp', 2);
    fs.writeFileSync(path.join(dir, 'metadata'), 'x'); fs.writeFileSync(path.join(dir, 'reports', 'notes.txt'), 'x');
    const r = list({ dir, fs });
    expect(r.files.map(f => f.name)).toEqual(['b.dmp', 'c.dmp', 'a.dmp']);
    expect(r.files[0].bytes).toBe(4096);
    expect(r.keepDays).toBe(14);
    expect(Object.keys(r.files[0]).sort()).toEqual(['at', 'bytes', 'name']);       // no full path leaks into the list
  });
  it('an empty or missing folder is an empty list, not an error', () => {
    expect(list({ dir: path.join(dir, 'nope'), fs })).toMatchObject({ files: [] });
    expect(list({ dir: path.join(dir, 'nope'), fs }).error).toBeUndefined();
  });
  it('an unreadable folder is reported', () => {
    const bad = { ...fs, readdirSync: () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; } };
    expect(list({ dir, fs: bad }).error).toMatch(/denied/);
  });
});

describe('the 14-day sweep', () => {
  it('deletes dumps older than 14 days and keeps the rest', () => {
    const now = Date.now();
    const old = dump('reports', 'old.dmp', KEEP_DAYS + 1, 10, now);
    const fresh = dump('reports', 'fresh.dmp', 13, 10, now);
    const oldPending = dump('pending', 'oldp.dmp', 30, 10, now);
    const r = sweep({ dir, fs, now });
    expect(r).toMatchObject({ deleted: 2, kept: 1, failed: [] });
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(oldPending)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
  it('touches nothing but .dmp files in the dump folders', () => {
    const now = Date.now();
    const keepers = [path.join(dir, 'metadata'), path.join(dir, 'settings.dat'), path.join(dir, 'reports', 'old.txt'), path.join(dir, 'other', 'old.dmp')];
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
    const t = new Date(now - 90 * DAY);
    for (const f of keepers) { fs.writeFileSync(f, 'x'); fs.utimesSync(f, t, t); }
    fs.mkdirSync(path.join(dir, 'reports', 'folder.dmp'));
    expect(sweep({ dir, fs, now })).toMatchObject({ deleted: 0 });
    for (const f of keepers) expect(fs.existsSync(f), f).toBe(true);
    expect(fs.existsSync(path.join(dir, 'reports', 'folder.dmp'))).toBe(true);
  });
  it('a file that cannot be deleted is reported and the others still go', () => {
    const now = Date.now();
    const a = dump('reports', 'a.dmp', 40, 10, now);
    const b = dump('reports', 'b.dmp', 40, 10, now);
    const msgs = [];
    const flaky = { ...fs, unlinkSync: (f) => { if (f === a) throw new Error('in use'); return fs.unlinkSync(f); } };
    const r = sweep({ dir, fs: flaky, now, log: (m) => msgs.push(m) });
    expect(r.deleted).toBe(1);
    expect(r.failed).toEqual([{ name: 'a.dmp', error: 'in use' }]);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(false);
    expect(msgs.join()).toMatch(/could not delete a\.dmp/);
  });
});

describe('kept out of backups and sync, and wired into main', () => {
  const root = path.join(__dirname, '../../src');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  it('no backup, sync or profile-encryption code names the crashes folder or dumps', () => {
    const files = ['main/update-backups.js', 'main/profile-crypt.js', 'main/sync-secrets.js'];
    for (const f of files) expect(read(f), f).not.toMatch(/crashes|crash-dumps|\.dmp|Crashpad/);
    const sync = fs.readdirSync(path.join(root, 'renderer/js')).filter(n => /^sync.*\.js$|^vex-backup.*\.js$|^backup.*\.js$/.test(n));
    for (const f of sync) expect(read('renderer/js/' + f), f).not.toMatch(/crash-dumps|crashDumps|\.dmp/);
  });
  it('the profile-encryption file list is top-level files only, so a crashes subfolder is not in it', () => {
    const { profileFiles } = require('../../src/main/profile-crypt.js');
    fs.mkdirSync(path.join(dir, 'crashes', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'crashes', 'reports', 'x.dmp'), 'x');
    fs.writeFileSync(path.join(dir, 'vex-persist.json'), '{}');
    const names = profileFiles(dir, fs);
    expect(names.some(n => /crashes|\.dmp/.test(n))).toBe(false);
  });
  it('main starts the reporter before ready, lists in diagnostics and sweeps once after start', () => {
    const main = read('main.js');
    expect(main.indexOf('_crashDumps.startLocalDumps')).toBeLessThan(main.indexOf("_diagMark('app-ready')"));
    expect(main).toMatch(/crashDumps: _crashDumps\.list\(\{ dir: _crashDumpDir, fs \}\)/);
    expect(main).toMatch(/_crashDumps\.sweep\(\{ dir: _crashDumpDir/);
  });
});

describe('the problem report', () => {
  it('lists names and sizes only when asked, once, and never the files', () => {
    const { VexReport } = require('../../src/renderer/js/report-problem.js');
    const d = { crashDumps: { dir: 'C:\\Users\\me\\AppData\\Roaming\\Vex\\crashes', files: [{ name: 'a.dmp', bytes: 314544, at: 1700000000000 }] } };
    expect(VexReport.dumpLines(d)).toEqual([]);                      // not by itself
    VexReport.setIncludeDumps(true);
    const lines = VexReport.dumpLines(d).map(x => x.text);
    expect(lines[0]).toMatch(/not attached: a\.dmp, 307 KB/);
    expect(lines.join('\n')).toMatch(/contain memory/);
    expect(VexReport.scrub(lines[1])).toMatch(/%USERPROFILE%/);       // the folder path is scrubbed like any other
    VexReport.setIncludeDumps(false);
    expect(VexReport.dumpLines(d)).toEqual([]);
  });
});
