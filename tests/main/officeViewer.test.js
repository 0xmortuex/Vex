// Vex's own viewer for office documents and e-books, the main-process side (src/main/office-viewer.js, src/main/doc-viewers.js):
// which files it takes, how a navigation is handed to it, what its page may do, and what it may ask main to do.
// How it looks and behaves in the real window is checked by driving a real Vex.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ov = require('../../src/main/office-viewer.js');
const { createDocViewerRegistry } = require('../../src/main/doc-viewers.js');
const fx = require('../helpers/officeFixtures.js');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('which files the viewer takes', () => {
  it('knows every office and book type by what the server says', () => {
    for (const type of [DOCX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
      'application/epub+zip', 'application/rtf', 'text/rtf', DOCX + '; charset=binary']) {
      expect(ov.matchOffice('https://example.org/download?id=7', type), type).toBe(true);
    }
  });
  it('falls back to the name when the server does not know the type', () => {
    for (const type of ['application/octet-stream', 'application/zip', '', 'application/x-zip-compressed', 'binary/octet-stream; foo=bar']) {
      expect(ov.matchOffice('https://example.org/files/report.docx', type), type).toBe(true);
      expect(ov.matchOffice('https://example.org/files/book.EPUB?token=1', type), type).toBe(true);
      expect(ov.matchOffice('https://example.org/files/archive.zip', type), type).toBe(false);
    }
  });
  it('leaves everything else alone', () => {
    expect(ov.matchOffice('https://example.org/a.pdf', 'application/pdf')).toBe(false);
    expect(ov.matchOffice('https://example.org/a.docx', 'text/html')).toBe(false);          // a login page at a .docx address
    expect(ov.matchOffice('https://example.org/a.docx.exe', 'application/octet-stream')).toBe(false);
    expect(ov.matchOffice('file:///C:/a.docx', DOCX)).toBe(false);                            // files are caught elsewhere
    expect(ov.matchOffice('https://example.org/data.csv', 'text/csv')).toBe(false);            // another viewer's
    expect(ov.isOfficeFileUrl('file:///C:/Users/a/Homework%20one.DOCX')).toBe(true);
    expect(ov.isOfficeFileUrl('file:///C:/Users/a/run.exe')).toBe(false);
    expect(ov.isOfficeFileUrl('https://example.org/a.docx')).toBe(false);
  });
});

describe('the viewer address', () => {
  it('round-trips the file address and a fragment', () => {
    const u = 'https://example.org/a b/ö.docx?x=1&y=2';
    const v = ov.viewerUrl(u, '');
    expect(v.startsWith('vex-office://view/?u=')).toBe(true);
    expect(ov.parseViewerUrl(v)).toEqual({ original: u, hash: '' });
    expect(ov.parseViewerUrl(ov.viewerUrl(u + '#page=2'))).toEqual({ original: u, hash: 'page=2' });
    expect(ov.parseViewerUrl('vex-office://view/doc?u=' + encodeURIComponent(u))).toBeNull();     // the file route is not the viewer page
    expect(ov.parseViewerUrl('https://example.org/')).toBeNull();
    expect(ov.parseViewerUrl('vex-office://view/')).toBeNull();
  });
  it('is mapped back by the window the same way (the twin in js/webview.js)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'webview.js'), 'utf8');
    const m = /officeOriginal\(url\) \{([\s\S]*?)\n  \},/.exec(src);
    expect(m).toBeTruthy();
    const officeOriginal = new Function('url', m[1]);
    for (const u of ['https://example.org/a.docx', 'https://example.org/a b/ö.docx?x=1&y=2', 'file:///C:/Users/a/Homework%20one.docx', 'https://example.org/a.docx#frag']) {
      const v = ov.viewerUrl(u);
      expect(officeOriginal(v), u).toBe(u);
      expect(ov.parseViewerUrl(v).original + (ov.parseViewerUrl(v).hash ? '#' + ov.parseViewerUrl(v).hash : '')).toBe(u);
    }
    expect(officeOriginal('https://example.org/')).toBeNull();
    expect(officeOriginal('vex-office://view/doc?u=x')).toBeNull();
  });
});

describe('handing a navigation to the viewer', () => {
  let registry, entry, guest, flags;
  beforeEach(() => {
    flags = { on: true, attachments: false };
    guest = { id: 7, isDestroyed: () => false, getURL: () => 'https://example.org/a.docx#x', loadURL: () => {} };
    registry = createDocViewerRegistry({ isGuest: (wc) => wc === guest });
    ov.createOfficeViewer({ rendererDir: path.join(__dirname, '..', '..', 'src', 'renderer'), registry, isEnabled: () => flags.on, attachments: () => flags.attachments });
    entry = registry.entries()[0];
  });
  const details = (over) => ({ resourceType: 'mainFrame', statusCode: 200, url: 'https://example.org/a.docx', webContents: guest, responseHeaders: { 'Content-Type': [DOCX] }, ...(over || {}) });
  const run = (d) => { let answer = null; const took = registry.take(d, (a) => { answer = a; }); return { took, answer }; };

  it('turns a main-frame answer into a redirect to the viewer, keeping the fragment', () => {
    const { took, answer } = run(details());
    expect(took).toBe(true);
    expect(answer.statusLine).toMatch(/302/);
    expect(answer.responseHeaders.location[0]).toBe(ov.viewerUrl('https://example.org/a.docx', 'x'));
  });
  it('does not touch a picture on a page, an error, a file the server says to save, or a tab that is not a Vex tab', () => {
    expect(run(details({ resourceType: 'image' })).took).toBe(false);
    expect(run(details({ statusCode: 404 })).took).toBe(false);
    expect(run(details({ responseHeaders: { 'content-type': [DOCX], 'content-disposition': ['attachment; filename=a.docx'] } })).took).toBe(false);
    expect(run(details({ webContents: { id: 9, isDestroyed: () => false } })).took).toBe(false);
    expect(run(details({ url: 'ftp://example.org/a.docx' })).took).toBe(false);
  });
  it('takes a file marked "attachment" only when the setting says so', () => {
    const d = details({ responseHeaders: { 'content-type': [DOCX], 'Content-Disposition': ['attachment; filename=a.docx'] } });
    expect(run(d).took).toBe(false);
    flags.attachments = true;
    expect(run(d).took).toBe(true);
  });
  it('is off when the switch is off', () => {
    flags.on = false;
    expect(run(details()).took).toBe(false);
  });
  it('lets "Download instead" through exactly once', () => {
    registry.allowOnce(7, 'https://example.org/a.docx');
    expect(run(details()).took).toBe(false);
    expect(run(details()).took).toBe(true);
  });

  it('does not take a file: download over: cancelling one and loading a page froze the packaged app\'s main process (2026-10-25)', () => {
    expect(registry.takeDownload).toBeUndefined();
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'office-viewer.js'), 'utf8')).not.toMatch(/will-download/);
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'doc-viewers.js'), 'utf8')).not.toMatch(/takeDownload/);
  });
  it('the window sends an office file: address to the viewer, written exactly as main writes it, and leaves every other address alone', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    for (const file of ['file:///C:/Users/a/Homework%20one.docx', 'file:///C:/b/Sheet.XLSX#sheet2', 'file:///C:/b/deck.pptx?x=1', 'file:///C:/b/book.epub']) {
      const viewer = WebviewManager.officeAddress(file);
      expect(viewer).toBe(ov.viewerUrl(file));
      expect(WebviewManager.officeOriginal(viewer)).toBe(file);
      expect(WebviewManager.viewerAddress(file)).toBe(viewer);   // and every load site calls the chain
    }
    for (const other of ['file:///C:/x/setup.exe', 'file:///C:/a.docx.exe', 'https://example.org/a.docx', 'vex://start', 'file:///C:/docx']) expect(WebviewManager.officeAddress(other)).toBe(other);
    expect([...WebviewManager.OFFICE_FILE_EXTENSIONS].sort()).toEqual([...ov.EXTENSIONS].sort());
  });
  it('sends a click on a file: link to the viewer, once the event has finished', async () => {
    const calls = { prevented: 0, loaded: null };
    guest.loadURL = (u) => { calls.loaded = u; };
    expect(registry.takeNavigation({ preventDefault: () => { calls.prevented++; } }, 'file:///C:/a/b.xlsx', guest)).toBe(true);
    expect(calls.loaded).toBe(null);
    await new Promise((r) => setImmediate(r));
    expect(calls.loaded).toBe(ov.viewerUrl('file:///C:/a/b.xlsx'));
    expect(registry.takeNavigation({ preventDefault: () => {} }, 'file:///C:/a/b.txt', guest)).toBe(false);
  });
  it('refuses two viewers with the same id, and a viewer with no way to match', () => {
    expect(() => registry.register({ id: 'office', match: () => false, page: () => '' })).toThrow(/already registered/);
    expect(() => registry.register({ id: 'x' })).toThrow(/needs/);
    expect(entry.id).toBe('office');
  });
});

describe('what the viewer page may do', () => {
  it('has a policy with no network, no eval and nothing but itself', () => {
    const csp = ov.CSP;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https?:|\*/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  let dir, viewer, registry;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-office-test-'));
    registry = createDocViewerRegistry({ isGuest: () => true });
    viewer = ov.createOfficeViewer({ rendererDir: path.join(__dirname, '..', '..', 'src', 'renderer'), registry, look: () => ({ theme: 'midnight', guiStyle: 'firefox', lang: 'tr' }) });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const get = async (p, partition) => viewer.makeHandler({ fetch: async () => { throw new Error('no network in this test'); } }, partition)({ url: 'vex-office://view' + p, headers: new Headers() });

  it('serves the page with the look and the language already in it, and stores nothing for a private tab', async () => {
    const r = await get('/?u=' + encodeURIComponent('https://example.org/a.docx'), 'persist:main');
    const html = await r.text();
    expect(r.headers.get('content-security-policy')).toBe(ov.CSP);
    expect(html).toContain('<html lang="tr" data-theme="midnight" data-gui-style="firefox">');
    expect(html).toContain('<meta name="vex-persist" content="1">');
    const priv = await (await get('/', 'otr-1234')).text();
    expect(priv).toContain('<meta name="vex-persist" content="0">');
  });
  it('serves only its own folders, and nothing above them', async () => {
    expect((await get('/app/app.js')).status).toBe(200);
    expect((await get('/css/theme-tokens.css')).status).toBe(200);
    expect((await get('/icons.js')).status).toBe(200);
    expect((await get('/app/..%2F..%2Fmain.js')).status).toBe(404);
    expect((await get('/app/../../../main.js')).status).toBe(404);
    expect((await get('/lib/../../../../package.json')).status).toBe(404);
    expect((await get('/app/nothing.js')).status).toBe(404);
    expect((await get('/app/app.map')).status).toBe(404);
    expect((await get('/elsewhere')).status).toBe(404);
  });
  it('reads a local office file, and no other local file', async () => {
    const good = path.join(dir, 'Odev.docx');
    fs.writeFileSync(good, fx.docx());
    const r = await get('/doc?u=' + encodeURIComponent(require('node:url').pathToFileURL(good).href));
    expect(r.status).toBe(200);
    expect(Number(r.headers.get('content-length'))).toBe(fs.statSync(good).size);
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    const secret = path.join(dir, 'passwords.txt');
    fs.writeFileSync(secret, 'secret');
    expect((await get('/doc?u=' + encodeURIComponent(require('node:url').pathToFileURL(secret).href))).status).toBe(400);
    expect((await get('/doc?u=' + encodeURIComponent('file:///C:/nope/missing.docx'))).status).toBe(404);
    expect((await get('/doc?u=' + encodeURIComponent('ftp://example.org/a.docx'))).status).toBe(400);
    expect((await get('/doc')).status).toBe(400);
  });
  it('fetches a web file through the session it was given, and says plainly when that fails', async () => {
    let asked = null;
    const ses = { fetch: async (u, o) => { asked = { u, o }; return new Response(fx.docx(), { status: 200, headers: { 'content-type': DOCX } }); } };
    const r = await viewer.makeHandler(ses, 'persist:main')({ url: 'vex-office://view/doc?u=' + encodeURIComponent('https://example.org/a.docx'), headers: new Headers() });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(DOCX);
    expect(asked.u).toBe('https://example.org/a.docx');
    expect(asked.o.credentials).toBe('include');
    const bad = await get('/doc?u=' + encodeURIComponent('https://example.org/a.docx'));
    expect(bad.status).toBe(502);
    expect(await bad.text()).toMatch(/could not be fetched/);
  });
});

describe('what the page may ask main to do', () => {
  function setup(extra) {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    const calls = { saved: [], opened: [], downloaded: [], allowed: [] };
    const registry = { allowOnce: (id, u) => calls.allowed.push([id, u]) };
    const dir = (extra && extra.dir) || fs.mkdtempSync(path.join(os.tmpdir(), 'vex-office-ipc-'));
    ov.registerOfficeViewerIpc({
      ipcMain, registry, windowFor: () => null, downloadsDir: () => dir, tempDir: () => dir,
      dialog: { showSaveDialog: async (...a) => { calls.saved.push(a[a.length - 1]); return extra && extra.pick ? { canceled: false, filePath: extra.pick } : { canceled: true }; } },
      shell: { openPath: async (p) => { calls.opened.push(p); return extra && extra.openError ? extra.openError : ''; } },
    });
    const eventFrom = (url, extraEvent) => ({ senderFrame: { url, parent: null }, sender: { id: 7, downloadURL: (u) => calls.downloaded.push(u), session: { fetch: async () => new Response(fx.docx(), { status: 200 }) }, print: (o, cb) => cb(true) }, ...(extraEvent || {}) });
    return { handlers, calls, dir, eventFrom };
  }
  const viewerFor = (u) => ov.viewerUrl(u);

  it('answers only the viewer page itself, never a frame inside it or another page', async () => {
    const { handlers, eventFrom } = setup();
    for (const name of ['officeview:download', 'officeview:open-external', 'officeview:print']) {
      expect((await handlers.get(name)(eventFrom('https://evil.example/'))).ok, name).toBe(false);
      expect((await handlers.get(name)({ senderFrame: { url: viewerFor('https://example.org/a.docx'), parent: {} }, sender: {} })).ok, name).toBe(false);
      expect((await handlers.get(name)(eventFrom('vex-office://view/doc?u=x'))).ok, name).toBe(false);
    }
  });
  it('downloads a web file through the tab, letting exactly that answer through the viewer', async () => {
    const { handlers, calls, eventFrom } = setup();
    const r = await handlers.get('officeview:download')(eventFrom(viewerFor('https://example.org/a.docx')));
    expect(r).toMatchObject({ ok: true, viaDownloads: true });
    expect(calls.allowed).toEqual([[7, 'https://example.org/a.docx']]);
    expect(calls.downloaded).toEqual(['https://example.org/a.docx']);
    expect((await handlers.get('officeview:download')(eventFrom(viewerFor('ftp://example.org/a.docx')))).ok).toBe(false);
  });
  it('copies a local file to where the person picks, never over itself', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-office-copy-'));
    const src = path.join(base, 'Odev.docx');
    fs.writeFileSync(src, fx.docx());
    const url = viewerFor(require('node:url').pathToFileURL(src).href);
    // the person closes the dialog
    let t = setup({ dir: base });
    expect((await t.handlers.get('officeview:download')(t.eventFrom(url))).cancelled).toBe(true);
    // the person picks another name: a copy, and the original is as it was
    const target = path.join(base, 'copy.docx');
    t = setup({ dir: base, pick: target });
    expect((await t.handlers.get('officeview:download')(t.eventFrom(url))).ok).toBe(true);
    expect(fs.statSync(target).size).toBe(fs.statSync(src).size);
    expect(fs.readdirSync(base).some((f) => f.endsWith('.vex-tmp'))).toBe(false);
    // the person picks the file being read
    t = setup({ dir: base, pick: src });
    const bad = await t.handlers.get('officeview:download')(t.eventFrom(url));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/file you are reading/);
    fs.rmSync(base, { recursive: true, force: true });
  });
  it('opens a local file with Windows, and a web file only from a copy marked as downloaded', async () => {
    const t = setup();
    const src = path.join(t.dir, 'Odev.docx');
    fs.writeFileSync(src, fx.docx());
    expect((await t.handlers.get('officeview:open-external')(t.eventFrom(viewerFor(require('node:url').pathToFileURL(src).href)))).ok).toBe(true);
    expect(t.calls.opened).toEqual([src]);
    const r = await t.handlers.get('officeview:open-external')(t.eventFrom(viewerFor('https://example.org/files/Rapor.docx')));
    expect(r.ok).toBe(true);
    const copy = t.calls.opened[1];
    expect(path.dirname(copy)).toMatch(/vex-open-[0-9a-f]{12}$/);
    expect(path.basename(copy)).toBe('Rapor.docx');
    expect(fs.existsSync(copy)).toBe(true);
    if (process.platform === 'win32') expect(fs.readFileSync(copy + ':Zone.Identifier', 'utf8')).toMatch(/ZoneId=3/);
    // not a document: refused before anything is written
    const bad = await t.handlers.get('officeview:open-external')(t.eventFrom(viewerFor('https://example.org/files/run.exe')));
    expect(bad.ok).toBe(false);
    const failing = setup({ openError: 'No application is associated' });
    fs.writeFileSync(path.join(failing.dir, 'x.docx'), fx.docx());
    const f = await failing.handlers.get('officeview:open-external')(failing.eventFrom(viewerFor(require('node:url').pathToFileURL(path.join(failing.dir, 'x.docx')).href)));
    expect(f).toEqual({ ok: false, error: 'No application is associated' });
  });
  it('sweeps old copies it made and nothing else', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sweep-'));
    const old = path.join(root, 'vex-open-0123456789ab'), fresh = path.join(root, 'vex-open-ba9876543210'), other = path.join(root, 'something-else');
    for (const d of [old, fresh, other]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'f'), 'x'); }
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    expect(ov.sweepOpenedCopies(root, 24 * 3600 * 1000)).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh) && fs.existsSync(other)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('the channels it uses are in the policy', () => {
  it('lists the page channels as guest channels and the switches as the window\'s only', () => {
    const policy = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc-policy.js'), 'utf8');
    // The guest set itself (it holds more channels as more of Vex's own pages are added), not a window of text after its name.
    const guestSet = /const GUEST_CHANNELS = new Set\(\[([\s\S]*?)\]\);/.exec(policy)[1];
    for (const name of ['officeview:download', 'officeview:open-external', 'officeview:print']) expect(guestSet).toContain("'" + name + "'");
    for (const name of ['officeview:set-options', 'officeview:forget-books']) expect(policy).toContain("'" + name + "'");
  });
});
