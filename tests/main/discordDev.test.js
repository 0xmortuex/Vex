// Vencord dev reload and the Discord console tray (src/main/discord-dev.js), against temporary folders and
// stand-in webContents. Nothing outside the temp folder is touched; Vex's profile folder is never used.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createDiscordDev, MAX_LINES, TRAY_MS } = require('../../src/main/discord-dev');

let root, repo, profile, ext, calls, panels, t;
const BIG = 'x'.repeat(2048);

function build({ pkgName = 'vencord', dist = 'dist', file = 'browser.js', body = '//' + BIG } = {}) {
  const r = path.join(root, 'checkout-' + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(path.join(r, dist), { recursive: true });
  if (pkgName != null) fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: pkgName, version: '1.2.3' }));
  const f = path.join(r, dist, file);
  fs.writeFileSync(f, body);
  return { r, f };
}

function make(extra = {}) {
  return createDiscordDev({
    fs, path, crypto, protectedDir: profile, now: () => t,
    installed: () => ({ path: ext, folder: 'vencord-1.0.0' }),
    reloadExtension: async (d) => { calls.push(['ext', d]); },
    reloadPanel: () => { calls.push(['panel']); return 2; },
    panelContents: () => panels,
    redact: (s, max) => String(s).replace(/Bearer \S+/g, 'Bearer [redacted]').slice(0, max),
    ...extra,
  });
}

function fakeContents() {
  const handlers = new Map();
  return { on: (ev, fn) => { handlers.set(ev, fn); }, removeListener: (ev, fn) => { if (handlers.get(ev) === fn) handlers.delete(ev); }, isDestroyed: () => false, emit: (...a) => handlers.get('console-message')(...a), handlers };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-discorddev-'));
  profile = path.join(root, 'profile');
  ext = path.join(profile, 'extensions', 'vencord-1.0.0');
  fs.mkdirSync(path.join(ext, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ext, 'manifest.json'), '{"manifest_version":3,"name":"Vencord","version":"1.0.0"}');
  fs.writeFileSync(path.join(ext, 'dist', 'Vencord.js'), 'ORIGINAL');
  calls = []; panels = []; t = 1000;
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('only your own local build is accepted', () => {
  it('takes the browser.js of a checkout whose package.json is vencord (or equicord)', () => {
    const { f } = build();
    const d = make();
    const g = d.grant(f);
    expect(g).toMatchObject({ name: 'vencord', version: '1.2.3', bytes: 2050 });
    expect(g.sha256).toBe(crypto.createHash('sha256').update('//' + BIG).digest('hex'));
    expect(make().inspect(build({ pkgName: 'Equicord' }).f).name).toBe('equicord');
  });
  it('refuses another name, a wrong folder, a missing package.json, a tiny or huge file and anything in the profile', () => {
    const d = make();
    expect(() => d.grant(build({ file: 'other.js' }).f)).toThrow(/browser\.js/);
    expect(() => d.grant(build({ dist: 'out' }).f)).toThrow(/called dist/);
    expect(() => d.grant(build({ pkgName: 'left-pad' }).f)).toThrow(/not your Vencord checkout/);
    expect(() => d.grant(build({ pkgName: null }).f)).toThrow(/package\.json/);
    expect(() => d.grant(build({ body: 'tiny' }).f)).toThrow(/between 1 KB/);
    const inProfile = path.join(profile, 'dist');
    fs.mkdirSync(inProfile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'package.json'), '{"name":"vencord"}');
    fs.writeFileSync(path.join(inProfile, 'browser.js'), '//' + BIG);
    expect(() => d.grant(path.join(inProfile, 'browser.js'))).toThrow(/profile folder/);
    expect(() => d.grant('')).toThrow(/no file/);
    expect(() => d.grant(path.join(root, 'nope', 'browser.js'))).toThrow(/could not be found/);
  });
});

describe('reload and put back', () => {
  it('needs a picked file, then replaces the installed bundle, keeps the original, reloads the extension and the panel', async () => {
    const d = make();
    await expect(d.reload()).rejects.toThrow(/Pick your browser\.js/);
    const { f } = build({ body: '//NEW' + BIG });
    d.grant(f);
    const r = await d.reload();
    expect(r).toMatchObject({ ok: true, folder: 'vencord-1.0.0', replaced: 'dist/Vencord.js', panelsReloaded: 2, styleReplaced: false });
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.js'), 'utf8')).toContain('//NEW');
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.js.vex-original'), 'utf8')).toBe('ORIGINAL');
    expect(calls).toEqual([['ext', ext], ['panel']]);
    // A second reload does not overwrite the kept original with the first replacement.
    fs.writeFileSync(f, '//SECOND' + BIG);
    await d.reload();
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.js.vex-original'), 'utf8')).toBe('ORIGINAL');
    expect(d.status().replaced).toBe(true);
    const back = await d.restore();
    expect(back.ok).toBe(true);
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.js'), 'utf8')).toBe('ORIGINAL');
  });
  it('checks the file again at the moment of the reload (it may have been swapped)', async () => {
    const { f, r } = build();
    const d = make();
    d.grant(f);
    fs.writeFileSync(path.join(r, 'package.json'), '{"name":"something-else"}');
    await expect(d.reload()).rejects.toThrow(/not your Vencord checkout/);
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.js'), 'utf8')).toBe('ORIGINAL');
    expect(calls).toEqual([]);
  });
  it('copies the stylesheet too when the build has one, and says when no Vencord is installed or the bundle is unknown', async () => {
    const { f, r } = build();
    fs.writeFileSync(path.join(r, 'dist', 'browser.css'), 'body{}');
    fs.writeFileSync(path.join(ext, 'dist', 'Vencord.css'), 'OLDCSS');
    const d = make();
    d.grant(f);
    expect((await d.reload()).styleReplaced).toBe(true);
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.css'), 'utf8')).toBe('body{}');
    await d.restore();
    expect(fs.readFileSync(path.join(ext, 'dist', 'Vencord.css'), 'utf8')).toBe('OLDCSS');
    const none = make({ installed: () => null });
    none.grant(f);
    await expect(none.reload()).rejects.toThrow(/No Vencord build is installed/);
    fs.rmSync(path.join(ext, 'dist'), { recursive: true });
    await expect(d.reload()).rejects.toThrow(/none of/);
  });
  it('has nothing to put back before a reload', async () => {
    await expect(make().restore()).rejects.toThrow(/no original/);
  });
  it('a failed extension reload is raised, not swallowed', async () => {
    const { f } = build();
    const d = make({ reloadExtension: async () => { throw new Error('the extension would not load'); } });
    d.grant(f);
    await expect(d.reload()).rejects.toThrow(/would not load/);
  });
});

describe('console tray', () => {
  it('keeps redacted lines of the Discord panel in memory only, and stops by itself', () => {
    const c = fakeContents();
    panels = [c];
    const d = make();
    expect(d.trayList().lines).toEqual([]);
    d.trayStart();
    c.emit({ level: 'warning', message: 'auth Bearer abc.def.ghi failed', lineNumber: 12, sourceId: 'https://discord.com/x.js' });
    c.emit({}, 3, 'plain error', 5, 'file.js');
    const l = d.trayList();
    expect(l.lines.map(x => x.text)).toEqual(['auth Bearer [redacted] failed', 'plain error']);
    expect(l.lines.map(x => x.level)).toEqual(['warning', 'error']);
    expect(JSON.stringify(l)).not.toContain('abc.def.ghi');
    expect(d.trayList({ level: 'error' }).lines).toHaveLength(1);
    expect(d.trayList({ since: 1 }).lines).toHaveLength(1);
    t += TRAY_MS + 1;
    expect(d.trayState().on).toBe(false);
    expect(c.handlers.size).toBe(0);
  });
  it('is bounded, can be cleared and stopped, and picks up a page that opened later', () => {
    const a = fakeContents(), b = fakeContents();
    panels = [a];
    const d = make();
    d.trayStart();
    for (let i = 0; i < MAX_LINES + 20; i++) a.emit({ level: 'info', message: 'm' + i, lineNumber: 1, sourceId: '' });
    expect(d.trayList().lines).toHaveLength(MAX_LINES);
    panels.push(b);
    d.trayList();
    expect(b.handlers.size).toBe(1);
    expect(d.trayClear().lines).toBe(0);
    d.trayStop();
    expect(a.handlers.size).toBe(0);
    expect(b.handlers.size).toBe(0);
    expect(d.trayList().state.on).toBe(false);
  });
});
