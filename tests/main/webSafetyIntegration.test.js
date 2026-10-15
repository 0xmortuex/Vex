import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createDownloadService } = require('../../src/main/downloads.js');
const { createPermissionService } = require('../../src/main/permissions.js');
const { createWebSafety } = require('../../src/main/web-safety.js');

// The web-safety judgement wired into the real permission and download
// services: what a prompt carries, what is held for a confirm, what a
// paranoid site is never given.

function fakeItem(url) {
  const handlers = {};
  const add = (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); };
  return {
    getFilename: () => decodeURIComponent(path.basename(new URL(url).pathname)), getURL: () => url, getURLChain: () => [url],
    getTotalBytes: () => 10, getReceivedBytes: () => 10, getSavePath: () => '',
    setSavePath: vi.fn(), setSaveDialogOptions: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
    isPaused: () => false, canResume: () => false, on: add, once: add,
  };
}
const fakePage = (id, url, partition = 'persist:main') => ({ id, getURL: () => url, getType: () => 'webview', once() {}, partition, session: {} });

let tmp, perms, prompts, safety, service, session, started, handlers, gestures;
function setup(opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-websafe-'));
  prompts = []; started = []; gestures = new Map();
  const folder = path.join(tmp, 'Downloads'); const profile = path.join(tmp, 'profile');
  fs.mkdirSync(folder); fs.mkdirSync(profile);
  handlers = new Map();
  const win = { isDestroyed: () => false, webContents: { send: (ch, payload) => { if (ch === 'permission:request') prompts.push(payload); } } };
  const host = { win };
  const secureSessions = { owner: () => host, partitionOf: (c) => c.partition || 'persist:main' };
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) };
  let disk = null;
  safety = createWebSafety({ read: () => disk, write: async (t) => { disk = t; }, topHosts: () => opts.topHosts || [] });
  perms = createPermissionService({ userDataPath: tmp, secureSessions, ipcMain, webSafety: safety, lastGestureAt: (c) => gestures.get(c.id) });
  perms.permissionsReady();
  perms.respond = (decision, remember = true) => handlers.get('permission:respond')({ sender: {} }, { id: prompts.at(-1).id, decision, remember });
  service = createDownloadService({
    app: { getPath: (n) => (n === 'userData' ? profile : folder) }, secureSessions,
    broadcast: (channel, data) => { if (channel === 'download-started') started.push(data.url); },
    ipcMain: null, lastGestureAt: (c) => gestures.get(c.id),
    askAutoDownloads: perms.askAutomaticDownloads,
    judgeDownload: (info) => safety.judgeDownload(info), askRiskyDownload: perms.askRiskyDownload,
  });
  session = { on: (n, fn) => { session._will = fn; } };
  service.wireDownloadsOnSession(session, 'test');
}
let clicks = 0;
// Each download is the person's own click, so the "page started it by itself" check stays out of the way.
const download = (page, url) => {
  gestures.set(page.id, Date.now() - (++clicks) * 7);
  const item = fakeItem(url);
  const event = { preventDefault: vi.fn() };
  session._will(event, item, page);
  return { item, event };
};
const settle = () => new Promise(r => setTimeout(r, 0));

describe('risky downloads', () => {
  beforeEach(() => setup());

  it('a program from a bare IP is held and asked about; Download anyway lets it on', async () => {
    const page = fakePage(1, 'https://blog.example.org/post');
    const { item } = download(page, 'http://203.0.113.9/files/setup.exe');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ permission: 'risky-download', choice: 'risky', fileName: 'setup.exe', origin: 'http://203.0.113.9' });
    expect(prompts[0].risk).toMatchObject({ warn: true, kind: 'ip-host', level: 'high' });
    expect(prompts[0].risk.reasons.length).toBeGreaterThan(0);
    expect(item.pause).toHaveBeenCalled();
    expect(started).toEqual([]);                       // held: not in the panel yet
    await perms.respond('allow', false);
    await settle();
    expect(item.resume).toHaveBeenCalled();
    expect(started).toEqual(['http://203.0.113.9/files/setup.exe']);
    // This once: the next one asks again.
    download(page, 'http://203.0.113.9/files/other.exe');
    expect(prompts).toHaveLength(2);
  });

  it('Don\'t download cancels it and nothing reaches the panel', async () => {
    const page = fakePage(1, 'https://blog.example.org/post');
    const { item } = download(page, 'http://203.0.113.9/setup.exe');
    await perms.respond('deny', false);
    await settle();
    expect(item.cancel).toHaveBeenCalled();
    expect(started).toEqual([]);
  });

  it('"Always allow from this site" is kept and that site is not asked again', async () => {
    const page = fakePage(1, 'https://blog.example.org/post');
    download(page, 'http://203.0.113.9/a.exe');
    await perms.respond('allow', true);
    await settle();
    expect(perms.decisionsFor(page)['http://203.0.113.9::risky-download']).toBe('allow');
    const second = download(page, 'http://203.0.113.9/b.exe');
    await settle();
    expect(prompts).toHaveLength(1);
    expect(second.item.cancel).not.toHaveBeenCalled();
    expect(started).toContain('http://203.0.113.9/b.exe');
  });

  it('a disguised name is asked about even from https', async () => {
    const page = fakePage(1, 'https://shop.example.org/');
    download(page, 'https://cdn.example.org/invoice.pdf.exe');
    expect(prompts[0].risk.kind).toBe('disguised');
  });

  it('ordinary downloads and known hosts are never asked', () => {
    const page = fakePage(1, 'https://shop.example.org/');
    download(page, 'https://cdn.example.org/report.pdf');
    download(page, 'https://github.com/o/r/releases/download/v1/tool.exe');
    download(page, 'https://download.example.org/setup.exe');
    expect(prompts).toEqual([]);
  });

  it('a private window keeps nothing: the prompt does not offer Always allow', () => {
    const page = fakePage(1, 'https://blog.example.org/', 'private:1');
    download(page, 'http://203.0.113.9/setup.exe');
    expect(prompts[0].remember).toBe(false);
  });

  it('setting it off asks nothing', () => {
    setup();
    safety.setSensitivity('off');
    const page = fakePage(1, 'https://blog.example.org/');
    download(page, 'http://203.0.113.9/setup.exe');
    expect(prompts).toEqual([]);
  });
});

describe('permission prompts', () => {
  let ses;
  function wire(opts) {
    setup(opts);
    ses = { setPermissionRequestHandler: (fn) => { ses.request = fn; }, setPermissionCheckHandler: (fn) => { ses.check = fn; }, webRequest: {} };
    perms.wirePermissionsOnSession(ses, 'test');
  }
  const ask = (page, permission, url, mediaTypes) => {
    const cb = vi.fn();
    ses.request(page, permission, cb, { requestingUrl: url || page.getURL(), ...(mediaTypes ? { mediaTypes } : {}) });
    return cb;
  };

  it('carries a plain risk line, and no alarm, for an ordinary camera request', () => {
    wire();
    ask(fakePage(1, 'https://meet.example.org/room'), 'media', null, ['video']);
    expect(prompts[0].permission).toBe('camera');
    expect(prompts[0].risk.riskLine).toMatch(/camera/);
    expect(prompts[0].risk.summary).toBe('');
  });

  it('says a site asks for more than it should when it keeps asking', () => {
    wire();
    const page = fakePage(1, 'https://shop.example.org/');
    ask(page, 'geolocation');
    ask(page, 'notifications');
    ask(page, 'media', null, ['video']);
    const last = prompts.at(-1);
    expect(last.risk.level).toBe('high');
    expect(last.risk.summary).toMatch(/more than it should/);
    expect(last.risk.why.join(' ')).toMatch(/3 different/);
  });

  it('flags a lookalike site on its own prompt', () => {
    wire();
    ask(fakePage(1, 'https://paypa1.com/'), 'geolocation');
    expect(prompts[0].risk.level).toBe('high');
    expect(prompts[0].risk.why.join(' ')).toMatch(/copy of another/);
  });

  it('a request from another site\'s frame is flagged', () => {
    wire();
    ask(fakePage(1, 'https://news.example.com/'), 'geolocation', 'https://ads.example.net/frame');
    expect(prompts[0].risk.why.join(' ')).toMatch(/frame of another site/);
  });

  it('paranoid mode answers no without asking, whatever was saved', async () => {
    wire();
    const page = fakePage(1, 'https://bank.example.org/');
    ask(page, 'geolocation');
    await perms.respond('allow', true);                   // saved Allow
    const again = ask(page, 'geolocation');
    expect(again).toHaveBeenCalledWith(true);             // as before: the saved answer
    await safety.setParanoid('https://bank.example.org', true);
    const n = prompts.length;
    const denied = ask(page, 'geolocation');
    expect(denied).toHaveBeenCalledWith(false);
    expect(prompts).toHaveLength(n);
    expect(ses.check(page, 'geolocation', 'https://bank.example.org', {})).toBe(false);
    // Another site is untouched.
    expect(ask(fakePage(2, 'https://other.example.org/'), 'geolocation')).not.toHaveBeenCalled();
  });

  it('adds nothing to a prompt when the setting is off', () => {
    wire();
    safety.setSensitivity('off');
    ask(fakePage(1, 'https://paypa1.com/'), 'geolocation');
    expect(prompts[0].risk).toBeUndefined();
  });

  it('the existing flow is unchanged: saved answers still decide', async () => {
    wire();
    const page = fakePage(1, 'https://meet.example.org/');
    ask(page, 'notifications');
    await perms.respond('deny', true);
    expect(ask(page, 'notifications')).toHaveBeenCalledWith(false);
    expect(prompts).toHaveLength(1);
  });
});

describe('wiring', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
  const main = read('src', 'main.js');
  const CHANNELS = ['websafety:get', 'websafety:set-sensitivity', 'websafety:allow-host', 'websafety:forget-host', 'websafety:set-paranoid', 'websafety:check'];

  it('every channel has a handler, a payload contract, a preload entry and is Vex-window-only', () => {
    const { schemas } = require('../../src/main/ipc-schemas.js');
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    const preload = read('src', 'preload.js');
    for (const ch of CHANNELS) {
      expect(main, ch).toContain(`ipcMain.handle('${ch}'`);
      expect(schemas.has(ch), ch).toBe(true);
      expect(preload, ch).toContain(`'${ch}'`);
      expect(UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
    }
  });
  it('the payload contracts refuse what they should', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('websafety:set-sensitivity', ['paranoid'])).toThrow();
    expect(() => validate('websafety:set-sensitivity', ['strict'])).not.toThrow();
    expect(() => validate('websafety:set-paranoid', ['https://a.example', 'yes'])).toThrow();
    expect(() => validate('websafety:allow-host', [123])).toThrow();
    expect(() => validate('websafety:get', ['extra'])).toThrow();
  });
  it('private windows cannot write the profile\'s safety choices', () => {
    const policy = read('src', 'main', 'ipc-policy.js');
    expect(policy).toContain('PRIVATE_DISABLED = /^(?:websafety:(?:set-sensitivity|allow-host|forget-host|set-paranoid)|');
  });
  it('every session\'s allowed requests pass the lookalike guard first', () => {
    const fn = main.slice(main.indexOf('function _httpsAnswer(details) {'));
    expect(fn.slice(0, 200)).toContain('if (_lookalikeGuard(details)) return { cancel: true };');
    // Each onBeforeRequest registration answers through _httpsAnswer (the function itself is the extra match).
    const registrations = (main.match(/webRequest\.onBeforeRequest\(\(details, callback\)/g) || []).length;
    const answers = (main.match(/_httpsAnswer\(details\)/g) || []).length;
    expect(answers).toBeGreaterThanOrEqual(registrations);
  });
  it('the "do not warn again" link is honoured only while that tab shows that page', () => {
    expect(main).toMatch(/const shown = _wsShown\.get\(contents\.id\);\s+if \(!shown\) return;/);
    expect(main).toContain('if (!same(target, shown)) return;');
  });
  it('paranoid mode strips third-party cookies both ways and re-applies WebRTC', () => {
    expect(main).toContain("if (k.toLowerCase() === 'set-cookie') delete responseHeaders[k];");
    expect(main).toContain("if (_paranoidThirdParty(details)) {\n      for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') delete h[k];");
    expect(main).toContain("contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); contents.__vexParanoidRtc = true;");
  });
});
