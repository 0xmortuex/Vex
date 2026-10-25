// Vex's own PDF viewer, main-process side (src/main/pdf-viewer.js): how a PDF reaches it, what it serves, what it refuses.
//
// A PDF page's response is turned into a redirect to the viewer; the document is fetched through the SAME session the tab runs in
// (a sign-in works, a private or Tor tab's PDF never goes through another session); a page that is not the viewer cannot call its
// channels; a saved copy is never written over the PDF being read.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const pv = require('../../src/main/pdf-viewer');
const toolkit = require('../../src/main/pdf-toolkit');
const { validate } = require('../../src/main/ipc-schemas');
const policy = require('../../src/main/ipc-policy');
const { shortcutFor } = require('../../src/main/guest-shortcuts');
const { guestOwnsFind, isPdfViewerUrl } = require('../../src/main/find-policy');

const ROOT = path.join(__dirname, '..', '..');
let tmp, renderer;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pdfviewer-test-'));
  renderer = path.join(tmp, 'renderer');
  fs.mkdirSync(path.join(renderer, 'pdf-viewer'), { recursive: true });
  fs.mkdirSync(path.join(renderer, 'vendor', 'runtime', 'pdfjs'), { recursive: true });
  fs.mkdirSync(path.join(renderer, 'css'), { recursive: true });
  fs.mkdirSync(path.join(renderer, 'js'), { recursive: true });
  fs.writeFileSync(path.join(renderer, 'pdf-viewer', 'viewer.html'), fs.readFileSync(path.join(ROOT, 'src/renderer/pdf-viewer/viewer.html')));
  fs.writeFileSync(path.join(renderer, 'pdf-viewer', 'app.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(renderer, 'vendor', 'runtime', 'pdfjs', 'pdf.mjs'), 'export {};');
  fs.writeFileSync(path.join(renderer, 'vendor', 'runtime', 'pdfjs', 'secret.exe'), 'nope');
  fs.writeFileSync(path.join(renderer, 'css', 'theme-tokens.css'), ':root{}');
  fs.writeFileSync(path.join(renderer, 'js', 'vex-icons.js'), 'const VexIcons = {};');
  fs.writeFileSync(path.join(tmp, 'outside.js'), 'secret');
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function make(extra) {
  return pv.createPdfViewer({
    rendererDir: renderer, isEnabled: () => true, owner: (c) => c.__owner !== false,
    look: () => ({ theme: 'midnight', guiStyle: 'firefox', lang: 'tr' }), ...(extra || {}),
  });
}
const guestWc = (id = 7, url = '') => ({ id, __owner: true, isDestroyed: () => false, getType: () => 'webview', getURL: () => url, loadURL: () => Promise.resolve() });

describe('the viewer address', () => {
  it('names the PDF and keeps a #page= or #zoom=', () => {
    const u = pv.viewerUrl('https://example.com/a b/c.pdf?x=1&y=2#page=3&zoom=150');
    expect(u.startsWith('vex-pdf://view/?u=')).toBe(true);
    expect(u.endsWith('#page=3&zoom=150')).toBe(true);
    expect(pv.parseViewerUrl(u)).toEqual({ original: 'https://example.com/a b/c.pdf?x=1&y=2', hash: 'page=3&zoom=150' });
  });
  it('reads a file: address and a Turkish name back', () => {
    const f = 'file:///C:/Users/Fadi/Belgeler/Öğrenci%20Meclisi.pdf';
    expect(pv.parseViewerUrl(pv.viewerUrl(f)).original).toBe(f);
  });
  it('knows nothing else for a viewer address', () => {
    for (const bad of ['https://example.com/', 'vex-pdf://other/?u=x', 'vex-pdf://view/', 'vex-pdf://view/?x=1', '', null]) expect(pv.parseViewerUrl(bad)).toBe(null);
  });
  it('recognises .pdf files and not other files', () => {
    expect(pv.isPdfFileUrl('file:///C:/a/b.PDF')).toBe(true);
    expect(pv.isPdfFileUrl('file:///C:/a/b.pdf#page=2')).toBe(true);
    expect(pv.isPdfFileUrl('file:///C:/a/b.pdf.html')).toBe(false);
    expect(pv.isPdfFileUrl('https://example.com/a.pdf')).toBe(false);
  });
  it('the window keeps the same two mappings (js/webview.js)', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    const original = 'https://example.com/a.pdf?id=1&x=2';
    const view = pv.viewerUrl(original, 'page=4');
    expect(WebviewManager.pdfOriginal(view)).toBe(original + '#page=4');
    expect(WebviewManager.pdfOriginal('https://example.com/a.pdf')).toBe(null);
    const file = 'file:///C:/docs/Rapor%20%C4%B1.pdf';
    expect(WebviewManager.viewerAddress(file)).toBe(pv.viewerUrl(file));
    expect(WebviewManager.viewerAddress(file + '#page=2')).toBe(pv.viewerUrl(file, 'page=2'));
    expect(WebviewManager.viewerAddress('file:///C:/docs/a.html')).toBe('file:///C:/docs/a.html');
    expect(WebviewManager.viewerAddress('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
  });
});

describe('catching a PDF page (onHeadersReceived)', () => {
  const details = (over) => ({ resourceType: 'mainFrame', statusCode: 200, url: 'https://example.com/a.pdf', responseHeaders: { 'Content-Type': ['application/pdf'] }, webContents: guestWc(), ...(over || {}) });
  function run(d, viewer = make()) {
    const answers = [];
    const taken = viewer.take(d, (a) => answers.push(a));
    return { taken, answers };
  }
  it('turns a PDF answer into a redirect to the viewer, whatever the case of the header', () => {
    const { taken, answers } = run(details({ responseHeaders: { 'content-type': ['Application/PDF; charset=binary'] } }));
    expect(taken).toBe(true);
    expect(answers).toHaveLength(1);
    expect(answers[0].statusLine).toMatch(/302/);
    expect(answers[0].responseHeaders.location[0]).toBe(pv.viewerUrl('https://example.com/a.pdf'));
    expect(answers[0].cancel).toBeUndefined();
  });
  it('carries the #page= the person asked for (the tab\'s own pending address)', () => {
    const d = details({ webContents: guestWc(7, 'https://example.com/a.pdf#page=9&zoom=200') });
    expect(run(d).answers[0].responseHeaders.location[0].endsWith('#page=9&zoom=200')).toBe(true);
    const other = details({ webContents: guestWc(7, 'https://example.com/other.pdf#page=9') });
    expect(run(other).answers[0].responseHeaders.location[0].includes('#')).toBe(false);
  });
  it('leaves everything that is not a PDF page alone', () => {
    const cases = [
      details({ responseHeaders: { 'Content-Type': ['text/html'] } }),
      details({ responseHeaders: { 'Content-Type': ['application/pdf'], 'Content-Disposition': ['attachment; filename="a.pdf"'] } }),
      details({ resourceType: 'subFrame' }),
      details({ resourceType: 'xhr' }),
      details({ statusCode: 404 }),
      details({ statusCode: 302 }),
      details({ url: 'file:///C:/a.pdf' }),
      details({ webContents: null }),
      details({ webContents: { ...guestWc(), __owner: false } }),
      details({ webContents: { ...guestWc(), getType: () => 'window' } }),
    ];
    for (const d of cases) expect(run(d).taken).toBe(false);
  });
  it('an inline filename is still a PDF page', () => {
    expect(run(details({ responseHeaders: { 'Content-Type': ['application/pdf'], 'Content-Disposition': ['inline; filename="a.pdf"'] } })).taken).toBe(true);
  });
  it('is off when the viewer is switched off', () => { expect(run(details(), make({ isEnabled: () => false })).taken).toBe(false); });
  it('lets one load through to the browser\'s viewer, once', () => {
    const viewer = make();
    viewer.allowOnce(7, 'https://example.com/a.pdf#page=2');
    expect(run(details(), viewer).taken).toBe(false);
    expect(run(details(), viewer).taken).toBe(true);
    viewer.allowOnce(8, 'https://example.com/a.pdf');
    expect(run(details(), viewer).taken).toBe(true);     // another page's allowance is not this page's
  });
  it('every session\'s header handler in main.js asks it first', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
    const handlers = (src.match(/webRequest\.onHeadersReceived\(\(details, callback\) => \{/g) || []).length;
    const asked = (src.match(/if \(_pdfViewer\.take\(details, callback\)\) return;/g) || []).length;
    expect(handlers).toBeGreaterThanOrEqual(7);
    expect(asked).toBe(handlers);
  });
  it('is a privileged scheme in main.js', () => {
    expect(fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8')).toMatch(/scheme: 'vex-pdf', privileges: \{ standard: true, secure: true, supportFetchAPI: true \}/);
  });
});

describe('what the vex-pdf scheme serves', () => {
  function handlerFor(fetch, partition = 'persist:main') {
    const ses = { fetch };
    return make().makeHandler(ses, partition);
  }
  const ask = (handler, url, headers) => handler(new Request(url, { headers }));

  it('serves the page with the theme, the language, the persistence flag and a locked-down policy', async () => {
    const res = await ask(handlerFor(async () => { throw new Error('no fetch'); }), 'vex-pdf://view/?u=https%3A%2F%2Fx%2Fa.pdf');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<html lang="tr" data-theme="midnight" data-gui-style="firefox">');
    expect(html).toContain('<meta name="vex-persist" content="1">');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' blob: data:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-eval(?!')/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('a private or Tor session\'s page says it keeps nothing', async () => {
    for (const partition of ['vexpriv-abc', 'tor-123', 'otr-9']) {
      const html = await (await ask(handlerFor(async () => null, partition), 'vex-pdf://view/')).text();
      expect(html).toContain('<meta name="vex-persist" content="0">');
    }
  });
  it('refuses a theme or language that is not a plain word (it goes into the page)', async () => {
    const evil = make({ look: () => ({ theme: '"><script>x</script>', guiStyle: 'a b', lang: 'zz9' }) }).makeHandler({ fetch: async () => null }, 'persist:main');
    const html = await (await ask(evil, 'vex-pdf://view/')).text();
    expect(html).toContain('<html lang="en" data-theme="oxford" data-gui-style="classic">');
  });
  it('reads the PDF through THE SAME session, with its cookies, and passes a range on', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return new Response('PARTIAL', { status: 206, headers: { 'content-type': 'application/pdf', 'content-range': 'bytes 0-6/100', 'accept-ranges': 'bytes', 'content-length': '7', 'set-cookie': 'a=b', 'x-secret': 'no' } }); };
    const res = await ask(handlerFor(fetch), 'vex-pdf://view/doc?u=' + encodeURIComponent('https://example.com/a.pdf?id=5'), { range: 'bytes=0-6' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.com/a.pdf?id=5');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.headers.range).toBe('bytes=0-6');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-6/100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('set-cookie')).toBe(null);
    expect(res.headers.get('x-secret')).toBe(null);
    expect(await res.text()).toBe('PARTIAL');
  });
  it('says so plainly when the site cannot be reached or refuses', async () => {
    const down = await ask(handlerFor(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }), 'vex-pdf://view/doc?u=' + encodeURIComponent('https://nowhere.test/a.pdf'));
    expect(down.status).toBe(502);
    expect(await down.text()).toMatch(/could not be fetched/);
    const refused = await ask(handlerFor(async () => new Response('no', { status: 403 })), 'vex-pdf://view/doc?u=' + encodeURIComponent('https://example.com/a.pdf'));
    expect(refused.status).toBe(403);
  });
  it('fetches only web and file addresses, and only with an address given', async () => {
    const h = handlerFor(async () => { throw new Error('must not fetch'); });
    for (const u of ['javascript:alert(1)', 'data:application/pdf;base64,AA', 'chrome://gpu', 'ftp://x/a.pdf', 'vex://start']) {
      expect((await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(u))).status).toBe(400);
    }
    expect((await ask(h, 'vex-pdf://view/doc')).status).toBe(400);
  });
  it('reads a .pdf file in ranges, and nothing that is not a .pdf', async () => {
    const file = path.join(tmp, 'doc.pdf');
    fs.writeFileSync(file, '0123456789');
    const { pathToFileURL } = require('url');
    const h = handlerFor(async () => { throw new Error('a file is not fetched'); });
    const whole = await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(file).href));
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('0123456789');
    const part = await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(file).href), { range: 'bytes=2-4' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    const tail = await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(file).href), { range: 'bytes=-3' });
    expect(await tail.text()).toBe('789');
    const past = await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(file).href), { range: 'bytes=50-60' });
    expect(past.status).toBe(416);
    const other = path.join(tmp, 'secret.txt');
    fs.writeFileSync(other, 'x');
    expect((await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(other).href))).status).toBe(400);
    expect((await ask(h, 'vex-pdf://view/doc?u=' + encodeURIComponent(pathToFileURL(path.join(tmp, 'missing.pdf')).href))).status).toBe(404);
  });
  it('serves only its own folders, and only the kinds of file the viewer uses', async () => {
    const h = handlerFor(async () => null);
    expect((await ask(h, 'vex-pdf://view/app/app.js')).status).toBe(200);
    expect((await ask(h, 'vex-pdf://view/app/app.js')).headers.get('content-type')).toMatch(/javascript/);
    expect((await ask(h, 'vex-pdf://view/lib/pdf.mjs')).status).toBe(200);
    expect((await ask(h, 'vex-pdf://view/css/theme-tokens.css')).status).toBe(200);
    expect((await ask(h, 'vex-pdf://view/icons.js')).status).toBe(200);
    for (const bad of ['vex-pdf://view/lib/secret.exe', 'vex-pdf://view/app/..%2F..%2Foutside.js', 'vex-pdf://view/lib/%2e%2e/%2e%2e/outside.js', 'vex-pdf://view/other/x.js', 'vex-pdf://view/js/main.js', 'vex-pdf://other/app/app.js', 'vex-pdf://view/app/missing.js']) {
      expect([400, 404]).toContain((await ask(h, bad)).status);
    }
  });
});

describe('what the viewer page may ask main to do', () => {
  function setup(over) {
    const handlers = new Map();
    const ipcMain = { handle: (c, fn) => handlers.set(c, fn) };
    const calls = { placeMarks: [], fillForm: [], rotate: [], saveDialog: [], loadURL: [], downloadURL: [], shown: [], print: 0 };
    const written = new Map();
    const fsImpl = {
      existsSync: (p) => written.has(p) || (over && over.exists && over.exists.has(p)),
      promises: {
        stat: async () => ({ size: 100 }), readFile: async () => Buffer.from('%PDF-1.4 original'),
        writeFile: async (p, b) => { written.set(p, b); }, rename: async (a, b) => { written.set(b, written.get(a)); written.delete(a); }, copyFile: async (a, b) => { written.set(b, Buffer.from('copy')); },
      },
    };
    const tk = {
      fillForm: async (bytes, req) => { calls.fillForm.push(req); return { bytes: Buffer.from('FILLED') }; },
      placeMarks: async (bytes, req) => { calls.placeMarks.push(req); return { bytes: Buffer.from('MARKED'), marks: req.marks.length }; },
      rotate: async (bytes, req) => { calls.rotate.push(req); return { bytes: Buffer.from('ROTATED') }; },
    };
    const dialog = { showSaveDialog: async (...a) => { calls.saveDialog.push(a[a.length - 1]); return (over && over.picked) || { canceled: false, filePath: path.join(os.tmpdir(), 'picked.pdf') }; } };
    const viewer = make();
    const sender = { id: 7, session: { fetch: async () => new Response('%PDF-1.4 fetched', { headers: { 'content-length': '16' }, status: 200 }) }, loadURL: async (u) => { calls.loadURL.push(u); }, downloadURL: (u) => calls.downloadURL.push(u), print: (o, cb) => { calls.print++; cb(true, ''); } };
    pv.registerPdfViewerIpc({ ipcMain, dialog, windowFor: () => null, viewer, toolkit: tk, fsImpl, downloadsDir: () => path.join(os.tmpdir(), 'Downloads'), shell: { showItemInFolder: (p) => calls.shown.push(p) } });
    const event = (url, parent = null) => ({ sender, senderFrame: { url, parent } });
    return { handlers, calls, written, event, viewer, sender };
  }
  const PAGE = pv.viewerUrl('https://example.com/a.pdf');

  it('answers the viewer page, and nobody else', async () => {
    const s = setup();
    const req = { marks: [{ kind: 'text', page: 1 }] };
    for (const url of ['https://evil.example/', 'vex-pdf://view/doc?u=x', 'file:///C:/a.html', 'vex://start', '']) {
      const r = await s.handlers.get('pdfview:save-copy')(s.event(url), req);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Only the PDF viewer/);
    }
    const r = await s.handlers.get('pdfview:save-copy')(s.event(PAGE, { url: 'parent' }), req);
    expect(r.ok).toBe(false);                      // a frame inside another page, even with the viewer's address
    expect(s.calls.placeMarks).toHaveLength(0);
    for (const channel of ['pdfview:download', 'pdfview:open-native', 'pdfview:print', 'pdfview:reveal']) expect((await s.handlers.get(channel)(s.event('https://evil.example/'))).ok).toBe(false);
  });
  it('saves a copy: the form answers first, then the marks, then the turn, where the person picked', async () => {
    const s = setup();
    const r = await s.handlers.get('pdfview:save-copy')(s.event(PAGE), { name: 'Rapor', values: { ad: 'Fadi' }, marks: [{ kind: 'text', page: 1 }], rotate: 90 });
    expect(r).toMatchObject({ ok: true, cancelled: false, name: 'picked.pdf', marks: 1 });
    expect(s.calls.fillForm).toHaveLength(1);
    expect(s.calls.placeMarks).toHaveLength(1);
    expect(s.calls.rotate[0]).toMatchObject({ spec: 'all', degrees: 90 });
    expect(s.written.get(path.join(os.tmpdir(), 'picked.pdf')).toString()).toBe('ROTATED');
    expect(s.calls.saveDialog[0].defaultPath).toMatch(/Rapor-annotated\.pdf$/);
    expect((await s.handlers.get('pdfview:reveal')(s.event(PAGE))).ok).toBe(true);
    expect(s.calls.shown[0]).toBe(path.join(os.tmpdir(), 'picked.pdf'));
  });
  it('reads the PDF again through the page\'s own session, never a file the page names', async () => {
    const s = setup();
    let fetched = null;
    s.sender.session.fetch = async (u, init) => { fetched = { u, init }; return new Response('%PDF-1.4 x', { headers: { 'content-length': '10' } }); };
    await s.handlers.get('pdfview:save-copy')(s.event(PAGE), { marks: [{ kind: 'line', page: 1 }] });
    expect(fetched.u).toBe('https://example.com/a.pdf');
    expect(fetched.init.credentials).toBe('include');
  });
  it('nothing to save is said, and a cancelled dialog writes nothing', async () => {
    const s = setup();
    expect((await s.handlers.get('pdfview:save-copy')(s.event(PAGE), {})).error).toMatch(/nothing to save/);
    const c = setup({ picked: { canceled: true } });
    const r = await c.handlers.get('pdfview:save-copy')(c.event(PAGE), { marks: [{ kind: 'line', page: 1 }] });
    expect(r).toMatchObject({ ok: true, cancelled: true });
    expect(c.written.size).toBe(0);
  });
  it('never writes over the PDF being read', async () => {
    const { pathToFileURL } = require('url');
    const file = path.join(os.tmpdir(), 'Reading.pdf');
    const s = setup({ picked: { canceled: false, filePath: file.toUpperCase().replace('.PDF', '.pdf') } });
    // A file: PDF, and the person picked its own path (any case).
    const r = await s.handlers.get('pdfview:save-copy')(s.event(pv.viewerUrl(pathToFileURL(file).href)), { marks: [{ kind: 'line', page: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/replace the PDF you are reading/);
    expect(s.written.size).toBe(0);
  });
  it('a copy in Downloads takes a name that is free', async () => {
    const dl = path.join(os.tmpdir(), 'Downloads');
    const s = setup({ exists: new Set([path.join(dl, 'a-annotated.pdf')]) });
    const r = await s.handlers.get('pdfview:save-copy')(s.event(PAGE), { marks: [{ kind: 'line', page: 1 }], toDownloads: true });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('a-annotated (2).pdf');
    expect(s.calls.saveDialog).toHaveLength(0);
  });
  it('a PDF too large to mark up is said plainly', async () => {
    const s = setup();
    s.sender.session.fetch = async () => new Response('x', { headers: { 'content-length': String(80 * 1024 * 1024) } });
    expect((await s.handlers.get('pdfview:save-copy')(s.event(PAGE), { marks: [{ kind: 'line', page: 1 }] })).error).toMatch(/larger than 60 MB/);
  });
  it('the download of a web PDF goes through the page\'s downloads, the browser\'s viewer lets one load through', async () => {
    const s = setup();
    expect(await s.handlers.get('pdfview:download')(s.event(PAGE))).toMatchObject({ ok: true, viaDownloads: true });
    expect(s.calls.downloadURL).toEqual(['https://example.com/a.pdf']);
    await s.handlers.get('pdfview:open-native')(s.event(pv.viewerUrl('https://example.com/a.pdf', 'page=3')));
    expect(s.calls.loadURL).toEqual(['https://example.com/a.pdf#page=3']);
    expect(s.viewer.consumeBypass(7, 'https://example.com/a.pdf')).toBe(true);
  });
  it('print asks the page\'s own print', async () => {
    const s = setup();
    expect((await s.handlers.get('pdfview:print')(s.event(PAGE))).ok).toBe(true);
    expect(s.calls.print).toBe(1);
  });
});

describe('the channels and their contracts', () => {
  it('a guest page can call the viewer\'s channels, never the interface-only ones', () => {
    for (const c of ['pdfview:save-copy', 'pdfview:download', 'pdfview:open-native', 'pdfview:print', 'pdfview:reveal']) {
      expect(policy.UI_ONLY_CHANNELS.has(c)).toBe(false);
    }
    for (const c of ['pdfview:set-enabled', 'pdfview:forget-places']) expect(policy.UI_ONLY_CHANNELS.has(c)).toBe(true);
    const src = fs.readFileSync(path.join(ROOT, 'src/main/ipc-policy.js'), 'utf8');
    expect(src).toMatch(/GUEST_CHANNELS = new Set\([\s\S]*'pdfview:save-copy', 'pdfview:download', 'pdfview:open-native', 'pdfview:print', 'pdfview:reveal'/);
  });
  it('the save request is bounded', () => {
    expect(() => validate('pdfview:save-copy', [{ name: 'a', marks: [{ kind: 'line' }], values: { a: 'b', c: true }, signature: 'AAAA', rotate: 90, toDownloads: false }])).not.toThrow();
    expect(() => validate('pdfview:save-copy', [{}])).not.toThrow();
    expect(() => validate('pdfview:save-copy', [{ marks: new Array(401).fill({}) }])).toThrow();
    expect(() => validate('pdfview:save-copy', [{ marks: ['not an object'] }])).toThrow();
    expect(() => validate('pdfview:save-copy', [{ values: { a: 5 } }])).toThrow();
    expect(() => validate('pdfview:save-copy', [{ signature: 'x'.repeat(600 * 1024) }])).toThrow();
    expect(() => validate('pdfview:save-copy', [])).toThrow();
    expect(() => validate('pdfview:print', ['extra'])).toThrow();
    expect(() => validate('pdfview:set-enabled', ['yes'])).toThrow();
    expect(() => validate('pdfview:set-enabled', [true])).not.toThrow();
  });
  it('Ctrl+F and the zoom keys belong to the viewer while it has the focus', () => {
    const url = pv.viewerUrl('https://example.com/a.pdf');
    expect(isPdfViewerUrl(url)).toBe(true);
    expect(isPdfViewerUrl('https://example.com/')).toBe(false);
    expect(guestOwnsFind(url)).toBe(true);
    for (const key of ['=', '+', '-', '0']) {
      expect(shortcutFor({ type: 'keyDown', control: true, key }, { ownsZoom: true })).toBe(null);
      expect(shortcutFor({ type: 'keyDown', control: true, key }, { ownsZoom: false })).not.toBe(null);
    }
    expect(shortcutFor({ type: 'keyDown', control: true, key: 'f' }, { ownsFind: true })).toBe(null);
    expect(shortcutFor({ type: 'keyDown', control: true, key: 't' }, { ownsZoom: true })).toEqual({ channel: 'new-tab' });
  });
});

describe('marks saved into a copy (pdf-toolkit placeMarks)', () => {
  async function pdf(pages = 2, rotation = 0) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) { const p = doc.addPage([400, 300]); p.setRotation(degrees(rotation)); p.drawText('Hello page ' + (i + 1), { x: 40, y: 200, size: 18, font }); }
    return Buffer.from(await doc.save());
  }
  const base = { page: 1, color: '#3355cc' };
  const every = () => [
    { ...base, kind: 'highlight', rects: [{ x: 40, y: 195, w: 120, h: 22 }], color: '#ffe44d' },
    { ...base, kind: 'underline', lines: [{ x1: 40, y1: 196, x2: 160, y2: 196 }], width: 1 },
    { ...base, kind: 'strike', lines: [{ x1: 40, y1: 206, x2: 160, y2: 206 }] },
    { ...base, kind: 'ink', points: [[10, 10], [30, 40], [60, 20], [90, 60]], width: 2.5 },
    { ...base, kind: 'text', x: 50, y: 120, size: 14, text: 'Merhaba Dünya', angle: 0, w: 150 },
    { ...base, kind: 'rect', x: 20, y: 20, w: 80, h: 40, width: 2 },
    { ...base, kind: 'ellipse', x: 120, y: 20, w: 80, h: 40 },
    { ...base, kind: 'line', x1: 220, y1: 20, x2: 300, y2: 60, arrow: true, width: 2 },
  ];
  it('puts every kind of mark on the page and keeps the document a PDF with the same pages', async () => {
    const out = await toolkit.placeMarks(await pdf(), { marks: every() }, 'a.pdf');
    expect(out.marks).toBe(8);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(out.bytes.length).toBeGreaterThan((await pdf()).length);
  });
  it('draws Turkish letters in a note, and refuses what no font can draw', async () => {
    const ok = await toolkit.placeMarks(await pdf(), { marks: [{ ...base, kind: 'text', x: 50, y: 120, size: 14, text: 'şğıİÖÜç' }] }, 'a.pdf');
    expect(ok.marks).toBe(1);
    await expect(toolkit.placeMarks(await pdf(), { marks: [{ ...base, kind: 'text', x: 50, y: 120, size: 14, text: 'x' }] , ascii: true }, 'a.pdf')).resolves.toBeTruthy();
  });
  it('places a signature picture, turned with a turned page', async () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    for (const rotation of [0, 90, 180, 270]) {
      const out = await toolkit.placeMarks(await pdf(1, rotation), { marks: [{ ...base, kind: 'signature', x: 60, y: 60, w: 100, h: 40, angle: rotation }], signature: png }, 'a.pdf');
      expect(out.signed).toBe(1);
    }
    await expect(toolkit.placeMarks(await pdf(), { marks: [{ ...base, kind: 'signature', x: 60, y: 60, w: 100, h: 40 }] }, 'a.pdf')).rejects.toThrow(/signature first/);
    await expect(toolkit.placeMarks(await pdf(), { marks: [{ ...base, kind: 'signature', x: 60, y: 60, w: 100, h: 40 }], signature: Uint8Array.from([1, 2, 3]) }, 'a.pdf')).rejects.toThrow(/PNG/);
  });
  it('refuses a mark that is not valid, saying which one and why', async () => {
    const bytes = await pdf();
    const bad = [
      [{ ...base, kind: 'stamp' }, /kind Vex cannot save/],
      [{ ...base, kind: 'rect', x: 20, y: 20, w: 80, h: 40, page: 3 }, /page 3, but this PDF has 2 pages/],
      [{ ...base, kind: 'rect', x: 5000, y: 20, w: 80, h: 40 }, /outside the page/],
      [{ ...base, kind: 'rect', x: 20, y: 20, w: 80, h: 40, color: 'red' }, /colour/],
      [{ ...base, kind: 'rect', x: 20, y: 20, w: 0, h: 40 }, /width is out of range/],
      [{ ...base, kind: 'text', x: 20, y: 20, size: 14, text: '   ' }, /no text/],
      [{ ...base, kind: 'text', x: 20, y: 20, size: 2, text: 'hi' }, /text size/],
      [{ ...base, kind: 'text', x: 20, y: 20, size: 14, text: 'x'.repeat(501) }, /more than 500/],
      [{ ...base, kind: 'highlight', rects: [] }, /no highlighted text/],
      [{ ...base, kind: 'ink', points: [[1, 1]] }, /no length/],
      [{ ...base, kind: 'line', x1: 1, y1: 1, x2: Infinity, y2: 1 }, /outside the page/],
      [{ ...base, kind: 'text', x: 20, y: 20, size: 14, text: 'hi', angle: 45 }, /angle/],
      [null, /not valid/],
    ];
    for (const [mark, why] of bad) await expect(toolkit.placeMarks(bytes, { marks: [mark] }, 'a.pdf')).rejects.toThrow(why);
    await expect(toolkit.placeMarks(bytes, { marks: [] }, 'a.pdf')).rejects.toThrow(/at least one mark/);
    await expect(toolkit.placeMarks(bytes, { marks: new Array(401).fill({ ...base, kind: 'line', x1: 1, y1: 1, x2: 5, y2: 5 }) }, 'a.pdf')).rejects.toThrow(/more than 400/);
    await expect(toolkit.placeMarks(Buffer.from('not a pdf at all'), { marks: [{ ...base, kind: 'line', x1: 1, y1: 1, x2: 5, y2: 5 }] }, 'a.pdf')).rejects.toThrow(/not a PDF/);
  });
});
