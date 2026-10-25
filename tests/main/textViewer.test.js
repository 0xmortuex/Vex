// Vex's own viewer for text-like documents, main side (src/main/doc-viewers.js, src/main/text-viewer.js): what is caught, what is not,
// how the viewer page and the document are served, and who may call the docview:* channels.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createDocViewerRegistry } = require('../../src/main/doc-viewers');
const tv = require('../../src/main/text-viewer');
const policy = require('../../src/main/ipc-policy');
const { isDocViewerUrl, guestOwnsFind } = require('../../src/main/find-policy');

const ROOT = path.resolve(__dirname, '../..');

function guest(id = 5) { return { id, isDestroyed: () => false, getType: () => 'webview', getURL: () => 'https://example.com/data.json' }; }
function details(over = {}) {
  return { resourceType: 'mainFrame', method: 'GET', statusCode: 200, url: 'https://example.com/data.json', webContents: guest(), responseHeaders: { 'Content-Type': ['application/json; charset=utf-8'] }, ...over };
}
function makeRegistry(over = {}) {
  // The on/off switch belongs to the viewer's entry in the registry, not to the registry.
  const { isEnabled, ...registryDeps } = over;
  const registry = createDocViewerRegistry({ owner: () => ({}), ...registryDeps });
  const viewer = tv.createTextViewer({ rendererDir: path.join(ROOT, 'src/renderer'), registry, isEnabled, look: () => ({ theme: 'oxford', guiStyle: 'firefox', lang: 'tr' }) });
  return { registry, viewer };
}
function take(registry, d) {
  let answer = null;
  const taken = registry.take(d, (a) => { answer = a; });
  return { taken, answer };
}

describe('which responses become a document in the viewer', () => {
  it('turns a top-level JSON navigation into one redirect to the viewer', () => {
    const { registry } = makeRegistry();
    const { taken, answer } = take(registry, details());
    expect(taken).toBe(true);
    expect(answer.statusLine).toMatch(/302/);
    expect(answer.responseHeaders.location[0]).toBe('vex-doc://view/?u=' + encodeURIComponent('https://example.com/data.json'));
  });

  it('takes the kinds of text a server names, and sniffs text/plain later in the page', () => {
    const { registry } = makeRegistry();
    for (const type of ['application/json', 'application/ld+json', 'application/vnd.api+json', 'application/x-ndjson', 'application/xml', 'text/xml', 'application/atom-not+xml', 'text/csv',
      'text/tab-separated-values', 'text/markdown', 'text/plain; charset=utf-8', 'text/css', 'text/javascript', 'application/javascript', 'application/yaml', 'text/x-python', 'application/sql']) {
      expect(take(registry, details({ responseHeaders: { 'content-type': [type] } })).taken, type).toBe(true);
    }
  });

  it('never takes an HTML page, a picture, a PDF, a feed, a download or binary', () => {
    const { registry } = makeRegistry();
    for (const type of ['text/html', 'text/html; charset=utf-8', 'application/xhtml+xml', 'image/svg+xml', 'image/png', 'application/pdf', 'application/octet-stream', 'application/rss+xml', 'application/atom+xml', 'video/mp4', '']) {
      expect(take(registry, details({ responseHeaders: { 'content-type': [type] } })).taken, type).toBe(false);
    }
    expect(take(registry, details({ responseHeaders: { 'content-type': ['application/json'], 'content-disposition': ['attachment; filename=x.json'] } })).taken).toBe(false);
  });

  it('takes only the top-level navigation: a page\'s own fetch, XHR, frames and scripts get the raw bytes', () => {
    const { registry } = makeRegistry();
    for (const resourceType of ['xhr', 'subFrame', 'script', 'stylesheet', 'image', 'other', 'fetch', 'ping', 'media']) {
      expect(take(registry, details({ resourceType })).taken, resourceType).toBe(false);
    }
  });

  it('leaves a POST, a failure, a redirect, a file and a window that is not a tab of Vex alone', () => {
    const { registry } = makeRegistry();
    expect(take(registry, details({ method: 'POST' })).taken).toBe(false);
    expect(take(registry, details({ statusCode: 404 })).taken).toBe(false);
    expect(take(registry, details({ statusCode: 302 })).taken).toBe(false);
    expect(take(registry, details({ url: 'file:///c/x.json' })).taken).toBe(false);
    expect(take(registry, details({ url: 'ftp://x/x.json' })).taken).toBe(false);
    const notGuest = { id: 1, isDestroyed: () => false, getType: () => 'window', getURL: () => '' };
    expect(take(registry, details({ webContents: notGuest })).taken).toBe(false);
    const stranger = makeRegistry({ owner: () => null });
    expect(take(stranger.registry, details()).taken).toBe(false);
  });

  it('can be switched off', () => {
    let on = true;
    const { registry } = makeRegistry({ isEnabled: () => on });
    expect(take(registry, details()).taken).toBe(true);
    on = false;
    expect(take(registry, details()).taken).toBe(false);
  });

  it('lets one navigation through when asked (Open raw), once, and keeps the fragment of the tab\'s own address', () => {
    const { registry } = makeRegistry();
    registry.allowOnce(5, 'https://example.com/data.json');
    expect(take(registry, details()).taken).toBe(false);
    expect(take(registry, details()).taken).toBe(true);
    const wc = guest(); wc.getURL = () => 'https://example.com/data.json#frag';
    expect(take(registry, details({ webContents: wc })).answer.responseHeaders.location[0]).toMatch(/#frag$/);
  });

  it('refuses two viewers with one name, and a viewer without its parts', () => {
    const registry = createDocViewerRegistry({ owner: () => ({}) });
    registry.register({ id: 'x', match: () => false, page: () => 'x://' });
    expect(() => registry.register({ id: 'x', match: () => false, page: () => 'x://' })).toThrow(/already/);
    expect(() => registry.register({ id: 'y' })).toThrow(/needs/);
  });

  it('another kind of document registered beside it is asked in order', () => {
    const { registry } = makeRegistry();
    registry.register({ id: 'pdf', match: (u, t) => /pdf/.test(t), page: (u) => 'vex-pdf://view/?u=' + encodeURIComponent(u) });
    expect(take(registry, details({ responseHeaders: { 'content-type': ['application/pdf'] } })).answer.responseHeaders.location[0]).toMatch(/^vex-pdf:/);
    expect(take(registry, details()).answer.responseHeaders.location[0]).toMatch(/^vex-doc:/);
  });
});

describe('addresses', () => {
  it('maps an address to the viewer and back', () => {
    const u = tv.viewerUrl('https://a.test/x.json?q=1#part');
    expect(u).toBe('vex-doc://view/?u=' + encodeURIComponent('https://a.test/x.json?q=1') + '#part');
    expect(tv.parseViewerUrl(u)).toEqual({ original: 'https://a.test/x.json?q=1', hash: 'part', source: false });
    const s = tv.viewerUrl('https://a.test/', '', true);
    expect(tv.parseViewerUrl(s)).toMatchObject({ original: 'https://a.test/', source: true });
    expect(tv.parseViewerUrl('vex-doc://view/doc?u=x')).toBe(null);
    expect(tv.parseViewerUrl('https://a.test/?u=x')).toBe(null);
  });

  it('knows which files it shows', () => {
    expect(tv.isTextFileUrl('file:///C:/a/b.json')).toBe(true);
    expect(tv.isTextFileUrl('file:///C:/a/B.LOG')).toBe(true);
    expect(tv.isTextFileUrl('file:///C:/a.d/readme')).toBe(false);
    expect(tv.isTextFileUrl('file:///C:/a/page.html')).toBe(false);
    expect(tv.isTextFileUrl('file:///C:/a/doc.pdf')).toBe(false);
    expect(tv.isTextFileUrl('https://a.test/b.json')).toBe(false);
  });

  it('Ctrl+F is the viewer\'s own', () => {
    expect(isDocViewerUrl('vex-doc://view/?u=x')).toBe(true);
    expect(guestOwnsFind('vex-doc://view/?u=x')).toBe(true);
    expect(isDocViewerUrl('https://vex-doc.test/')).toBe(false);
  });
});

describe('the window\'s twin of the address functions (js/webview.js)', () => {
  it('maps the same addresses, and the same files', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://vex.test/' });
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
    const mod = await import('../../src/renderer/js/webview.js');
    const WM = mod.WebviewManager;
    // the extension list is the same list
    expect([...WM.DOC_FILE_EXTENSIONS].sort()).toEqual([...tv.FILE_EXTENSIONS].sort());
    for (const url of ['file:///C:/a/b.json', 'file:///C:/a/B.LOG#L5', 'file:///C:/a.d/readme', 'file:///C:/p/page.html', 'file:///C:/p/d.pdf', 'https://a.test/x.json', 'file:///C:/a/.gitignore']) {
      const mapped = WM.docAddress(url);
      if (tv.isTextFileUrl(url)) { expect(mapped, url).toBe(tv.viewerUrl(url)); expect(WM.docOriginal(mapped), url).toBe(url); }
      else expect(mapped, url).toBe(url);
    }
    const src = WM.docAddress('view-source:https://a.test/p?x=1#h');
    expect(tv.parseViewerUrl(src)).toMatchObject({ original: 'https://a.test/p?x=1', source: true, hash: 'h' });
    expect(WM.docOriginal(src)).toBe('view-source:https://a.test/p?x=1#h');
    expect(WM.docAddress('view-source:javascript:alert(1)')).toBe('view-source:javascript:alert(1)');
    // switched off: the address is left alone
    dom.window.localStorage.setItem('vex.docViewer.prefs', JSON.stringify({ enabled: false }));
    expect(WM.docAddress('file:///C:/a/b.json')).toBe('file:///C:/a/b.json');
    dom.window.localStorage.removeItem('vex.docViewer.prefs');
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
  });
});

describe('serving the viewer and the document', () => {
  let dir, viewer, handler;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-textviewer-'));
    fs.writeFileSync(path.join(dir, 'a.json'), '{"a":1}\n{"b":2}');
    fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
    ({ viewer } = makeRegistry());
    handler = viewer.makeHandler({ fetch: async () => { throw new Error('no network in this test'); } }, 'persist:main');
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (url, headers) => handler({ url, headers: new Headers(headers || {}) });

  it('serves the page with the look and the language baked in, and a policy that allows no network', async () => {
    const r = await call('vex-doc://view/?u=x');
    const html = await r.text();
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self';/);
    expect(r.headers.get('content-security-policy')).not.toMatch(/connect-src[^;]*https?:/);
    expect(html).toMatch(/<html lang="tr" data-theme="oxford" data-gui-style="firefox">/);
    expect(html).toMatch(/name="vex-persist" content="1"/);
    const priv = await viewer.makeHandler({}, 'private-1')({ url: 'vex-doc://view/', headers: new Headers() });
    expect(await priv.text()).toMatch(/name="vex-persist" content="0"/);
  });

  it('serves only its own folders, and nothing above them', async () => {
    expect((await call('vex-doc://view/app/app.js')).status).toBe(200);
    expect((await call('vex-doc://view/css/theme-tokens.css')).status).toBe(200);
    expect((await call('vex-doc://view/icons.js')).status).toBe(200);
    expect((await call('vex-doc://view/app/..%2F..%2F..%2Fpackage.json')).status).toBe(404);
    expect((await call('vex-doc://view/app/viewer.exe')).status).toBe(404);
    expect((await call('vex-doc://other/')).status).toBe(404);
  });

  it('reads a file document byte for byte, with ranges (a growing log reads only the new bytes)', async () => {
    const u = pathToFileURL(path.join(dir, 'a.json')).href;
    const all = await call('vex-doc://view/doc?u=' + encodeURIComponent(u));
    expect(all.status).toBe(200);
    expect(await all.text()).toBe('{"a":1}\n{"b":2}');
    const tail = await call('vex-doc://view/doc?u=' + encodeURIComponent(u), { range: 'bytes=8-' });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe('{"b":2}');
    const none = await call('vex-doc://view/doc?u=' + encodeURIComponent(u), { range: 'bytes=999-' });
    expect(none.status).toBe(416);
    expect(none.headers.get('content-range')).toBe('bytes */15');
    const missing = await call('vex-doc://view/doc?u=' + encodeURIComponent(pathToFileURL(path.join(dir, 'nope.json')).href));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-vex-error')).toBe('missing');
  });

  it('fetches a web document in the tab\'s own session, and says so plainly when it cannot', async () => {
    const seen = [];
    const ses = { fetch: async (url, opts) => { seen.push([url, opts]); return new Response('{"x":1}', { status: 200, headers: { 'content-type': 'application/json' } }); } };
    const h = viewer.makeHandler(ses, 'persist:main');
    const r = await h({ url: 'vex-doc://view/doc?u=' + encodeURIComponent('https://example.com/a.json'), headers: new Headers() });
    expect(await r.text()).toBe('{"x":1}');
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(seen[0][0]).toBe('https://example.com/a.json');
    expect(seen[0][1].credentials).toBe('include');
    const bad = await call('vex-doc://view/doc?u=' + encodeURIComponent('https://example.com/a.json'));
    expect(bad.status).toBe(502);
    expect(bad.headers.get('x-vex-error')).toBe('fetch');
    expect((await call('vex-doc://view/doc?u=' + encodeURIComponent('javascript:alert(1)'))).status).toBe(400);
  });

  it('passes on only pictures, and only from beside a file or from the web document\'s own tab', async () => {
    const doc = pathToFileURL(path.join(dir, 'a.json')).href;
    const png = await call('vex-doc://view/res?d=' + encodeURIComponent(doc) + '&u=' + encodeURIComponent(pathToFileURL(path.join(dir, 'pic.png')).href));
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    const txt = await call('vex-doc://view/res?d=' + encodeURIComponent(doc) + '&u=' + encodeURIComponent(pathToFileURL(path.join(dir, 'secret.txt')).href));
    expect(txt.status).toBe(403);
    const fromWeb = await call('vex-doc://view/res?d=' + encodeURIComponent('https://a.test/x.md') + '&u=' + encodeURIComponent(pathToFileURL(path.join(dir, 'pic.png')).href));
    expect(fromWeb.status).toBe(403);
    const ses = { fetch: async () => new Response('not a picture', { status: 200, headers: { 'content-type': 'text/html' } }) };
    const h = viewer.makeHandler(ses, 'persist:main');
    const html = await h({ url: 'vex-doc://view/res?d=' + encodeURIComponent('https://a.test/x.md') + '&u=' + encodeURIComponent('https://a.test/p.png'), headers: new Headers() });
    expect(html.status).toBe(415);
  });
});

describe('who may call the docview:* channels', () => {
  function fakeIpc() {
    const handlers = new Map();
    return { handlers, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
  }
  function setup(extra = {}) {
    const { handlers, ipcMain } = fakeIpc();
    const registry = createDocViewerRegistry({ owner: () => ({}) });
    const written = [];
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: path.join(os.tmpdir(), 'vex-save-' + process.pid + '.json') }) };
    tv.registerTextViewerIpc({ ipcMain, dialog, windowFor: () => null, registry, downloadsDir: () => os.tmpdir(), ...extra });
    return { handlers, registry, written };
  }
  const event = (url, parent = null, loaded = []) => ({ senderFrame: { url, parent }, sender: { id: 5, session: { fetch: async () => new Response('x') }, loadURL: async (u) => loaded.push(u), downloadURL: (u) => loaded.push('download ' + u) } });

  it('answers only the viewer page itself, never a web page or a frame inside the viewer', async () => {
    const { handlers } = setup();
    for (const name of ['docview:save-as', 'docview:download', 'docview:open-raw']) {
      const web = await handlers.get(name)(event('https://evil.test/'));
      expect(web.ok, name).toBe(false);
      expect(web.code).toBe('not-viewer');
      const frame = await handlers.get(name)(event(tv.viewerUrl('https://a.test/x.json'), {}));
      expect(frame.ok, name).toBe(false);
    }
    expect((await handlers.get('docview:navigate')(event('https://evil.test/'), 'file:///C:/x.md')).code).toBe('not-viewer');
  });

  it('opens the browser\'s own view of one document, letting that one navigation through', async () => {
    const { handlers, registry } = setup();
    const loaded = [];
    const r = await handlers.get('docview:open-raw')(event(tv.viewerUrl('https://a.test/x.json', 'p'), null, loaded));
    expect(r.ok).toBe(true);
    expect(loaded).toEqual(['https://a.test/x.json#p']);
    expect(registry.consumeBypass(5, 'https://a.test/x.json')).toBe(true);
    const src = [];
    await handlers.get('docview:open-raw')(event(tv.viewerUrl('https://a.test/page', '', true), null, src));
    expect(src).toEqual(['view-source:https://a.test/page']);
  });

  it('downloads a web document through the tab\'s own downloads, and a file by copying it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dl-'));
    const { handlers } = setup({ downloadsDir: () => dir });
    const loaded = [];
    const web = await handlers.get('docview:download')(event(tv.viewerUrl('https://a.test/x.json'), null, loaded));
    expect(web).toMatchObject({ ok: true, viaDownloads: true });
    expect(loaded).toEqual(['download https://a.test/x.json']);
    const f = path.join(dir, 'src.log'); fs.writeFileSync(f, 'hello');
    const file = await handlers.get('docview:download')(event(tv.viewerUrl(pathToFileURL(f).href)));
    expect(file.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'src (2).log'), 'utf8')).toBe('hello');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('saves a copy under another name and refuses to overwrite the file it is reading', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sv-'));
    const f = path.join(dir, 'src.json'); fs.writeFileSync(f, '[1]');
    const target = path.join(dir, 'copy.json');
    let chosen = target;
    const { handlers } = setup({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: chosen }) } });
    const ok = await handlers.get('docview:save-as')(event(tv.viewerUrl(pathToFileURL(f).href)));
    expect(ok).toMatchObject({ ok: true, cancelled: false, name: 'copy.json' });
    expect(fs.readFileSync(target, 'utf8')).toBe('[1]');
    chosen = f;
    const same = await handlers.get('docview:save-as')(event(tv.viewerUrl(pathToFileURL(f).href)));
    expect(same).toMatchObject({ ok: false, code: 'same-file' });
    expect(fs.readFileSync(f, 'utf8')).toBe('[1]');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lets a file link to another file, and a web document link to no file at all', async () => {
    const { handlers } = setup();
    const loaded = [];
    const ok = await handlers.get('docview:navigate')(event(tv.viewerUrl('file:///C:/docs/a.md'), null, loaded), 'file:///C:/docs/b.md');
    expect(ok.ok).toBe(true);
    expect(loaded).toEqual([tv.viewerUrl('file:///C:/docs/b.md')]);
    const web = await handlers.get('docview:navigate')(event(tv.viewerUrl('https://a.test/a.md')), 'file:///C:/Windows/win.ini');
    expect(web).toMatchObject({ ok: false, code: 'file-only' });
    const toWeb = await handlers.get('docview:navigate')(event(tv.viewerUrl('file:///C:/docs/a.md')), 'https://a.test/');
    expect(toWeb.ok).toBe(false);
  });

  it('is on the guest list for the four page channels and the interface-only list for the switch', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/ipc-policy.js'), 'utf8');
    for (const c of ['docview:save-as', 'docview:download', 'docview:open-raw', 'docview:navigate']) expect(src, c).toMatch(new RegExp("GUEST_CHANNELS[\\s\\S]*'" + c + "'"));
    expect(src).toMatch(/UI_ONLY_CHANNELS[\s\S]*'docview:set-enabled'/);
    expect(typeof policy.installIpcPolicy).toBe('function');
  });
});
