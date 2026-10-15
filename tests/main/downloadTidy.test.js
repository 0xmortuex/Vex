// Tidy up the downloads folder (src/main/download-tidy.js). Every test works in
// its own temp directory; nothing here ever points at a real Downloads folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createDownloadTidy } = createRequire(import.meta.url)('../../src/main/download-tidy.js');

const DAY = 24 * 3600 * 1000;
let root, dir, logFile;

function put(name, { ageDays = 30, body = 'x' } = {}) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  const t = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(p, t, t);
  return p;
}
function tidy(extra = {}) { return createDownloadTidy({ fs, logFile, ...extra }); }
const ls = (d = dir) => fs.readdirSync(d).sort();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-tidy-'));
  dir = path.join(root, 'dl');
  fs.mkdirSync(dir);
  logFile = path.join(root, 'log.json');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('plan', () => {
  it('changes nothing and proposes Type/year-month', () => {
    put('a.pdf'); put('b.png'); put('c.zip'); put('d.weird');
    const before = ls();
    const p = tidy().plan(dir, { minAgeDays: 7 });
    expect(ls()).toEqual(before);
    expect(p.moves.map(m => m.type).sort()).toEqual(['Archives', 'Documents', 'Images', 'Other']);
    expect(p.moves.every(m => /^[A-Za-z]+\/\d{4}-\d{2}$/.test(m.folder))).toBe(true);
  });
  it('leaves fresh files, in-progress downloads, hidden files and folders alone', () => {
    put('fresh.pdf', { ageDays: 1 });
    put('big.crdownload'); put('.hidden.pdf'); put('desktop.ini');
    fs.mkdirSync(path.join(dir, 'Projects'));
    const p = tidy().plan(dir, { minAgeDays: 7 });
    expect(p.moves).toEqual([]);
    expect(p.skipped.tooNew).toBe(1);
    expect(p.skipped.inProgress).toBe(1);
  });
  it('does not look inside subfolders', () => {
    fs.mkdirSync(path.join(dir, 'Sub'));
    fs.writeFileSync(path.join(dir, 'Sub', 'deep.pdf'), 'x');
    expect(tidy().plan(dir, { minAgeDays: 0 }).moves).toEqual([]);
  });
  it('refuses a relative path or a bad age', () => {
    expect(() => tidy().plan('dl')).toThrow(/full path/);
    expect(() => tidy().plan(dir, { minAgeDays: -1 })).toThrow(/age/);
  });
});

describe('apply and undo', () => {
  it('moves by rename, keeps the bytes, and undo puts everything back', () => {
    put('a.pdf', { body: 'AAA' }); put('b.png', { body: 'BBB' });
    const t = tidy();
    const p = t.plan(dir, { minAgeDays: 7 });
    const r = t.apply(p.id);
    expect(r.moved).toBe(2);
    expect(r.failed).toEqual([]);
    expect(ls()).toEqual(['Documents', 'Images']);
    const month = p.moves.find(m => m.name === 'a.pdf').folder;
    expect(fs.readFileSync(path.join(dir, month, 'a.pdf'), 'utf8')).toBe('AAA');

    const u = t.undo();
    expect(u.restored).toBe(2);
    expect(u.left).toEqual([]);
    expect(ls()).toEqual(['a.pdf', 'b.png']);          // the folders it made are gone again
    expect(fs.readFileSync(path.join(dir, 'b.png'), 'utf8')).toBe('BBB');
    expect(t.history()[0].undone).toBe(true);
  });
  it('is a rename: the modified time survives', () => {
    const p0 = put('a.pdf', { ageDays: 40 });
    const m0 = fs.statSync(p0).mtimeMs;
    const t = tidy();
    const plan = t.plan(dir, { minAgeDays: 7 });
    t.apply(plan.id);
    expect(fs.statSync(path.join(dir, plan.moves[0].folder, 'a.pdf')).mtimeMs).toBe(m0);
  });
  it('never overwrites a file that is already at the destination', () => {
    const t = tidy();
    put('a.pdf', { body: 'new' });
    const plan = t.plan(dir, { minAgeDays: 7 });
    const dest = path.join(dir, plan.moves[0].folder);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'a.pdf'), 'old');
    t.apply(plan.id);
    expect(fs.readFileSync(path.join(dest, 'a.pdf'), 'utf8')).toBe('old');
    expect(fs.readFileSync(path.join(dest, 'a (1).pdf'), 'utf8')).toBe('new');
  });
  it('a preview can be applied once, and an unknown id is refused', () => {
    put('a.pdf');
    const t = tidy();
    const p = t.plan(dir, { minAgeDays: 7 });
    t.apply(p.id);
    expect(() => t.apply(p.id)).toThrow(/expired/);
    expect(() => t.apply('../../etc')).toThrow(/expired/);
  });
  it('reports a file that vanished between preview and apply, and moves the rest', () => {
    const gone = put('a.pdf'); put('b.pdf');
    const t = tidy();
    const p = t.plan(dir, { minAgeDays: 7 });
    fs.rmSync(gone);
    const r = t.apply(p.id);
    expect(r.moved).toBe(1);
    expect(r.failed.map(f => f.name)).toEqual(['a.pdf']);
  });
  it('undo leaves a file whose old name is taken, and says so', () => {
    put('a.pdf', { body: 'orig' });
    const t = tidy();
    const p = t.plan(dir, { minAgeDays: 7 });
    t.apply(p.id);
    fs.writeFileSync(path.join(dir, 'a.pdf'), 'someone else');
    const u = t.undo();
    expect(u.restored).toBe(0);
    expect(u.left[0].error).toMatch(/old name/);
    expect(fs.readFileSync(path.join(dir, 'a.pdf'), 'utf8')).toBe('someone else');
    expect(fs.existsSync(path.join(dir, p.moves[0].folder, 'a.pdf'))).toBe(true);
  });
  it('undo does not remove a folder that still holds a file', () => {
    put('a.pdf');
    const t = tidy();
    const p = t.plan(dir, { minAgeDays: 7 });
    t.apply(p.id);
    const month = path.join(dir, p.moves[0].folder);
    fs.writeFileSync(path.join(month, 'mine.txt'), 'keep');
    t.undo();
    expect(fs.existsSync(path.join(month, 'mine.txt'))).toBe(true);
  });
  it('tells the caller about each move so Open keeps working', () => {
    put('a.pdf');
    const seen = [];
    const t = tidy({ onMoved: (from, to) => seen.push([path.basename(from), path.basename(to)]) });
    t.apply(t.plan(dir, { minAgeDays: 7 }).id);
    expect(seen).toEqual([['a.pdf', 'a.pdf']]);
  });
  it('says there is nothing to undo on a fresh profile', () => {
    expect(() => tidy().undo()).toThrow(/nothing to undo/);
  });
});
