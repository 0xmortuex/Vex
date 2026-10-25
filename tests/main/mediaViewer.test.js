// Vex's own video and sound player, the main-process side (src/main/media-viewer.js, src/main/doc-viewers.js): which answers are taken
// over, that only a main frame of a Vex tab is, how the media is served (by range, from the right session), what the player may ask
// main to do, and that the window's address mapping and main's agree.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createDocViewers } = require('../../src/main/doc-viewers.js');
const mv = require('../../src/main/media-viewer.js');

const ROOT = path.join(__dirname, '..', '..');
const guestOk = { id: 7, getURL: () => 'http://x/a.mp4#t=30', isDestroyed: () => false, getType: () => 'webview' };

function registry({ enabled = true, guest = true } = {}) {
  const docViewers = createDocViewers({ isGuest: () => guest });
  const viewer = mv.createMediaViewer({ rendererDir: path.join(ROOT, 'src', 'renderer'), docViewers, isEnabled: () => enabled, owner: () => true });
  return { docViewers, viewer };
}
const answer = (over) => ({ resourceType: 'mainFrame', statusCode: 200, url: 'http://x/a.mp4', webContents: guestOk, responseHeaders: { 'Content-Type': ['video/mp4'] }, ...over });
function take(reg, details) {
  let reply = null;
  const taken = reg.docViewers.take(details, (r) => { reply = r; });
  return { taken, reply };
}

describe('which answers the player takes over', () => {
  it('takes a main-frame video or sound and answers with a redirect to the player, keeping the #t= of the tab', () => {
    const { taken, reply } = take(registry(), answer());
    expect(taken).toBe(true);
    expect(reply.statusLine).toMatch(/302/);
    expect(reply.responseHeaders.location[0]).toBe('vex-media://view/?u=' + encodeURIComponent('http://x/a.mp4') + '#t=30');
  });
  it.each(['video/webm', 'video/x-matroska', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/ogg; codecs=opus', 'audio/wav', 'audio/x-wav', 'application/ogg', 'AUDIO/AAC'])('takes %s', (type) => {
    expect(take(registry(), answer({ responseHeaders: { 'content-type': type } })).taken).toBe(true);
  });
  it.each([
    ['a streaming playlist', 'application/vnd.apple.mpegurl'], ['audio mpegurl', 'audio/x-mpegurl'], ['transport stream', 'video/mp2t'], ['a type nothing plays', 'video/x-msvideo'],
    ['octet-stream', 'application/octet-stream'], ['an image', 'image/png'], ['a web page', 'text/html'], ['nothing', ''],
  ])('leaves %s alone', (_n, type) => {
    expect(take(registry(), answer({ responseHeaders: { 'content-type': type } })).taken).toBe(false);
  });
  it('leaves alone: a download, an error answer, a frame inside a page, a non-web address, a page that is not a Vex tab, a switched-off player', () => {
    expect(take(registry(), answer({ responseHeaders: { 'content-type': ['video/mp4'], 'content-disposition': ['attachment; filename=a.mp4'] } })).taken).toBe(false);
    expect(take(registry(), answer({ statusCode: 404 })).taken).toBe(false);
    expect(take(registry(), answer({ statusCode: 302 })).taken).toBe(false);
    expect(take(registry(), answer({ resourceType: 'subFrame' })).taken).toBe(false);
    expect(take(registry(), answer({ resourceType: 'media' })).taken).toBe(false);
    expect(take(registry(), answer({ url: 'ftp://x/a.mp4' })).taken).toBe(false);
    expect(take(registry({ guest: false }), answer()).taken).toBe(false);
    expect(take(registry({ enabled: false }), answer()).taken).toBe(false);
  });
  it('lets one navigation through when the person asked for it (a download), once, in that tab only', () => {
    const reg = registry();
    reg.viewer.allowOnce(7, 'http://x/a.mp4');
    expect(take(reg, answer()).taken).toBe(false);
    expect(take(reg, answer()).taken).toBe(true);
    reg.viewer.allowOnce(8, 'http://x/a.mp4');
    expect(take(reg, answer()).taken).toBe(true);                       // tab 7 was not the one
  });
  it('a registry takes an id once, and a viewer must be complete', () => {
    const reg = registry();
    expect(() => reg.docViewers.register({ id: 'media', match: () => true, page: () => 'x' })).toThrow(/already/);
    expect(() => reg.docViewers.register({ id: 'other' })).toThrow(/needs/);
    expect(() => createDocViewers({})).toThrow(/isGuest/);
  });
});

describe('addresses', () => {
  it('make the player address and read it back, with the fragment', () => {
    const url = mv.viewerUrl('http://x/a b.mp4?q=1#t=5');
    expect(url).toBe('vex-media://view/?u=' + encodeURIComponent('http://x/a b.mp4?q=1') + '#t=5');
    expect(mv.parseViewerUrl(url)).toEqual({ original: 'http://x/a b.mp4?q=1', hash: 't=5' });
    expect(mv.parseViewerUrl('vex-media://view/doc?u=x')).toBe(null);      // the media route is not the page
    expect(mv.parseViewerUrl('vex-pdf://view/?u=x')).toBe(null);
    expect(mv.parseViewerUrl('https://evil/?u=x')).toBe(null);
  });
  it('the window\'s twin of both agrees with main\'s', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    const cases = ['file:///C:/m/a%20b.mp4', 'file:///C:/m/song.MP3#t=12', 'file:///C:/m/clip.mkv?x=1'];
    for (const file of cases) {
      const viewer = WebviewManager.mediaAddress(file);
      expect(viewer).toBe(mv.viewerUrl(file));
      const back = WebviewManager.mediaOriginal(viewer);
      expect(back).toBe(file.includes('#') ? file : file);
      const parsed = mv.parseViewerUrl(viewer);
      expect(parsed.original + (parsed.hash ? '#' + parsed.hash : '')).toBe(back);
    }
    for (const other of ['https://x/a.mp4', 'file:///C:/m/a.pdf', 'file:///C:/m/a.txt', 'vex://start']) expect(WebviewManager.mediaAddress(other)).toBe(other);
    expect(WebviewManager.mediaOriginal('https://x/')).toBe(null);
    globalThis.window = { VexMediaViewerOff: true };
    try { expect(WebviewManager.mediaAddress('file:///C:/m/a.mp4')).toBe('file:///C:/m/a.mp4'); } finally { delete globalThis.window; }
  });
  it('knows a file address of a playable kind', () => {
    for (const ok of ['file:///C:/a.mp4', 'file:///C:/a.WEBM', 'file:///C:/dir/a%20b.flac', 'file:///C:/a.opus#t=3']) expect(mv.isMediaFileUrl(ok)).toBe(true);
    for (const no of ['file:///C:/a.pdf', 'http://x/a.mp4', 'file:///C:/a.mp4.exe', 'file:///C:/mp4']) expect(mv.isMediaFileUrl(no)).toBe(false);
  });
  it('reads a Range header', () => {
    expect(mv.parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(mv.parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(mv.parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(mv.parseRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 });
    expect(mv.parseRange('bytes=100-', 100)).toEqual({ invalid: true });
    expect(mv.parseRange('', 100)).toBe(null);
    expect(mv.parseRange('items=1-2', 100)).toBe(null);
  });
});

describe('serving the player and the media', () => {
  let dir, handler;
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-mv-test-'));
    fs.writeFileSync(path.join(dir, 'a b.mp4'), bytes);
    fs.writeFileSync(path.join(dir, 'a b.srt'), '1\n00:00:01,000 --> 00:00:02,000\nhi\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'secret');
    fs.writeFileSync(path.join(dir, 'empty.mp3'), '');
    handler = registry().viewer.makeHandler({ fetch: async (url, init) => new Response(bytes.subarray(0, 10), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-9/1000', 'content-length': '10', 'x-seen': url + ' ' + (init.headers.range || '') } }) }, true);
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (url, headers) => handler(new Request(url, { headers }));
  const fileUrl = (name) => 'vex-media://view/doc?u=' + encodeURIComponent(require('node:url').pathToFileURL(path.join(dir, name)).href);

  it('serves the page with the look and the language baked in, and the persistence flag', async () => {
    const r = await get('vex-media://view/?u=x');
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('<meta name="vex-persist" content="1">');
    expect(html).toMatch(/<html lang="en" data-theme="oxford" data-gui-style="classic">/);
    expect(r.headers.get('content-security-policy')).toBe(mv.CSP);
    const priv = await registry().viewer.makeHandler({}, false)(new Request('vex-media://view/'));
    expect(await priv.text()).toContain('<meta name="vex-persist" content="0">');
  });
  it('the page may run only its own scripts, reach nothing, and play only its own media', () => {
    expect(mv.CSP).toMatch(/default-src 'none'/);
    expect(mv.CSP).toMatch(/script-src 'self'(?:;|$)/);
    expect(mv.CSP).toMatch(/media-src 'self' blob:/);
    expect(mv.CSP).toMatch(/connect-src 'self' blob: data:/);
    expect(mv.CSP).not.toMatch(/unsafe-eval|https?:/);
  });
  it('serves its own files and nothing above them', async () => {
    expect((await get('vex-media://view/app/app.js')).status).toBe(200);
    expect((await get('vex-media://view/css/theme-tokens.css')).status).toBe(200);
    expect((await get('vex-media://view/icons.js')).status).toBe(200);
    for (const bad of ['vex-media://view/app/..%2F..%2Fmain.js', 'vex-media://view/app/viewer.html.bak', 'vex-media://view/lib/x.js', 'vex-media://view/css/x.exe']) expect((await get(bad)).status, bad).toBe(404);
    expect((await get('vex-media://other/')).status).toBe(404);
  });
  it('streams a file by range: 206 with the right bytes, 200 for the whole, 416 past the end', async () => {
    const part = await get(fileUrl('a b.mp4'), { range: 'bytes=10-19' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(part.headers.get('content-length')).toBe('10');
    expect(part.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(10, 20));
    const tail = await get(fileUrl('a b.mp4'), { range: 'bytes=-5' });
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(bytes.subarray(995));
    const whole = await get(fileUrl('a b.mp4'));
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes);
    expect((await get(fileUrl('a b.mp4'), { range: 'bytes=5000-' })).status).toBe(416);
    expect((await get(fileUrl('empty.mp3'))).status).toBe(200);
  });
  it('plays only media and subtitle files from disk: not a text file, not a missing one', async () => {
    expect((await get(fileUrl('a b.srt'))).status).toBe(200);
    expect((await get(fileUrl('notes.txt'))).status).toBe(415);
    const missing = await get(fileUrl('nope.mp4'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-vex-error')).toBe('missing');
    expect((await get('vex-media://view/doc?u=' + encodeURIComponent('ftp://x/a.mp4'))).status).toBe(400);
    expect((await get('vex-media://view/doc')).status).toBe(400);
  });
  it('reads a web file through the tab\'s own session, passing the Range on', async () => {
    const r = await get('vex-media://view/doc?u=' + encodeURIComponent('https://example.test/v.mp4'), { range: 'bytes=0-9' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 0-9/1000');
    expect(r.headers.get('x-vex-upstream-status')).toBe('206');
  });
  it('says plainly when the session could not fetch it', async () => {
    const failing = registry().viewer.makeHandler({ fetch: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } }, true);
    const r = await failing(new Request('vex-media://view/doc?u=' + encodeURIComponent('https://nowhere.test/v.mp4')));
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/ERR_NAME_NOT_RESOLVED/);
  });
});

describe('what the player may ask main to do', () => {
  function setup() {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    const opened = [], shown = [], downloads = [];
    const shell = { openPath: async (p) => { opened.push(p); return ''; }, showItemInFolder: (p) => shown.push(p) };
    const reg = registry();
    mv.registerMediaViewerIpc({ ipcMain, viewer: reg.viewer, shell, tempDir: () => path.join(os.tmpdir(), 'vex-mv-test-open') });
    const event = (url, parent = null) => ({ senderFrame: { url, parent }, sender: { id: 7, downloadURL: (u) => downloads.push(u), session: { fetch: async () => new Response(Buffer.from('abc'), { status: 200, headers: { 'content-type': 'video/mp4' } }) } } });
    return { handlers, opened, shown, downloads, event, reg };
  }
  it('lists the media of the folder in natural order, the subtitles beside it, and nothing for a web file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-mv-sib-'));
    try {
      for (const n of ['10 b.mp3', '2 a.mp3', 'film.mp4', 'film.en.srt', 'film.tr.vtt', 'other.srt', 'notes.txt']) fs.writeFileSync(path.join(dir, n), 'x');
      const s = setup();
      const url = require('node:url').pathToFileURL(path.join(dir, '2 a.mp3')).href;
      const r = await s.handlers.get('mediaview:siblings')(s.event(mv.viewerUrl(url)));
      expect(r.ok).toBe(true);
      expect(r.items.map((i) => i.name)).toEqual(['2 a.mp3', '10 b.mp3', 'film.mp4']);
      const film = require('node:url').pathToFileURL(path.join(dir, 'film.mp4')).href;
      const r2 = await s.handlers.get('mediaview:siblings')(s.event(mv.viewerUrl(film)));
      expect(r2.subs.map((i) => i.name)).toEqual(['film.en.srt', 'film.tr.vtt']);
      expect(r2.items.every((i) => i.url.startsWith('file:///'))).toBe(true);
      const web = await s.handlers.get('mediaview:siblings')(s.event(mv.viewerUrl('http://x/a.mp3')));
      expect(web).toEqual({ ok: true, items: [], subs: [] });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('refuses a frame that is not the player, or is a frame inside it', async () => {
    const s = setup();
    for (const name of ['mediaview:siblings', 'mediaview:download', 'mediaview:open-external', 'mediaview:reveal']) {
      for (const bad of [s.event('https://evil.test/'), s.event('vex-media://view/doc?u=file:///x.mp4'), s.event(mv.viewerUrl('http://x/a.mp4'), { url: 'x' }), { senderFrame: null, sender: {} }]) {
        const r = await s.handlers.get(name)(bad);
        expect(r.ok, name).toBe(false);
        expect(r.error).toMatch(/Only the player/);
      }
    }
    expect(s.downloads).toEqual([]);
    expect(s.opened).toEqual([]);
  });
  it('downloads a web file through the tab (once past the player), and shows a local one in its folder', async () => {
    const s = setup();
    const r = await s.handlers.get('mediaview:download')(s.event(mv.viewerUrl('http://x/a.mp4')));
    expect(r).toEqual({ ok: true, viaDownloads: true });
    expect(s.downloads).toEqual(['http://x/a.mp4']);
    expect(take(s.reg, answer()).taken).toBe(false);                        // the download is not caught again
    const f = await s.handlers.get('mediaview:download')(s.event(mv.viewerUrl('file:///C:/m/a.mp4')));
    expect(f).toEqual({ ok: true, revealed: true });
    expect(s.shown[0].replace(/\\/g, '/')).toBe('C:/m/a.mp4');
  });
  it('opens a local file with Windows, and a web file after reading it through the tab\'s session into a temp folder', async () => {
    const s = setup();
    const local = await s.handlers.get('mediaview:open-external')(s.event(mv.viewerUrl('file:///C:/m/a.mp4')));
    expect(local).toEqual({ ok: true });
    expect(s.opened[0].replace(/\\/g, '/')).toBe('C:/m/a.mp4');
    const web = await s.handlers.get('mediaview:open-external')(s.event(mv.viewerUrl('http://x/dir/Song%20One.mp3')));
    expect(web).toEqual({ ok: true });
    expect(path.basename(s.opened[1])).toBe('Song One.mp3');
    expect(fs.readFileSync(s.opened[1], 'utf8')).toBe('abc');
    fs.rmSync(path.dirname(s.opened[1]), { recursive: true, force: true });
    const odd = await s.handlers.get('mediaview:open-external')(s.event(mv.viewerUrl('ftp://x/a.mp4')));
    expect(odd.ok).toBe(false);
  });
  it('a file dropped on a page goes to the player before the request starts, once, only in a Vex tab', () => {
    const calls = [];
    const wc = { id: 9, isDestroyed: () => false, getType: () => 'webview', loadURL: async (u) => { calls.push(u); } };
    const { viewer } = registry();
    expect(viewer.takeFile(wc, 'file:///C:/m/a.mp4#t=3')).toBe(true);
    expect(calls).toEqual([mv.viewerUrl('file:///C:/m/a.mp4#t=3')]);
    expect(viewer.takeFile(wc, 'file:///C:/m/a.pdf')).toBe(false);
    expect(viewer.takeFile(wc, 'http://x/a.mp4')).toBe(false);
    expect(registry({ guest: true, enabled: false }).viewer.takeFile(wc, 'file:///C:/m/a.mp4')).toBe(false);
    expect(registry().viewer.takeFile({ ...wc, getType: () => 'window' }, 'file:///C:/m/a.mp4')).toBe(false);
  });
});

describe('the wiring in main', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  it('every session\'s header handler asks the registry first, and the scheme may stream', () => {
    const handlers = main.match(/onHeadersReceived\(\(details, callback\) => \{\r?\n\s*if \(_docViewers\.take\(details, callback\)\) return;/g) || [];
    const all = main.match(/onHeadersReceived\(\(details, callback\) => \{/g) || [];
    expect(handlers.length).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(main).toMatch(/scheme: 'vex-media', privileges: \{[^}]*stream: true/);
    expect(main).toMatch(/_mediaViewer\.wireSession\(ses, partition\)/);
  });
  it('the player\'s channels are named by the policy and have a schema', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc-policy.js'), 'utf8');
    const schemas = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc-schemas.js'), 'utf8');
    for (const c of ['mediaview:siblings', 'mediaview:download', 'mediaview:open-external', 'mediaview:reveal']) { expect(policy).toContain("'" + c + "'"); expect(schemas).toContain(c); }
    for (const c of ['mediaview:set-enabled', 'mediaview:forget-places']) { expect(policy).toContain("'" + c + "'"); expect(schemas).toContain(c); }
  });
  it('the player page gets a bridge of its own and nothing of a web page\'s preload', () => {
    const pre = fs.readFileSync(path.join(ROOT, 'src', 'preload-webview.js'), 'utf8');
    const at = pre.indexOf("location.protocol === 'vex-media:'");
    expect(at).toBeGreaterThan(0);
    expect(pre.indexOf('return;', at)).toBeLessThan(pre.indexOf('Surface media decode failures'));
    expect(pre).toMatch(/exposeInMainWorld\('vexMediaHost'/);
  });
});
