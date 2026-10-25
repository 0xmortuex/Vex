// Vex's own folder browser, the main process side (src/main/folder-viewer.js, ipc-policy.js, ipc-schemas.js): how a folder is caught, what
// a page may ask, and what a web page can NOT do. Real folders in the OS temp directory; the shell, the clipboard and the pictures are
// stand-ins that record what they were asked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const m = require('../../src/main/folder-viewer.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS, installIpcPolicy } = require('../../src/main/ipc-policy.js');

const RENDERER = path.resolve(__dirname, '../../src/renderer');
const viewerUrl = (dir) => m.viewerUrl(m.folderAddress(dir));

let tmp;
let cleanups = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-')); cleanups = []; });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); for (const c of cleanups) c(); });

function fakeContents(over = {}) {
  const wc = new EventEmitter();
  Object.assign(wc, { id: 7, isDestroyed: () => false, getType: () => 'webview', session: {}, partition: 'persist:main', url: 'https://example.com/', getURL() { return this.url; }, startDrag(o) { this.dragged = o; }, loadURL(u) { this.loaded = u; return Promise.resolve(); } }, over);
  return wc;
}
function makeViewer(extra = {}) {
  return m.createFolderViewer({ rendererDir: RENDERER, owner: () => ({}), partitionOf: (wc) => wc.partition, look: () => ({ theme: 'oxford', guiStyle: 'firefox', lang: 'tr' }), ...extra });
}
const ask = (viewer, details) => new Promise((resolve) => { const taken = viewer.take(details, (answer) => resolve(answer)); if (!taken) resolve('not taken'); });

describe('the addresses', () => {
  it('turns a folder address into the viewer and back', () => {
    const u = 'file:///C:/Users/Ay%C5%9Fe/';
    expect(m.parseViewerUrl(m.viewerUrl(u))).toEqual({ fileUrl: u });
    expect(m.parseViewerUrl('vex-files://browse/m/abc')).toBe(null);
    expect(m.parseViewerUrl('vex-files://browse/?u=https%3A%2F%2Fevil.test%2F')).toBe(null);
    expect(m.parseViewerUrl('vex-files://elsewhere/?u=file%3A%2F%2F%2F')).toBe(null);
    expect(m.parseViewerUrl('https://example.com/?u=file%3A%2F%2F%2F')).toBe(null);
  });
  it('reads a file: address as a Windows path', () => {
    expect(m.targetOfFileUrl('file:///')).toEqual({ kind: 'thisPc' });
    expect(m.targetOfFileUrl('file:///c:/Users/Ay%C5%9Fe/')).toEqual({ kind: 'path', path: 'C:\\Users\\Ayşe' });
    expect(m.targetOfFileUrl('file:///C:/')).toEqual({ kind: 'path', path: 'C:\\' });
    expect(m.targetOfFileUrl('file:///C:')).toEqual({ kind: 'path', path: 'C:\\' });
    expect(m.targetOfFileUrl('file:///C:/a%20b/c%23d')).toEqual({ kind: 'path', path: 'C:\\a b\\c#d' });
    expect(m.targetOfFileUrl('file:///C:/100%/x')).toEqual({ kind: 'path', path: 'C:\\100%\\x' });   // a lone % is part of the name
    expect(m.targetOfFileUrl('file://server/share/dir/')).toEqual({ kind: 'path', path: '\\\\server\\share\\dir' });
    expect(m.targetOfFileUrl('file://server/share/')).toEqual({ kind: 'path', path: '\\\\server\\share\\' });
    expect(m.targetOfFileUrl('file://localhost/C:/x/')).toEqual({ kind: 'path', path: 'C:\\x' });
    expect(m.targetOfFileUrl('file:///etc/passwd')).toBe(null);
    expect(m.targetOfFileUrl('https://example.com/')).toBe(null);
    expect(m.targetOfFileUrl('file:///C:/a%00b')).toBe(null);
    expect(m.targetOfFileUrl('file:///C:/a%2Fb')).toBe(null);          // an escaped slash would make a separator inside a name
    expect(m.targetOfFileUrl('file:///C:/a%5Cb')).toBe(null);
    expect(m.targetOfFileUrl('file:///C:/a/../../b')).toEqual({ kind: 'path', path: 'C:\\b' });   // the URL parser has already folded the dots
  });
  it('writes a path back as the address a tab shows, always closed with a slash', () => {
    expect(m.folderAddress('C:\\Users\\Ayşe\\')).toBe('file:///C:/Users/Ay%C5%9Fe/');
    expect(m.folderAddress('C:\\')).toBe('file:///C:/');
    expect(m.folderAddress('\\\\srv\\share\\x y')).toBe('file://srv/share/x%20y/');
    expect(m.targetOfFileUrl(m.folderAddress('C:\\a#b\\100%\\Ç ğ'))).toEqual({ kind: 'path', path: 'C:\\a#b\\100%\\Ç ğ' });
  });
});

describe('names: a page can name a leaf of the folder and nothing else', () => {
  it('accepts the names Windows has, in every alphabet', () => {
    for (const n of ['a.txt', 'Çalışma ĞÜŞİÖç.txt', '.gitignore', 'name with spaces', 'x'.repeat(255), '日本語.txt', 'a.b.c']) expect(m.existingName(n)).toBe(n);
  });
  it('refuses a separator, a drive, a stream, a dot-dot and an empty name', () => {
    for (const n of ['', '.', '..', 'a/b', 'a\\b', 'C:', 'C:x', 'file.txt:stream', '..\\x', '../x', 'x\u0000y', 'a'.repeat(256), null, 3, {}]) expect(() => m.existingName(n), String(n)).toThrow();
  });
  it('never leaves the folder', () => {
    const dir = 'C:\\Users\\me\\Docs\\';
    expect(m.inside(dir, 'a.txt')).toBe('C:\\Users\\me\\Docs\\a.txt');
    expect(m.inside('C:\\', 'a.txt')).toBe('C:\\a.txt');
    expect(m.inside('\\\\srv\\share\\', 'a.txt')).toBe('\\\\srv\\share\\a.txt');
    for (const n of ['..', '..\\..\\x', 'a\\..\\..\\b', 'C:\\Windows']) expect(() => m.inside(dir, n)).toThrow();
  });
  it('checks a new name as Windows would', () => {
    expect(m.newName('  Yeni klasör ')).toBe('Yeni klasör');
    for (const n of ['', '   ', 'a<b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'a/b', 'a\\b', 'name.', 'CON', 'con.txt', 'NUL', 'COM1', 'lpt9.log', '.', '..', 'x'.repeat(256), 'tab\tin']) expect(() => m.newName(n), JSON.stringify(n)).toThrow();
    expect(m.newName('name ')).toBe('name');                // the space at the end is only the person's typing
    expect(m.newName('console.txt')).toBe('console.txt');
    expect(m.newName('com10')).toBe('com10');
  });
  it('turns failures into codes the page words', () => {
    expect(m.codeOf({ code: 'EACCES' })).toBe('denied');
    expect(m.codeOf({ code: 'EPERM' })).toBe('denied');
    expect(m.codeOf({ code: 'ENOENT' })).toBe('missing');
    expect(m.codeOf({ code: 'VEX_TIMEOUT' })).toBe('timeout');
    expect(m.codeOf({ code: 'ENXIO' })).toBe('gone');
    expect(m.codeOf({ code: 'EWHAT' })).toBe('other');
  });
});

describe('how a folder is caught (take)', () => {
  const details = (wc, url, over = {}) => ({ resourceType: 'mainFrame', url, webContents: wc, ...over });
  it('sends a folder to the viewer, leaves a file alone, and ignores everything that is not a file: page load', async () => {
    const v = makeViewer();
    const wc = fakeContents();
    fs.mkdirSync(path.join(tmp, 'Alt Klasör'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    const folder = m.folderAddress(path.join(tmp, 'Alt Klasör'));
    expect(await ask(v, details(wc, folder))).toEqual({ redirectURL: m.viewerUrl(folder) });
    // Chromium's own address for it, without the slash, is caught too (a typed path)
    expect(await ask(v, details(wc, folder.replace(/\/$/, '')))).toEqual({ redirectURL: m.viewerUrl(folder) });
    expect(await ask(v, details(wc, m.fileUrlOfPath(path.join(tmp, 'a.txt'))))).toEqual({ cancel: false });
    expect(await ask(v, details(wc, m.fileUrlOfPath(path.join(tmp, 'missing'))))).toEqual({ cancel: false });
    expect(await ask(v, details(wc, 'file:///'))).toEqual({ redirectURL: m.viewerUrl('file:///') });
    expect(await ask(v, details(wc, 'https://example.com/'))).toBe('not taken');
    expect(await ask(v, details(wc, folder, { resourceType: 'subFrame' }))).toBe('not taken');
    expect(await ask(v, details(wc, folder, { resourceType: 'image' }))).toBe('not taken');
  });
  it('is not for a page of the window itself, a private or Tor tab, a burner, a private window or Vex\'s own start page', async () => {
    const v = makeViewer({ isOwnFile: (u) => /start\.html/.test(u) });
    fs.mkdirSync(path.join(tmp, 'd'));
    const folder = m.folderAddress(path.join(tmp, 'd'));
    expect(await ask(v, details(fakeContents({ getType: () => 'window' }), folder))).toBe('not taken');
    for (const partition of ['otr-123', 'tor-abc', 'persist:route-tor', 'private:5f2c', 'otr-burner-9', '']) expect(await ask(v, details(fakeContents({ partition }), folder)), partition).toBe('not taken');
    expect(await ask(v, details(fakeContents({ session: { __vexTor: true } }), folder))).toBe('not taken');
    expect(await ask(v, details(undefined, folder))).toBe('not taken');
    expect(await ask(v, details(fakeContents(), 'file:///C:/app/renderer/start.html'))).toBe('not taken');
    const stranger = makeViewer({ owner: () => null });
    expect(await ask(stranger, details(fakeContents(), folder))).toBe('not taken');
    const off = makeViewer({ isEnabled: () => false });
    expect(await ask(off, details(fakeContents(), folder))).toBe('not taken');
  });
  it('leaves a navigation the PAGE made to Chromium, and a folder opened "in the plain list" once', async () => {
    const v = makeViewer();
    const wc = fakeContents({ url: 'file:///C:/local/page.html' });
    v.guard(wc);
    fs.mkdirSync(path.join(tmp, 'd'));
    const folder = m.folderAddress(path.join(tmp, 'd'));
    wc.emit('will-navigate', { url: folder, preventDefault() {} }, folder);          // a link in a local page
    expect(await ask(v, details(wc, folder))).toBe('not taken');
    // the person then types it: the page's mark is for that one link
    await new Promise((r) => setTimeout(r, 5));
    const clock = { t: 1000 };
    const v2 = makeViewer({ now: () => clock.t });
    const wc2 = fakeContents();
    v2.guard(wc2);
    wc2.emit('will-navigate', { url: folder, preventDefault() {} }, folder);
    expect(await ask(v2, details(wc2, folder))).toBe('not taken');
    clock.t += 60000;
    expect(await ask(v2, details(wc2, folder))).toEqual({ redirectURL: m.viewerUrl(folder) });
    // the plain list, once
    v2.allowOnce(wc2.id, folder);
    expect(await ask(v2, details(wc2, folder))).toBe('not taken');
    expect(await ask(v2, details(wc2, folder))).toEqual({ redirectURL: m.viewerUrl(folder) });
  });
  it('sends a share that does not answer to the viewer, which says so', async () => {
    const v = makeViewer({ core: m.createFolderCore({ fs: { promises: { stat: () => new Promise(() => {}) } } }) });
    const out = await ask(v, details(fakeContents(), 'file://offline-server/share/'));
    expect(out).toEqual({ redirectURL: m.viewerUrl('file://offline-server/share/') });
  }, 10000);
});

describe('a web page cannot reach the viewer (guard)', () => {
  const evt = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  it('refuses a page navigating itself, a redirect and a frame to the viewer, unless the tab already shows the viewer', () => {
    const v = makeViewer();
    const wc = fakeContents();
    v.guard(wc);
    const target = viewerUrl(tmp);
    let e = evt(); wc.emit('will-navigate', e, target); expect(e.prevented).toBe(true);
    e = evt(); e.url = target; wc.emit('will-redirect', e); expect(e.prevented).toBe(true);
    let d = { url: target, isMainFrame: false, preventDefault() { this.prevented = true; } }; wc.emit('will-frame-navigate', d); expect(d.prevented).toBe(true);
    d = { url: target, isMainFrame: true, preventDefault() { this.prevented = true; } }; wc.emit('will-frame-navigate', d); expect(d.prevented).toBe(true);
    // the folder page's own links (a sub folder) are fine
    wc.url = viewerUrl(tmp);
    e = evt(); wc.emit('will-navigate', e, viewerUrl(path.join(tmp, 'sub'))); expect(e.prevented).toBe(false);
    d = { url: viewerUrl(path.join(tmp, 'sub')), isMainFrame: true, preventDefault() { this.prevented = true; } }; wc.emit('will-frame-navigate', d); expect(d.prevented).toBeFalsy();
    // ...but not from a frame inside it
    d = { url: viewerUrl(path.join(tmp, 'sub')), isMainFrame: false, preventDefault() { this.prevented = true; } }; wc.emit('will-frame-navigate', d); expect(d.prevented).toBe(true);
    // a redirect to the viewer is never allowed, from anywhere
    e = evt(); e.url = target; wc.emit('will-redirect', e); expect(e.prevented).toBe(true);
  });
  it('does not let a web page open a file: address in a tab', () => {
    expect(m.mayOpenFileFrom('https://evil.test/')).toBe(false);
    expect(m.mayOpenFileFrom('http://localhost:3000/')).toBe(false);
    expect(m.mayOpenFileFrom('about:blank')).toBe(false);
    expect(m.mayOpenFileFrom('')).toBe(false);
    expect(m.mayOpenFileFrom('file:///C:/local/page.html')).toBe(true);
    expect(m.mayOpenFileFrom('vex://start')).toBe(true);
    expect(m.mayOpenFileFrom('vex-files://browse/?u=file%3A%2F%2F%2F')).toBe(true);
    const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/\^file:\/i\.test\(String\(url \|\| ''\)\) && !_folderViewerMod\.mayOpenFileFrom\(openerUrl\)/);
    expect(main).toMatch(/_folderViewer\.take\(details, callback\)/);
    expect(main).toMatch(/_folderViewer\.guard\(contents\)/);
  });
  it('serves the scheme to persistent sessions only', () => {
    const v = makeViewer();
    const made = () => { const handled = []; return { handled, protocol: { handle: (s, h) => handled.push(s) } }; };
    for (const partition of ['persist:main', 'persist:container-work', 'persist:route-example']) { const s = made(); expect(v.wireSession(s, partition), partition).toBe(true); expect(s.handled).toEqual(['vex-files']); }
    for (const partition of ['otr-1', 'tor-1', 'private:abc', 'persist:route-tor', '', undefined]) { const s = made(); expect(v.wireSession(s, partition), String(partition)).toBe(false); expect(s.handled).toEqual([]); }
    const tor = made(); tor.__vexTor = true; expect(v.wireSession(tor, 'persist:main')).toBe(false);
  });
});

describe('the page and what it loads', () => {
  const get = async (v, url) => v.makeHandler()({ url, headers: new Headers() });
  it('serves the page with a strict policy, the look baked in, and nothing outside its folders', async () => {
    const v = makeViewer();
    const r = await get(v, 'vex-files://browse/?u=file%3A%2F%2F%2F');
    expect(r.status).toBe(200);
    const csp = r.headers.get('content-security-policy');
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await r.text();
    expect(html).toContain('<html lang="tr" data-theme="oxford" data-gui-style="firefox">');
    for (const bad of ['/app/..%2f..%2fmain.js', '/app/../../main.js', '/css/..%5c..%5cmain.js', '/app/viewer.exe', '/nothing', '/fonts/../js/vex-icons.js']) expect((await get(v, 'vex-files://browse' + bad)).status, bad).toBeGreaterThanOrEqual(400);
    expect((await get(v, 'vex-files://browse/app/app.js')).status).toBe(200);
    expect((await get(v, 'vex-files://browse/icons.js')).status).toBe(200);
    expect((await get(v, 'vex-files://browse/css/a11y.css')).status).toBe(200);
    expect((await get(v, 'vex-files://other/')).status).toBe(404);
  });
  it('takes no theme or language that is not a plain word', async () => {
    const v = makeViewer({ look: () => ({ theme: '"><script>', guiStyle: 'x" onload="1', lang: '<b>' }) });
    const html = await (await get(v, 'vex-files://browse/')).text();
    expect(html).toContain('data-theme="oxford" data-gui-style="classic"');
    expect(html).toContain('<html lang="en"');
  });
});

describe('what the page may ask (the channels)', () => {
  let handlers, shell, clipboard, trashDir, viewer, nativeImage, thumbCalls;
  function setup(over = {}) {
    handlers = new Map();
    trashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-bin-'));
    cleanups.push(() => fs.rmSync(trashDir, { recursive: true, force: true }));
    shell = { opened: [], shown: [], trashed: [], openPath: async (p) => { shell.opened.push(p); return ''; }, showItemInFolder: (p) => shell.shown.push(p), trashItem: async (p) => { shell.trashed.push(p); fs.renameSync(p, path.join(trashDir, path.basename(p))); } };
    clipboard = { text: '', writeText(t) { this.text = t; } };
    thumbCalls = 0;
    const fakeImg = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA', toJPEG: () => Buffer.from('jpeg'), getSize: () => ({ width: 10, height: 10 }), resize() { return fakeImg; } };
    nativeImage = { createThumbnailFromPath: async () => { thumbCalls++; return fakeImg; }, createFromBuffer: () => fakeImg };
    viewer = makeViewer(over);
    m.registerFolderViewerIpc({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, shell, clipboard, nativeImage, viewer, getFileIcon: async () => ({ icon: true }), getPath: (n) => path.join(tmp, n), homedir: () => tmp });
  }
  const eventFor = (dir, over = {}) => ({ senderFrame: { url: viewerUrl(dir), parent: null }, sender: fakeContents(over.sender || {}), ...over.event });
  const call = (channel, event, ...args) => handlers.get(channel)(event, ...args);

  it('lists a folder: names, kinds and the link/hidden marks, in one quick answer; details come in batches', async () => {
    setup();
    fs.mkdirSync(path.join(tmp, 'Alt Klasör'));
    fs.writeFileSync(path.join(tmp, 'Çalışma.txt'), 'abc');
    fs.writeFileSync(path.join(tmp, '.dot'), '');
    const r = await call('folderview:list', eventFor(tmp));
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('folder');
    expect(r.path).toBe(path.win32.normalize(tmp));
    const by = Object.fromEntries(r.entries.map((e) => [e.n, e]));
    expect(by['Alt Klasör'].d).toBe(1);
    expect(by['Çalışma.txt'].d).toBe(0);
    expect(by['.dot'].h).toBe(1);
    expect(r.parentUrl).toBe(m.folderAddress(path.dirname(tmp)));
    const s = await call('folderview:stat', eventFor(tmp), { names: ['Çalışma.txt', 'Alt Klasör', 'missing.txt'] });
    expect(s.stats[0][0]).toBe(3);
    expect(s.stats[0][1]).toBeGreaterThan(1e12);
    expect(s.stats[1][0]).toBe(-1);
    expect(s.stats[2][2]).toBe(2);
  });
  it('lists a thousand entries without touching them one by one, and refuses a batch over its limit', async () => {
    setup();
    for (let i = 0; i < 1200; i++) fs.writeFileSync(path.join(tmp, 'f' + i + '.txt'), 'x');
    const r = await call('folderview:list', eventFor(tmp));
    expect(r.entries.length).toBe(1200);
    const names = r.entries.map((e) => e.n);
    const a = await call('folderview:stat', eventFor(tmp), { names: names.slice(0, 1500) });
    expect(a.ok).toBe(true);
    expect(a.stats.every((x) => x[0] === 1)).toBe(true);
    expect(() => validate('folderview:stat', [{ names: new Array(1501).fill('a') }])).toThrow();
    const big = await call('folderview:stat', eventFor(tmp), { names: new Array(1501).fill('f1.txt') });
    expect(big.ok).toBe(false);
  });
  it('says what went wrong in codes: missing, a file, denied', async () => {
    setup();
    const missing = await call('folderview:list', eventFor(path.join(tmp, 'nope')));
    expect(missing).toMatchObject({ ok: false, code: 'missing' });
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'x');
    const file = await call('folderview:list', eventFor(path.join(tmp, 'file.txt')));
    expect(file).toMatchObject({ ok: true, kind: 'file', name: 'file.txt' });
    const pc = await call('folderview:list', { senderFrame: { url: m.viewerUrl('file:///'), parent: null }, sender: fakeContents() });
    expect(pc.kind).toBe('thisPc');
    expect(Array.isArray(pc.drives)).toBe(true);
  });
  it('answers only the viewer page: the top frame of a normal tab', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    const good = eventFor(tmp);
    expect((await call('folderview:list', good)).ok).toBe(true);
    const refused = async (event, why) => { const r = await call('folderview:list', event); expect(r.ok, why).toBe(false); expect(r.error, why).toMatch(/folder browser/); };
    await refused({ ...good, senderFrame: { url: viewerUrl(tmp), parent: {} } }, 'an iframe');
    await refused({ ...good, senderFrame: { url: 'https://evil.test/', parent: null } }, 'a web page');
    await refused({ ...good, senderFrame: { url: 'file:///C:/app/renderer/index.html', parent: null } }, 'the window');
    await refused({ ...good, senderFrame: { url: 'vex-files://browse/m/' + 'a'.repeat(48), parent: null } }, 'a media address');
    await refused({ ...good, senderFrame: { url: 'vex-files://browse/?u=https%3A%2F%2Fevil.test%2F', parent: null } }, 'a viewer address for a web page');
    await refused({ ...good, senderFrame: undefined }, 'no frame');
    for (const partition of ['otr-1', 'tor-1', 'private:1', 'persist:route-tor']) await refused({ ...good, sender: fakeContents({ partition }) }, partition);
    await refused({ ...good, sender: fakeContents({ getType: () => 'window' }) }, 'not a tab');
    const off = makeViewer({ isEnabled: () => false });
    handlers = new Map();
    m.registerFolderViewerIpc({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, shell, clipboard, nativeImage, viewer: off, getFileIcon: async () => ({}) });
    await refused(good, 'switched off');
  });
  it('acts on a name inside the folder, and refuses a name that reaches out of it', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(path.dirname(tmp), 'outside-' + path.basename(tmp) + '.txt'), 'secret');
    const e = eventFor(tmp);
    const outside = '..\\outside-' + path.basename(tmp) + '.txt';
    for (const [channel, arg] of [['folderview:preview', { name: outside }], ['folderview:stat', { names: [outside] }], ['folderview:thumb', { name: outside, size: 128 }], ['folderview:rename', { name: outside, to: 'x.txt' }],
      ['folderview:trash', { names: [outside], confirmed: true }], ['folderview:external', { name: outside }], ['folderview:reveal', { name: outside }], ['folderview:size-start', { name: outside }], ['folderview:mkdir', { name: '..\\evil' }],
      ['folderview:copy', { names: [outside], as: 'path' }], ['folderview:drag', { names: [outside] }]]) {
      const r = await call(channel, e, arg);
      const bad = channel === 'folderview:trash' ? r.ok === false || r.results.every((x) => !x.ok) : r.ok === false || (channel === 'folderview:stat' && r.ok === false);
      expect(bad, channel + ' ' + JSON.stringify(r).slice(0, 120)).toBe(true);
    }
    expect(shell.trashed).toEqual([]);
    expect(shell.opened).toEqual([]);
    expect(fs.existsSync(path.join(path.dirname(tmp), 'outside-' + path.basename(tmp) + '.txt'))).toBe(true);
    fs.rmSync(path.join(path.dirname(tmp), 'outside-' + path.basename(tmp) + '.txt'));
  });
  it('makes a folder, renames, and never overwrites', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'A');
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'B');
    const e = eventFor(tmp);
    expect(await call('folderview:mkdir', e, { name: 'Yeni klasör' })).toMatchObject({ ok: true, name: 'Yeni klasör' });
    expect(fs.statSync(path.join(tmp, 'Yeni klasör')).isDirectory()).toBe(true);
    expect(await call('folderview:mkdir', e, { name: 'Yeni klasör' })).toMatchObject({ ok: false, code: 'exists' });
    expect(await call('folderview:mkdir', e, { name: 'bad:name' })).toMatchObject({ ok: false });
    expect(await call('folderview:rename', e, { name: 'a.txt', to: 'b.txt' })).toMatchObject({ ok: false, code: 'exists' });
    expect(fs.readFileSync(path.join(tmp, 'b.txt'), 'utf8')).toBe('B');
    expect(await call('folderview:rename', e, { name: 'a.txt', to: 'A.TXT' })).toMatchObject({ ok: true, name: 'A.TXT' });      // only the case changes
    expect(fs.readdirSync(tmp)).toContain('A.TXT');
    expect(await call('folderview:rename', e, { name: 'A.TXT', to: 'CON' })).toMatchObject({ ok: false });
    expect(await call('folderview:rename', e, { name: 'A.TXT', to: 'ç ş ğ ı.txt' })).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(tmp, 'ç ş ğ ı.txt'), 'utf8')).toBe('A');
  });
  it('deletes to the Recycle Bin only, and only after a yes; a drive without one deletes nothing', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'gone.txt'), 'x');
    fs.writeFileSync(path.join(tmp, 'kept.txt'), 'y');
    const e = eventFor(tmp);
    expect(await call('folderview:trash', e, { names: ['gone.txt'], confirmed: false })).toMatchObject({ ok: false });
    expect(shell.trashed).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'gone.txt'))).toBe(true);
    const r = await call('folderview:trash', e, { names: ['gone.txt'], confirmed: true });
    expect(r.results).toEqual([{ name: 'gone.txt', ok: true }]);
    expect(shell.trashed).toEqual([path.win32.join(path.win32.normalize(tmp), 'gone.txt')]);
    expect(fs.existsSync(path.join(tmp, 'gone.txt'))).toBe(false);
    // the source never deletes for good: nothing but shell.trashItem removes a thing
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/folder-viewer.js'), 'utf8');
    expect(src).not.toMatch(/\bfs(?:\.promises)?\.(?:rm|rmdir|unlink)(?:Sync)?\(/);
    shell.trashItem = async () => { const err = new Error('no recycle bin here'); err.code = 'EPERM'; throw err; };
    const failed = await call('folderview:trash', e, { names: ['kept.txt'], confirmed: true });
    expect(failed.results[0]).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(tmp, 'kept.txt'))).toBe(true);
  });
  it('opens with Windows on a click, but a program, script or shortcut only after the warning is accepted', async () => {
    setup();
    for (const n of ['doc.docx', 'run.bat', 'tool.exe', 'a.lnk', 'x.ps1', 'x.msi', 'x.HTA']) fs.writeFileSync(path.join(tmp, n), 'x');
    fs.mkdirSync(path.join(tmp, 'folder'));
    const e = eventFor(tmp);
    expect((await call('folderview:external', e, { name: 'doc.docx' })).ok).toBe(true);
    expect(shell.opened.length).toBe(1);
    for (const n of ['run.bat', 'tool.exe', 'a.lnk', 'x.ps1', 'x.msi', 'x.HTA']) {
      const r = await call('folderview:external', e, { name: n });
      expect(r, n).toMatchObject({ ok: true, needsConfirm: true });
      expect((await call('folderview:external', e, { name: n, confirmed: false })), n).toMatchObject({ needsConfirm: true });
    }
    expect(shell.opened.length).toBe(1);
    expect((await call('folderview:external', e, { name: 'run.bat', confirmed: true })).ok).toBe(true);
    expect(shell.opened.length).toBe(2);
    expect((await call('folderview:external', e, { name: 'folder' })).ok).toBe(true);
  });
  it('shows in File Explorer, copies, and drags only what is in the folder', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'a b.txt'), 'x');
    const e = eventFor(tmp);
    await call('folderview:reveal', e, { name: 'a b.txt' });
    await call('folderview:reveal', e);
    expect(shell.shown).toEqual([path.win32.join(path.win32.normalize(tmp), 'a b.txt')]);
    expect(shell.opened).toEqual([path.win32.normalize(tmp)]);
    await call('folderview:copy', e, { as: 'path' });
    expect(clipboard.text).toBe(path.win32.normalize(tmp));
    await call('folderview:copy', e, { names: ['a b.txt'], as: 'url' });
    expect(clipboard.text).toBe(m.folderAddress(tmp) + 'a%20b.txt');
    await call('folderview:copy', e, { names: ['a b.txt'], as: 'name' });
    expect(clipboard.text).toBe('a b.txt');
    const dragSender = fakeContents();
    await call('folderview:drag', { ...e, sender: dragSender }, { names: ['a b.txt'] });
    expect(dragSender.dragged.file).toBe(path.win32.join(path.win32.normalize(tmp), 'a b.txt'));
  });
  it('previews a text file by its start, tells a binary one, and makes a token address for a picture', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 't.txt'), 'Merhaba İstanbul ğüşıöç\n'.repeat(5000));
    fs.writeFileSync(path.join(tmp, 'b.bin'), Buffer.from([0, 1, 2, 0, 3]));
    fs.writeFileSync(path.join(tmp, 'u16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Türkçe', 'utf16le')]));
    fs.writeFileSync(path.join(tmp, 'p.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(tmp, 'doc.md'), '# x');
    fs.writeFileSync(path.join(tmp, 'x.exe'), 'MZ');
    const e = eventFor(tmp);
    const t = (await call('folderview:preview', e, { name: 't.txt' })).preview;
    expect(t.kind).toBe('text');
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(64 * 1024);
    expect(t.text.startsWith('Merhaba İstanbul ğüşıöç')).toBe(true);
    expect((await call('folderview:preview', e, { name: 'b.bin' })).preview.kind).toBe('none');
    expect((await call('folderview:preview', e, { name: 'u16.txt' })).preview).toMatchObject({ kind: 'text', text: 'Türkçe' });
    expect((await call('folderview:preview', e, { name: 'doc.md' })).preview.kind).toBe('markdown');
    expect((await call('folderview:preview', e, { name: 'x.exe' })).preview.kind).toBe('none');
    const p = (await call('folderview:preview', e, { name: 'p.png' })).preview;
    expect(p).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(p.url).toMatch(/^vex-files:\/\/browse\/m\/[0-9a-f]{48}$/);
  });
  it('serves a picture only by its token, with ranges, to nobody else', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'v.mp4'), Buffer.from('0123456789'));
    const wcEvent = eventFor(tmp);
    const url = (await call('folderview:preview', wcEvent, { name: 'v.mp4' })).preview.url;
    const h = viewer.makeHandler();
    const full = await h({ url, headers: new Headers() });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(full.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await full.text()).toBe('0123456789');
    const part = await h({ url, headers: new Headers({ range: 'bytes=2-5' }) });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect((await h({ url, headers: new Headers({ range: 'bytes=20-30' }) })).status).toBe(416);
    expect((await h({ url: 'vex-files://browse/m/' + 'a'.repeat(48), headers: new Headers() })).status).toBe(404);
    expect((await h({ url: 'vex-files://browse/m/../../x', headers: new Headers() })).status).toBeGreaterThanOrEqual(400);
    expect((await h({ url: 'vex-files://browse/m/' + path.join(tmp, 'v.mp4'), headers: new Headers() })).status).toBeGreaterThanOrEqual(400);
    viewer.dropTokensOf(wcEvent.sender.id);
    expect((await h({ url, headers: new Headers() })).status).toBe(404);
  });
  it('keeps the tokens of a tab only while it stays on the page', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'a.png'), 'x');
    const sender = fakeContents();
    viewer.guard(sender);
    const e = eventFor(tmp, { sender });
    e.sender = sender;
    const url = (await call('folderview:preview', e, { name: 'a.png' })).preview.url;
    expect((await viewer.makeHandler()({ url, headers: new Headers() })).status).toBe(200);
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://example.com/' });
    expect((await viewer.makeHandler()({ url, headers: new Headers() })).status).toBe(404);
  });
  it('makes pictures when asked, keeps them in memory only, and asks Windows again only when the file changed', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'p.png'), Buffer.alloc(100));
    fs.writeFileSync(path.join(tmp, 'x.exe'), 'MZ');
    fs.writeFileSync(path.join(tmp, 'n.txt'), 'x');
    const e = eventFor(tmp);
    const a = await call('folderview:thumb', e, { name: 'p.png', size: 100 });
    expect(a).toMatchObject({ ok: true, url: 'data:image/png;base64,AAAA' });
    await call('folderview:thumb', e, { name: 'p.png', size: 100 });
    expect(thumbCalls).toBe(1);
    await call('folderview:thumb', e, { name: 'p.png', size: 300 });
    expect(thumbCalls).toBe(2);
    // not a picture kind: Windows is not asked at all (no thumbnail handlers run for a program or an unknown kind)
    expect((await call('folderview:thumb', e, { name: 'x.exe', size: 128 })).ok).toBe(false);
    expect((await call('folderview:thumb', e, { name: 'n.txt', size: 128 })).ok).toBe(false);
    expect(thumbCalls).toBe(2);
    fs.writeFileSync(path.join(tmp, 'p.png'), Buffer.alloc(200));
    await call('folderview:thumb', e, { name: 'p.png', size: 100 });
    expect(thumbCalls).toBe(3);
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/folder-viewer.js'), 'utf8');
    expect(src).not.toMatch(/writeFile|createWriteStream|appendFile/);   // nothing is ever written to disk by the browser itself except mkdir/rename
  });
  it('counts a folder\'s size on request, stops when told, and only for the tab that asked', async () => {
    setup();
    fs.mkdirSync(path.join(tmp, 'tree', 'a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tree', 'a', 'x.bin'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(tmp, 'tree', 'y.bin'), Buffer.alloc(500));
    const e = eventFor(tmp);
    const { id } = await call('folderview:size-start', e, { name: 'tree' });
    let p;
    for (let i = 0; i < 100; i++) { p = (await call('folderview:size-poll', e, { id })).progress; if (p.done) break; await new Promise((r) => setTimeout(r, 20)); }
    expect(p).toMatchObject({ done: true, bytes: 1500, files: 2, dirs: 1 });
    const other = eventFor(tmp, { sender: fakeContents({ id: 99 }) });
    expect((await call('folderview:size-poll', other, { id })).ok).toBe(false);
    expect((await call('folderview:size-start', e, { name: 'tree\\..' })).ok).toBe(false);
    fs.writeFileSync(path.join(tmp, 'plain.txt'), 'x');
    expect((await call('folderview:size-start', e, { name: 'plain.txt' })).ok).toBe(false);
  });
  it('lists the places a person goes to first, only those that exist', async () => {
    setup();
    fs.mkdirSync(path.join(tmp, 'downloads'));
    const r = await call('folderview:places', eventFor(tmp));
    expect(r.places.map((p) => p.id)).toEqual(['home', 'downloads']);
  });
  it('opens the plain list or the file itself once, by going through the catch', async () => {
    setup();
    fs.writeFileSync(path.join(tmp, 'noext'), 'x');
    const sender = fakeContents();
    const e = eventFor(tmp, { sender });
    e.sender = sender;
    await call('folderview:plain-list', e);
    expect(sender.loaded).toBe(m.folderAddress(tmp));
    const f = { senderFrame: { url: viewerUrl(path.join(tmp, 'noext')), parent: null }, sender };
    await call('folderview:open-as-file', f);
    expect(sender.loaded).toBe(m.folderAddress(path.join(tmp, 'noext')).replace(/\/$/, ''));
  });
});

describe('long paths, hidden files and drives', () => {
  it('gives Windows the long form of a path over the old limit', () => {
    const core = m.createFolderCore({ platform: 'win32' });
    expect(core.fsPath('C:\\short')).toBe('C:\\short');
    const long = 'C:\\' + 'a'.repeat(250);
    expect(core.fsPath(long)).toBe('\\\\?\\' + long);
    expect(core.fsPath('\\\\srv\\share\\' + 'b'.repeat(240))).toBe('\\\\?\\UNC\\srv\\share\\' + 'b'.repeat(240));
    expect(m.createFolderCore({ platform: 'linux' }).fsPath(long)).toBe(long);
  });
  it.runIf(process.platform === 'win32')('marks a hidden file by its Windows attribute and by its leading dot, with Turkish names intact', async () => {
    const { spawnSync } = require('child_process');
    const core = m.createFolderCore({});
    fs.writeFileSync(path.join(tmp, 'gizli şğı.txt'), 'x');
    fs.writeFileSync(path.join(tmp, 'görünür.txt'), 'x');
    fs.writeFileSync(path.join(tmp, '.dot'), 'x');
    spawnSync('attrib', ['+H', path.join(tmp, 'gizli şğı.txt')], { windowsHide: true });
    const out = await core.listFolder(path.win32.normalize(tmp));
    const by = Object.fromEntries(out.entries.map((e) => [e.n, e.h]));
    expect(by).toEqual({ 'gizli şğı.txt': 1, 'görünür.txt': 0, '.dot': 1 });
    expect(out.hiddenKnown).toBe(true);
  });
  it.runIf(process.platform === 'win32')('lists a long path (over 260 characters)', async () => {
    const core = m.createFolderCore({});
    let deep = '\\\\?\\' + tmp;
    for (let i = 0; i < 8; i++) { deep += '\\' + 'derin-klasör-adı-' + 'x'.repeat(30); fs.mkdirSync(deep); }
    fs.writeFileSync(deep + '\\dip.txt', 'x');
    expect(deep.length).toBeGreaterThan(300);
    const out = await core.listFolder(deep.replace('\\\\?\\', ''));
    expect(out.entries.map((e) => e.n)).toEqual(['dip.txt']);
  });
  it.runIf(process.platform === 'win32')('lists the drives that answer', async () => {
    const drives = await m.createFolderCore({}).listDrives();
    expect(drives.length).toBeGreaterThan(0);
    expect(drives[0]).toMatchObject({ letter: expect.stringMatching(/^[A-Z]$/), path: expect.stringMatching(/^[A-Z]:\\$/), url: expect.stringMatching(/^file:\/\/\/[A-Z]:\/$/) });
  });
  it('gives up on a drive that does not answer, with a code the page words', async () => {
    const core = m.createFolderCore({ fs: { promises: { readdir: () => new Promise(() => {}), stat: () => new Promise(() => {}) } } });
    await expect(m.withTimeout(core.listFolder('Z:\\'), 50)).rejects.toMatchObject({ code: 'VEX_TIMEOUT' });
    expect(m.codeOf({ code: 'VEX_TIMEOUT' })).toBe('timeout');
  });
});

describe('the channels are closed to everyone else (ipc-policy, ipc-schemas)', () => {
  const channels = ['list', 'stat', 'ping', 'places', 'thumb', 'preview', 'size-start', 'size-poll', 'size-cancel', 'external', 'reveal', 'mkdir', 'rename', 'trash', 'copy', 'drag', 'plain-list', 'open-as-file'].map((c) => 'folderview:' + c);
  const policySrc = fs.readFileSync(path.resolve(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
  it('has a payload schema for every channel, and a name only (never a path) in each', () => {
    for (const c of [...channels, 'folderview:set-enabled', 'folderview:forget-recent']) {
      const { schemas } = require('../../src/main/ipc-schemas.js');
      expect(schemas.has(c), c).toBe(true);
    }
    expect(() => validate('folderview:rename', [{ name: 'a', to: 'b' }])).not.toThrow();
    expect(() => validate('folderview:rename', [{ name: 'a' }])).toThrow();
    expect(() => validate('folderview:trash', [{ names: [], confirmed: true }])).toThrow();
    expect(() => validate('folderview:trash', [{ names: ['a'] }])).toThrow();
    expect(() => validate('folderview:copy', [{ as: 'file' }])).toThrow();
    expect(() => validate('folderview:thumb', [{ name: 'a', size: 'big' }])).toThrow();
    expect(() => validate('folderview:list', ['C:\\'])).toThrow();
    expect(() => validate('folderview:size-poll', [{ id: 'x'.repeat(40) }])).toThrow();
  });
  it('lets the page (a guest of a Vex window) use the page channels, and only the interface use the switches', async () => {
    const calls = [];
    const handlers = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on: () => {} };
    const security = { isUiFrame: (e) => e.ui === true, owner: (s) => (s.hostId ? { win: {}, privatePartition: s.private ? 'private:1' : null } : null), isAuxiliary: () => false, ownsTarget: () => true, isStartPageFile: () => false };
    installIpcPolicy(ipcMain, security);
    for (const c of [...channels, 'folderview:set-enabled', 'folderview:forget-recent']) ipcMain.handle(c, (e) => { calls.push(c); return 'ok'; });
    const args = (c) => (c === 'folderview:stat' ? [{ names: ['a'] }] : c === 'folderview:thumb' ? [{ name: 'a', size: 100 }] : /preview|size-start|mkdir/.test(c) ? [{ name: 'a' }] : /size-poll|size-cancel/.test(c) ? [{ id: 'x' }] : c === 'folderview:external' ? [{ name: 'a' }] : c === 'folderview:rename' ? [{ name: 'a', to: 'b' }] : c === 'folderview:trash' ? [{ names: ['a'], confirmed: true }] : c === 'folderview:copy' ? [{ as: 'path' }] : c === 'folderview:drag' ? [{ names: ['a'] }] : c === 'folderview:set-enabled' ? [true] : []);
    const guest = { sender: { hostId: 1 }, senderFrame: {} };
    for (const c of channels) expect(await handlers.get(c)(guest, ...args(c)), c).toBe('ok');
    // a guest cannot flip the switch or clear the recent folders
    for (const c of ['folderview:set-enabled', 'folderview:forget-recent']) await expect(handlers.get(c)(guest, ...args(c)), c).rejects.toThrow();
    expect(await handlers.get('folderview:set-enabled')({ ui: true, sender: { hostId: 1 }, senderFrame: {} }, true)).toBe('ok');
    // something that is not a tab of a Vex window (a popup, an extension page, another app window) cannot use any of them
    for (const c of channels) await expect(handlers.get(c)({ sender: {}, senderFrame: {} }, ...args(c)), c).rejects.toThrow(/Untrusted/);
    // and a private window refuses them
    for (const c of channels) await expect(handlers.get(c)({ sender: { hostId: 1, private: true }, senderFrame: {} }, ...args(c)), c).rejects.toThrow(/private window/);
    expect(calls.length).toBe(channels.length + 1);
  });
  it('names the channels in the policy once each and puts the switches in the interface-only list', () => {
    for (const c of ['folderview:set-enabled', 'folderview:forget-recent']) expect(UI_ONLY_CHANNELS.has(c), c).toBe(true);
    for (const c of channels) expect(UI_ONLY_CHANNELS.has(c), c).toBe(false);
    for (const c of channels) expect(policySrc.split(`'${c}'`).length - 1, c).toBe(1);
  });
  it('exposes exactly the channels to the page preload, and none to the window', () => {
    const pre = fs.readFileSync(path.resolve(__dirname, '../../src/preload-webview.js'), 'utf8');
    const used = new Set([...pre.matchAll(/'(folderview:[a-z-]+)'/g)].map((x) => x[1]));
    for (const c of channels) expect(used.has(c), c).toBe(true);
    const win = fs.readFileSync(path.resolve(__dirname, '../../src/preload.js'), 'utf8');
    expect([...win.matchAll(/'(folderview:[a-z-]+)'/g)].map((x) => x[1]).sort()).toEqual(['folderview:forget-recent', 'folderview:set-enabled']);
    // the bridge is made only for the folder browser's own pages
    expect(pre).toMatch(/location\.protocol === 'vex-files:'/);
  });
});
