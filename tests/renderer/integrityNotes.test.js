// @vitest-environment jsdom
//
// The Attention Inbox rows for "what changed since the last launch" (js/integrity-notes.js):
// the words for each kind of change main reports, that nothing is written when nothing
// changed, and that a failing report goes to the problems list instead of the person.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const fresh = (rel) => { const f = require.resolve(rel); delete require.cache[f]; return require(f); };
let N, suggested;
beforeEach(() => {
  suggested = [];
  globalThis.VexAttention = { suggest: vi.fn((row) => { suggested.push(row); return true; }) };
  window.vex = { integrity: { report: vi.fn(async () => ({ ok: true, notes: [] })) } };
  window.VexProblems = { note: vi.fn() };
  N = fresh('../../src/renderer/js/integrity-notes.js');
});

describe('rows', () => {
  const cases = [
    [{ id: 'exe' }, 'Vex.exe changed since the last update'],
    [{ id: 'asar' }, 'Vex’s app code changed since the last update'],
    [{ id: 'dll', count: 2 }, 'A library next to Vex.exe changed since the last update'],
    [{ id: 'shortcut', where: 'desktop' }, 'The Vex desktop shortcut opens something different'],
    [{ id: 'shortcut', where: 'start-menu' }, 'The Vex Start menu shortcut opens something different'],
    [{ id: 'config', name: 'site-rules' }, 'Site rules changed outside Vex'],
    [{ id: 'config', name: 'permissions' }, 'Site permissions changed outside Vex'],
    [{ id: 'config', name: 'session-routing' }, 'Site containers changed outside Vex'],
    [{ id: 'config', name: 'extensions' }, 'The extension list changed outside Vex'],
    [{ id: 'feed-unsigned' }, 'Updates are not signature-checked yet'],
  ];
  it.each(cases)('%j reads "%s", fits the Inbox, and every program-file row owns up to the limit', (note, title) => {
    const row = N.rowFor(note);
    expect(row.title).toBe(title);
    expect(row.body.length).toBeLessThanOrEqual(300);
    expect(row.title.length).toBeLessThanOrEqual(140);
    if (note.id !== 'feed-unsigned') expect(row.body).toMatch(/only catches accidents and clumsy changes/);
  });
  it('ignores a kind it does not know, and an unknown configuration name', () => {
    expect(N.rowFor({ id: 'something-new' })).toBeNull();
    expect(N.rowFor({ id: 'config', name: 'vault' })).toBeNull();
    expect(N.rowFor(null)).toBeNull();
  });
  it('gives each kind its own row id so one change does not hide another', () => {
    const idsOf = cases.map(([n]) => N.rowFor(n).id);
    expect(new Set(idsOf).size).toBe(idsOf.length);
  });
});

describe('run', () => {
  it('writes nothing when nothing changed', async () => {
    expect(await N.run()).toBe(0);
    expect(suggested).toEqual([]);
  });
  it('suggests one row per change, under one feature the person can mute', async () => {
    window.vex.integrity.report.mockResolvedValue({ ok: true, notes: [{ id: 'exe' }, { id: 'config', name: 'site-rules' }, { id: 'weird' }] });
    expect(await N.run()).toBe(2);
    expect(suggested.map(r => r.feature)).toEqual(['integrity-report', 'integrity-report']);
    expect(suggested.map(r => r.id)).toEqual(['exe', 'config:site-rules']);
  });
  it('throws a failing report so the loader can note it', async () => {
    window.vex.integrity.report.mockResolvedValue({ ok: false, error: 'disk' });
    await expect(N.run()).rejects.toThrow('disk');
  });
  it('is a quiet no-op where the bridge does not exist (a private window, a test)', async () => {
    delete window.vex;
    expect(await N.run()).toBe(0);
  });
});

describe('wiring', () => {
  const root = path.join(__dirname, '..', '..', 'src');
  it('is a late module, not a start-up script', () => {
    expect(fs.readFileSync(path.join(root, 'renderer/js/lazy-boot.js'), 'utf8')).toMatch(/js\/integrity-notes\.js/);
    expect(fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8')).not.toMatch(/integrity-notes/);
  });
  it('has its IPC contract: schema, preload bridge, private-window block, main-window guard', () => {
    expect(fs.readFileSync(path.join(root, 'main/ipc-schemas.js'), 'utf8')).toMatch(/define\('integrity:report', \[\]\)/);
    expect(fs.readFileSync(path.join(root, 'preload.js'), 'utf8')).toMatch(/invoke\('integrity:report'\)/);
    expect(fs.readFileSync(path.join(root, 'main/ipc-policy.js'), 'utf8')).toMatch(/integrity:/);
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const at = main.indexOf("ipcMain.handle('integrity:report'");
    expect(at).toBeGreaterThan(0);
    expect(main.slice(at, at + 200)).toMatch(/_healthFromMainWindow\(event\)/);
  });
});
