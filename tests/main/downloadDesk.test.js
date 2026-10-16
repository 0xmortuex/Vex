// T3-119 media names, T3-032 release assets, T3-073 the mod desk (src/main/download-desk.js).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { validateZip } = require('../../src/main/archive-security');
const D = require('../../src/main/download-desk.js');

describe('mediaName', () => {
  const date = new Date(2026, 9, 16);
  it('names a counter-like image after the site, the page title and the date', () => {
    expect(D.mediaName({ filename: '358216048_1234567890123456_n.jpg', url: 'https://scontent.cdninstagram.com/v/x', pageUrl: 'https://www.instagram.com/p/abc/', pageTitle: 'Sam on Instagram: "Sunset"', date }))
      .toBe('instagram - Sam on Instagram "Sunset" - 2026-10-16.jpg');
  });
  it('uses the end of the old name when the page has no title', () => {
    expect(D.mediaName({ filename: '9f86d081884c7d659a2feaa0c55ad015.mp4', url: 'https://video.example.org/a', pageUrl: 'https://example.org/v', pageTitle: '', date })).toBe('example - 2026-10-16 - ad015.mp4');
  });
  it('leaves a name that already says something, a non-media file and a generic word handled', () => {
    expect(D.mediaName({ filename: 'holiday-beach.jpg', url: 'https://a.test/x', pageUrl: 'https://a.test', pageTitle: 'T', date })).toBeNull();
    expect(D.mediaName({ filename: '123456789012.pdf', url: 'https://a.test/x', pageUrl: 'https://a.test', pageTitle: 'T', date })).toBeNull();
    expect(D.mediaName({ filename: 'download.png', url: 'https://a.test/x', pageUrl: 'https://a.test', pageTitle: 'Chart', date })).toBe('a - Chart - 2026-10-16.png');
  });
  it('strips characters Windows refuses and bounds the length', () => {
    const n = D.mediaName({ filename: '123456789012345.jpg', url: 'https://a.test/x', pageUrl: 'https://a.test', pageTitle: 'a/b\\c:d*e?"f<g>h|' + 'x'.repeat(300), date });
    expect(n).not.toMatch(/[\\/:*?"<>|]/);
    expect(n.length).toBeLessThanOrEqual(125);
  });
});

describe('releaseOf and the release desk', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-rel-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('recognises a GitHub release asset anywhere in the chain', () => {
    expect(D.releaseOf(['https://github.com/o/r/releases/download/v1.2.3/App%20Setup.exe', 'https://objects.githubusercontent.com/x'])).toEqual({ owner: 'o', repo: 'r', tag: 'v1.2.3', asset: 'App Setup.exe' });
    expect(D.releaseOf(['https://github.com/o/r/archive/main.zip'])).toBeNull();
    expect(D.releaseOf(['https://evil.example/github.com/o/r/releases/download/v1/a.exe'])).toBeNull();
  });

  it('gives the hash, a hash-only VirusTotal link and the older installers of the same repository', async () => {
    const old = path.join(dir, 'app-1.0.exe'), cur = path.join(dir, 'app-2.0.exe'), other = path.join(dir, 'tool.exe');
    fs.writeFileSync(old, 'old'); fs.writeFileSync(cur, 'hello'); fs.writeFileSync(other, 'x');
    let t = 1000;
    const desk = D.createReleaseDesk({ fs, file: path.join(dir, 'rel.json'), now: () => t++ });
    await desk.note(old, { owner: 'o', repo: 'r', tag: 'v1', asset: 'app-1.0.exe' });
    await desk.note(other, { owner: 'o', repo: 'other', tag: 'v9', asset: 'tool.exe' });
    await desk.note(cur, { owner: 'o', repo: 'r', tag: 'v2', asset: 'app-2.0.exe' });
    const a = await desk.assist(cur);
    expect(a.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(a.virusTotal).toBe('https://www.virustotal.com/gui/file/' + a.sha256);
    expect(a.older.map(o => o.name)).toEqual(['app-1.0.exe']);
    expect((await desk.assist(old)).older).toEqual([]);          // the older one has nothing older
  });

  it('refuses a file that was not a release download, and a missing one', async () => {
    const desk = D.createReleaseDesk({ fs, file: path.join(dir, 'rel.json') });
    await expect(desk.assist(path.join(dir, 'x.exe'))).rejects.toThrow(/not a GitHub release download/);
    await desk.note(path.join(dir, 'gone.exe'), { owner: 'o', repo: 'r', tag: 'v', asset: 'gone.exe' });
    await expect(desk.assist(path.join(dir, 'gone.exe'))).rejects.toThrow(/not there any more/);
  });
});

describe('mod metadata and the mod desk', () => {
  let dir, logFile;
  const jar = (name, files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); z.writeZip(path.join(dir, name)); };
  const desk = () => D.createModDesk({ fs, logFile, openZip: (f) => new AdmZip(f), validateZip });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-mods-'));
    logFile = path.join(dir, '..', 'vex-mods-log-' + path.basename(dir) + '.json');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(logFile, { force: true }); });

  const FABRIC = (v, mc = '>=1.20.1') => JSON.stringify({ id: 'sodium', version: v, depends: { minecraft: mc } });
  const FORGE = '[[mods]]\nmodId="jei"\nversion="${file.jarVersion}"\n[[dependencies.jei]]\nmodId="minecraft"\nversionRange="[1.19.2,1.20)"\n';

  it('reads loader, game version and mod id without running anything', () => {
    jar('a.jar', { 'fabric.mod.json': FABRIC('0.5.1', '1.20.4') });
    jar('b.jar', { 'META-INF/mods.toml': FORGE });
    jar('c.jar', { 'META-INF/neoforge.mods.toml': FORGE.replace('1.19.2,1.20', '1.21,1.22') });
    jar('d.jar', { 'quilt.mod.json': JSON.stringify({ quilt_loader: { id: 'q', version: '1', depends: [{ id: 'minecraft', versions: '>=1.20.2' }] } }) });
    const meta = (n) => D.readModMeta(new AdmZip(path.join(dir, n)), n);
    expect(meta('a.jar')).toMatchObject({ loader: 'fabric', mc: '1.20.4', modId: 'sodium', version: '0.5.1' });
    expect(meta('b.jar')).toMatchObject({ loader: 'forge', mc: '1.19.2', modId: 'jei', version: '' });
    expect(meta('c.jar')).toMatchObject({ loader: 'neoforge', mc: '1.21' });
    expect(meta('d.jar')).toMatchObject({ loader: 'quilt', mc: '1.20.2' });
  });

  it('falls back to the file name for the game version', () => {
    jar('sodium-fabric-0.5.8+mc1.20.4.jar', { 'fabric.mod.json': JSON.stringify({ id: 'sodium', version: '0.5.8' }) });
    expect(D.readModMeta(new AdmZip(path.join(dir, 'sodium-fabric-0.5.8+mc1.20.4.jar')), 'sodium-fabric-0.5.8+mc1.20.4.jar').mc).toBe('1.20.4');
  });

  it('plans folders, flags the older copy, and leaves non-mods alone', () => {
    jar('sodium-1.jar', { 'fabric.mod.json': FABRIC('0.5.1', '1.20.1') });
    jar('sodium-2.jar', { 'fabric.mod.json': FABRIC('0.5.8', '1.20.1') });
    jar('plain.jar', { 'Main.class': 'x' });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    const p = desk().plan(dir);
    const by = Object.fromEntries(p.moves.map(m => [m.name, m]));
    expect(by['sodium-2.jar']).toMatchObject({ folder: 'Minecraft mods/Fabric 1.20.1', older: false });
    expect(by['sodium-1.jar']).toMatchObject({ folder: 'Minecraft mods/Fabric 1.20.1/Older versions', older: true, newer: 'sodium-2.jar' });
    expect(p.skipped.map(s => s.name)).toEqual(['plain.jar']);
    expect(fs.existsSync(path.join(dir, 'sodium-1.jar'))).toBe(true);     // a preview moves nothing
  });

  it('moves after apply, never overwrites, and undo puts everything back and removes its folders', () => {
    jar('sodium-2.jar', { 'fabric.mod.json': FABRIC('0.5.8', '1.20.1') });
    const d = desk();
    const p = d.plan(dir);
    const r = d.apply(p.id);
    expect(r).toMatchObject({ moved: 1, failed: [] });
    expect(fs.existsSync(path.join(dir, 'Minecraft mods', 'Fabric 1.20.1', 'sodium-2.jar'))).toBe(true);
    expect(() => d.apply(p.id)).toThrow(/expired/);
    const u = d.undo();
    expect(u.restored).toBe(1);
    expect(fs.existsSync(path.join(dir, 'sodium-2.jar'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Minecraft mods'))).toBe(false);
    expect(() => d.undo()).toThrow(/nothing to undo/i);
  });

  it('reports a file that vanished between preview and apply, and skips an oversized metadata file', () => {
    jar('a.jar', { 'fabric.mod.json': FABRIC('1', '1.20.1') });
    jar('big.jar', { 'fabric.mod.json': 'x'.repeat(600 * 1024) });
    const d = desk();
    const p = d.plan(dir);
    expect(p.skipped.map(s => s.name)).toEqual(['big.jar']);
    fs.rmSync(path.join(dir, 'a.jar'));
    const r = d.apply(p.id);
    expect(r.moved).toBe(0);
    expect(r.failed).toHaveLength(1);
  });
});
