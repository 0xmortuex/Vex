// @vitest-environment jsdom
// Vex's own image viewer, main side (src/main/image-viewer.js): the addresses, what counts as a picture, what the viewer page is
// served, how a picture is read (through the tab's own session), and what the viewer may ask main to do.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const viewer = require('../../src/main/image-viewer');
const { createDocViewers } = require('../../src/main/doc-viewers');
const policy = require('../../src/main/ipc-policy');
const schemas = require('../../src/main/ipc-schemas');
const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-iv-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function setup(over = {}) {
  const docs = createDocViewers({ owner: () => ({}) });
  const iv = viewer.createImageViewer({ rendererDir: RENDERER, docViewers: docs, isEnabled: over.isEnabled, look: over.look });
  return { docs, iv };
}
const asRequest = (url, headers) => ({ url, headers: new Headers(headers || {}) });

describe('addresses', () => {
  it('the viewer address holds the original and gives it back', () => {
    const u = viewer.viewerUrl('https://a.test/x/y z.png?q=1#top');
    expect(u).toBe('vex-image://view/?u=' + encodeURIComponent('https://a.test/x/y z.png?q=1') + '#top');
    expect(viewer.parseViewerUrl(u)).toEqual({ original: 'https://a.test/x/y z.png?q=1', hash: 'top' });
  });
  it('only the viewer page is a viewer address, not /doc or the files it loads', () => {
    expect(viewer.parseViewerUrl('vex-image://view/doc?u=https%3A%2F%2Fa.test%2Fx.png')).toBe(null);
    expect(viewer.parseViewerUrl('vex-image://view/app/app.js')).toBe(null);
    expect(viewer.parseViewerUrl('https://a.test/')).toBe(null);
    expect(viewer.parseViewerUrl('vex-image://view/')).toBe(null);
  });
  it('the window keeps a twin of both (js/webview.js) and the two agree', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    for (const original of ['https://a.test/p.png', 'file:///C:/Users/me/My%20Pictures/a b.jpg', 'https://a.test/x.png?w=100&h=2']) {
      const u = viewer.viewerUrl(original);
      expect(WebviewManager.imageOriginal(u)).toBe(original);
      expect(viewer.parseViewerUrl(u).original).toBe(original);
    }
    expect(WebviewManager.imageOriginal('https://a.test/')).toBe(null);
    expect(WebviewManager.imageOriginal('vex-image://view/doc?u=x')).toBe(null);
    // a file picture goes to the viewer from the window, and both sides call the same files pictures
    for (const f of ['file:///C:/a/b.png', 'file:///C:/a/b.JPG', 'file:///C:/a/b.svg#x', 'file:///C:/a/b.webp?v=1']) {
      expect(viewer.isImageFileUrl(f)).toBe(true);
      expect(WebviewManager.imageOriginal(WebviewManager.imageViewerAddress(f))).toBe(f.replace(/\?.*$/, (m) => m));
    }
    for (const f of ['file:///C:/a/b.pdf', 'file:///C:/a/b.txt', 'https://a.test/b.png', 'file:///C:/a/png']) {
      expect(viewer.isImageFileUrl(f)).toBe(false);
      expect(WebviewManager.imageViewerAddress(f)).toBe(f);
    }
  });
  it('the window leaves a file picture alone when the viewer is switched off', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    window.VexImageViewerOff = true;
    try { expect(WebviewManager.imageViewerAddress('file:///C:/a/b.png')).toBe('file:///C:/a/b.png'); } finally { delete window.VexImageViewerOff; }
  });
});

describe('what counts as a picture', () => {
  it('goes by Content-Type', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'IMAGE/PNG; charset=binary']) expect(viewer.isImageType(t), t).toBe(true);
    for (const t of ['text/html', 'application/pdf', 'application/octet-stream', 'image/tiff', 'video/mp4', '', undefined]) expect(viewer.isImageType(t), String(t)).toBe(false);
  });
  it('registers itself with the shared catch and follows the switch', () => {
    let on = true;
    const { docs } = setup({ isEnabled: () => on });
    const d = { resourceType: 'mainFrame', method: 'GET', statusCode: 200, url: 'https://a.test/p', responseHeaders: { 'content-type': ['image/webp'] }, webContents: { id: 1, isDestroyed: () => false, getType: () => 'webview', getURL: () => '' } };
    const cb = vi.fn();
    expect(docs.take(d, cb)).toBe(true);
    expect(cb.mock.calls[0][0].responseHeaders.location[0]).toBe(viewer.viewerUrl('https://a.test/p'));
    on = false;
    expect(docs.take(d, vi.fn())).toBe(false);
  });
});

describe('the page and its files', () => {
  it('serves the page with the saved theme, look and language, and the policy that keeps it inside itself', async () => {
    const { iv } = setup({ look: () => ({ theme: 'sakura', guiStyle: 'firefox', lang: 'tr' }) });
    const res = await iv.makeHandler({}, 'persist:main')(asRequest('vex-image://view/?u=x'));
    const html = await res.text();
    expect(html).toContain('<html lang="tr" data-theme="sakura" data-gui-style="firefox">');
    expect(html).toContain('<meta name="vex-persist" content="1">');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|https?:/);
    expect(csp).toContain("connect-src 'self' blob: data:");
  });
  it('a private (in-memory) session gets a page that keeps nothing', async () => {
    const { iv } = setup();
    const html = await (await iv.makeHandler({}, 'otr-123')(asRequest('vex-image://view/'))).text();
    expect(html).toContain('<meta name="vex-persist" content="0">');
  });
  it('a hostile theme value cannot break out of the attribute', async () => {
    const { iv } = setup({ look: () => ({ theme: 'x"><script>', guiStyle: 'a b', lang: 'zz9' }) });
    const html = await (await iv.makeHandler({}, 'persist:main')(asRequest('vex-image://view/'))).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-theme="oxford"');
  });
  it('serves its own files from three folders and nothing above them', async () => {
    const handler = setup().iv.makeHandler({}, 'persist:main');
    expect((await handler(asRequest('vex-image://view/app/app.js'))).status).toBe(200);
    expect((await handler(asRequest('vex-image://view/css/theme-tokens.css'))).headers.get('content-type')).toMatch(/text\/css/);
    expect((await handler(asRequest('vex-image://view/icons.js'))).status).toBe(200);
    for (const bad of ['/app/../../main.js', '/app/%2e%2e/%2e%2e/main.js', '/css/..%2f..%2fjs%2fwebview.js', '/nothing', '/app/viewer.html.bak']) {
      expect((await handler(asRequest('vex-image://view' + bad))).status, bad).toBe(404);
    }
    expect((await setup().iv.makeHandler({}, 'x')(asRequest('vex-image://elsewhere/'))).status).toBe(404);
  });
});

describe('reading the picture', () => {
  it('a web picture is fetched through the SAME session the tab runs in, and handed back inert', async () => {
    const body = new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '4' } });
    const ses = { fetch: vi.fn(async () => body) };
    const handler = setup().iv.makeHandler(ses, 'persist:main');
    const res = await handler(asRequest('vex-image://view/doc?u=' + encodeURIComponent('https://a.test/p.png')));
    expect(ses.fetch).toHaveBeenCalledTimes(1);
    expect(ses.fetch.mock.calls[0][0]).toBe('https://a.test/p.png');
    expect(ses.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', redirect: 'follow' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });
  it('a refused or failed fetch says so in a way the page can show', async () => {
    const down = setup().iv.makeHandler({ fetch: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } }, 'persist:main');
    const r1 = await down(asRequest('vex-image://view/doc?u=' + encodeURIComponent('https://a.test/p.png')));
    expect(r1.status).toBe(502);
    expect(r1.headers.get('x-vex-error')).toBe('fetch');
    const gone = setup().iv.makeHandler({ fetch: async () => new Response('no', { status: 404 }) }, 'persist:main');
    const r2 = await gone(asRequest('vex-image://view/doc?u=' + encodeURIComponent('https://a.test/p.png')));
    expect(r2.headers.get('x-vex-status')).toBe('404');
  });
  it('only a web or an image-file address can be read', async () => {
    const handler = setup().iv.makeHandler({ fetch: vi.fn() }, 'persist:main');
    for (const u of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://a.test/x.png', 'file:///C:/Windows/win.ini']) {
      const res = await handler(asRequest('vex-image://view/doc?u=' + encodeURIComponent(u)));
      expect(res.status, u).toBeGreaterThanOrEqual(400);
    }
    expect((await handler(asRequest('vex-image://view/doc'))).status).toBe(400);
  });
  it('a picture file is read from disk with its type from its name', async () => {
    const f = path.join(dir, 'pic.JPG');
    fs.writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const handler = setup().iv.makeHandler({}, 'persist:main');
    const res = await handler(asRequest('vex-image://view/doc?u=' + encodeURIComponent(require('node:url').pathToFileURL(f).href)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Number(res.headers.get('content-length'))).toBe(4);
    const missing = await handler(asRequest('vex-image://view/doc?u=' + encodeURIComponent(require('node:url').pathToFileURL(path.join(dir, 'gone.png')).href)));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-vex-error')).toBe('missing');
  });
});

describe('what the viewer may ask main to do', () => {
  function ipc(extra = {}) {
    const handlers = new Map();
    const docs = createDocViewers({ owner: () => ({}) });
    const iv = viewer.createImageViewer({ rendererDir: RENDERER, docViewers: docs });
    const clipboard = { writeImage: vi.fn(), writeText: vi.fn() };
    const nativeImage = { createFromBuffer: vi.fn((b) => ({ isEmpty: () => b.length < 3 })) };
    const shell = { showItemInFolder: vi.fn() };
    const dialog = { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: path.join(dir, 'out.png') })) };
    viewer.registerImageViewerIpc({
      ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, dialog, windowFor: () => null, viewer: iv, docViewers: docs, clipboard, nativeImage, shell,
      downloadsDir: () => dir, ...extra,
    });
    const event = (url, sender, parent = null) => ({ senderFrame: { url, parent }, sender: sender || { id: 5, downloadURL: vi.fn(), loadURL: vi.fn(async () => {}) } });
    return { handlers, docs, clipboard, nativeImage, shell, dialog, event };
  }
  const VIEW = (u) => viewer.viewerUrl(u);

  it('registers every channel the preload bridge calls, and each is known to the IPC policy', () => {
    const { handlers } = ipc();
    const channels = ['save-copy', 'download', 'open-native', 'copy-image', 'copy-address', 'reveal', 'siblings'].map((n) => 'imageview:' + n);
    for (const c of channels) { expect(handlers.has(c), c).toBe(true); expect(schemas.schemas.has(c), c + ' has a payload contract').toBe(true); }
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc-policy.js'), 'utf8');
    for (const c of channels) expect(source, c).toContain("'" + c + "'");
    for (const c of ['imageview:set-enabled', 'imageview:forget-settings']) expect(schemas.schemas.has(c), c).toBe(true);
    const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload-webview.js'), 'utf8');
    for (const c of channels) expect(preload, c).toContain("'" + c + "'");
  });
  it('bytes go as an ArrayBuffer only (the policy would walk and stringify a typed array)', () => {
    expect(() => schemas.validate('imageview:copy-image', [{ bytes: new ArrayBuffer(8) }])).not.toThrow();
    expect(() => schemas.validate('imageview:copy-image', [{ bytes: new Uint8Array(8) }])).toThrow();
    expect(() => schemas.validate('imageview:save-copy', [{ bytes: new ArrayBuffer(8), type: 'png' }])).not.toThrow();
    expect(() => schemas.validate('imageview:save-copy', [{ bytes: new ArrayBuffer(8), type: 'exe' }])).toThrow();
    expect(() => schemas.validate('imageview:copy-address', ['extra'])).toThrow();
  });
  it('every channel refuses anyone who is not the viewer page', async () => {
    const { handlers, event } = ipc();
    for (const [c, fn] of handlers) {
      const r = await fn(event('https://evil.test/'), { bytes: new ArrayBuffer(8), type: 'png' });
      expect(r.ok, c).toBe(false);
      expect(r.error, c).toMatch(/Only the image viewer/);
      const sub = await fn(event(VIEW('https://a.test/p.png'), undefined, {}), { bytes: new ArrayBuffer(8), type: 'png' });
      expect(sub.ok, c + ' from a sub-frame').toBe(false);
    }
  });
  it('copy address gives the tab\'s own address, not anything the page sends', async () => {
    const { handlers, clipboard, event } = ipc();
    expect(await handlers.get('imageview:copy-address')(event(VIEW('https://a.test/p.png?x=1')), 'https://evil.test/')).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('https://a.test/p.png?x=1');
  });
  it('copy image puts a decoded picture on the clipboard and refuses nothing or too much', async () => {
    const { handlers, clipboard, nativeImage, event } = ipc();
    const e = event(VIEW('https://a.test/p.png'));
    expect((await handlers.get('imageview:copy-image')(e, { bytes: new Uint8Array([1, 2, 3, 4, 5]).buffer })).ok).toBe(true);
    expect(clipboard.writeImage).toHaveBeenCalledTimes(1);
    expect((await handlers.get('imageview:copy-image')(e, { bytes: new ArrayBuffer(0) })).error).toMatch(/no picture/);
    expect((await handlers.get('imageview:copy-image')(e, { bytes: new ArrayBuffer(2) })).error).toMatch(/clipboard/);
    expect((await handlers.get('imageview:copy-image')(e, { bytes: new ArrayBuffer(viewer.SAVE_LIMIT + 1) })).error).toMatch(/larger than 64 MB/);
    expect(nativeImage.createFromBuffer).toHaveBeenCalled();
  });
  it('save as, for a web picture, is the page\'s own download, which is let through the viewer once', async () => {
    const { handlers, docs, event } = ipc();
    const sender = { id: 9, downloadURL: vi.fn() };
    const r = await handlers.get('imageview:download')(event(VIEW('https://a.test/p.png'), sender));
    expect(r).toMatchObject({ ok: true, viaDownloads: true });
    expect(sender.downloadURL).toHaveBeenCalledWith('https://a.test/p.png');
    expect(docs.consumeBypass(9, 'https://a.test/p.png')).toBe(true);
  });
  it('save as, for a file picture, copies it to where the person chooses and never onto itself', async () => {
    const { handlers, dialog, event } = ipc();
    const src = path.join(dir, 'in.png');
    fs.writeFileSync(src, 'PIXELS');
    const e = event(VIEW(require('node:url').pathToFileURL(src).href));
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(dir, 'copy.png') });
    expect((await handlers.get('imageview:download')(e)).ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'copy.png'), 'utf8')).toBe('PIXELS');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: src });
    expect((await handlers.get('imageview:download')(e)).error).toMatch(/file you are looking at/);
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await handlers.get('imageview:download')(e)).toMatchObject({ ok: true, cancelled: true });
  });
  it('a saved copy is a new file, with the extension of its format, and never replaces the picture', async () => {
    const { handlers, dialog, event } = ipc();
    const src = path.join(dir, 'in.png');
    fs.writeFileSync(src, 'PIXELS');
    const e = event(VIEW(require('node:url').pathToFileURL(src).href));
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    const r = await handlers.get('imageview:save-copy')(e, { bytes, type: 'jpeg', name: 'in.png', suffix: 'edited' });
    expect(r).toMatchObject({ ok: true, cancelled: false, name: 'out.png' });
    expect(dialog.showSaveDialog.mock.calls[0][0].defaultPath).toBe(path.join(dir, 'in-edited.jpg'));
    expect([...fs.readFileSync(path.join(dir, 'out.png'))]).toEqual([9, 8, 7]);
    expect(fs.existsSync(path.join(dir, 'out.png.vex-tmp'))).toBe(false);
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: src });
    expect((await handlers.get('imageview:save-copy')(e, { bytes, type: 'png' })).error).toMatch(/replace the picture/);
    expect(fs.readFileSync(src, 'utf8')).toBe('PIXELS');
    expect((await handlers.get('imageview:save-copy')(e, { bytes, type: 'gif' })).error).toMatch(/PNG, JPEG or WebP/);
  });
  it('a web picture\'s copy defaults to the downloads folder', async () => {
    const { handlers, dialog, event } = ipc();
    await handlers.get('imageview:save-copy')(event(VIEW('https://a.test/dir/photo.jpeg?x=1')), { bytes: new Uint8Array([1]).buffer, type: 'png', suffix: 'turned' });
    expect(dialog.showSaveDialog.mock.calls[0][0].defaultPath).toBe(path.join(dir, 'photo-turned.png'));
  });
  it('open in the browser\'s view lets that one navigation through and loads the original', async () => {
    const { handlers, docs, event } = ipc();
    const sender = { id: 3, loadURL: vi.fn(async () => {}) };
    expect((await handlers.get('imageview:open-native')(event(VIEW('https://a.test/p.png') + '#z', sender))).ok).toBe(true);
    expect(sender.loadURL).toHaveBeenCalledWith('https://a.test/p.png#z');
    expect(docs.consumeBypass(3, 'https://a.test/p.png')).toBe(true);
    const aborted = { id: 4, loadURL: vi.fn(async () => { throw new Error('ERR_ABORTED (-3) loading'); }) };
    expect((await handlers.get('imageview:open-native')(event(VIEW('https://a.test/q.png'), aborted))).ok).toBe(true);
  });
  it('the pictures beside a file picture, in natural order; none for a web picture', async () => {
    const { handlers, event } = ipc();
    for (const n of ['img10.png', 'img2.png', 'img1.PNG', 'notes.txt', 'a.svg']) fs.writeFileSync(path.join(dir, n), 'x');
    const url = require('node:url');
    const r = await handlers.get('imageview:siblings')(event(VIEW(url.pathToFileURL(path.join(dir, 'img2.png')).href)));
    expect(r.ok).toBe(true);
    expect(r.urls.map((u) => path.basename(url.fileURLToPath(u)))).toEqual(['a.svg', 'img1.PNG', 'img2.png', 'img10.png']);
    expect(r.index).toBe(2);
    expect(await handlers.get('imageview:siblings')(event(VIEW('https://a.test/p.png')))).toEqual({ ok: true, urls: [], index: -1 });
  });
  it('show in folder is for a file picture only', async () => {
    const { handlers, shell, event } = ipc();
    expect((await handlers.get('imageview:reveal')(event(VIEW('https://a.test/p.png')))).error).toMatch(/on this computer/);
    const f = path.join(dir, 'x.png');
    await handlers.get('imageview:reveal')(event(VIEW(require('node:url').pathToFileURL(f).href)));
    expect(shell.showItemInFolder).toHaveBeenCalledWith(f);
  });
});

describe('a link to a file picture inside a page', () => {
  it('is turned around to the viewer, unless the person asked for the browser\'s own view', () => {
    const { docs, iv } = setup();
    const handlers = {};
    const contents = { id: 4, isDestroyed: () => false, getType: () => 'webview', getURL: () => '', on: (n, fn) => { handlers[n] = fn; }, loadURL: vi.fn(async () => {}) };
    iv.watch(contents);
    const e = { preventDefault: vi.fn() };
    handlers['will-navigate'](e, 'file:///C:/p/a.png');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(contents.loadURL).toHaveBeenCalledWith(viewer.viewerUrl('file:///C:/p/a.png'));
    const e2 = { preventDefault: vi.fn() };
    handlers['will-navigate'](e2, 'https://a.test/a.png');
    handlers['will-navigate'](e2, 'file:///C:/p/a.txt');
    expect(e2.preventDefault).not.toHaveBeenCalled();
    docs.allowOnce(4, 'file:///C:/p/b.png');
    handlers['will-navigate'](e2, 'file:///C:/p/b.png');
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });
  it('is not attached to anything that is not a webview', () => {
    const { iv } = setup();
    const on = vi.fn();
    iv.watch({ getType: () => 'window', on });
    expect(on).not.toHaveBeenCalled();
  });
});
