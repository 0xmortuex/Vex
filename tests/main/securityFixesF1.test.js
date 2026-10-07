// @vitest-environment node
//
// The 2026-10-07 security fixes (scan: H1–H4, M1–M4, L1–L13, S5-1..3, P1–P3).
// Pure parts are exercised directly; the main.js wiring, which needs Electron,
// is checked in its source as the other main tests do.

import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const helpers = require('../../src/main-helpers.js');
const { createPermissionService } = require('../../src/main/permissions.js');
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { createDownloadService } = require('../../src/main/downloads.js');
const { createVaultService } = require('../../src/main/vault.js');
const { markRoutedSession } = require('../../src/main/routing.js');
const { TARGET_CHANNELS_SOURCE } = (() => ({ TARGET_CHANNELS_SOURCE: fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8') }))();
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('H1: links that open another program', () => {
  it('knows the scheme and names the program', () => {
    expect(helpers.externalScheme('ms-word:ofe|u|https://x.example/a.docx')).toBe('ms-word');
    expect(helpers.externalScheme('javascript:alert(1)')).toBe(null);
    expect(helpers.externalAppName('steam')).toBe('Steam');
    expect(helpers.externalAppName('ms-excel')).toBe('Microsoft Excel');
  });
  it('treats an Office link with a document address as asked every time', () => {
    expect(helpers.opensRemoteDocument('ms-word:ofe|u|https://evil.example/x.docx')).toBe(true);
    expect(helpers.opensRemoteDocument('ms-excel:ofv|u|http://evil.example/x.xlsx')).toBe(true);
    expect(helpers.opensRemoteDocument('ms-word:')).toBe(false);
    expect(helpers.opensRemoteDocument('steam://run/440')).toBe(false);
  });
  it('never from a private, off-the-record, burner, identity or Tor page', () => {
    for (const p of ['tor-abc', 'otr-123', 'otr-burner-x', 'private:uuid', 'vexid-1', '', 'persist:route-tor']) {
      expect(helpers.refusesExternalApps(p, {}), p).toBe(true);
    }
    expect(helpers.refusesExternalApps('persist:container-x', { __vexTor: true })).toBe(true);
    expect(helpers.refusesExternalApps('persist:main', {})).toBe(false);
    expect(helpers.refusesExternalApps('persist:container-work', {})).toBe(false);
  });
  it('needs a click or key press in the last few seconds', () => {
    const now = 1_000_000;
    expect(helpers.hasRecentGesture(undefined, now)).toBe(false);
    expect(helpers.hasRecentGesture(now - 2000, now)).toBe(true);
    expect(helpers.hasRecentGesture(now - helpers.USER_GESTURE_MS - 1, now)).toBe(false);
    expect(helpers.GESTURE_INPUT_TYPES.has('mouseDown')).toBe(true);
    expect(helpers.GESTURE_INPUT_TYPES.has('mouseMove')).toBe(false);
  });

  function permissions() {
    const handlers = {};
    const sent = [];
    const host = { win: { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, p }) } } };
    const svc = createPermissionService({
      userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'vex-perm-')),
      secureSessions: { partitionOf: () => 'persist:main', owner: () => host },
      ipcMain: { on: vi.fn(), handle: (c, fn) => { handlers[c] = fn; } },
      _markHidRequestActive: () => {},
    });
    svc.permissionsReady();
    return { svc, handlers, sent, host };
  }
  it('asks in the window, once per page and link while it is open, and remembers Block', async () => {
    const { svc, handlers, sent, host } = permissions();
    const page = { id: 7, session: {} };
    const first = svc.askExternalApp(page, 'https://site.example', 'steam', { app: 'Steam' });
    expect(await svc.askExternalApp(page, 'https://site.example', 'steam')).toBe(false);   // the same question, already open
    expect(sent).toHaveLength(1);
    expect(sent[0].p).toMatchObject({ origin: 'https://site.example', permission: 'external:steam', app: 'Steam', once: false });
    await handlers['permission:respond']({ sender: {} }, { id: sent[0].p.id, decision: 'deny', remember: true });
    expect(await first).toBe(false);
    // Remembered: no second question.
    expect(await svc.askExternalApp(page, 'https://site.example', 'steam')).toBe(false);
    expect(sent).toHaveLength(1);
    expect(svc.loadPermissionDecisions()['https://site.example::external:steam']).toBe('deny');
    void host;
  });
  it('an Office document link: "Always allow" is not kept, so it asks again', async () => {
    const { svc, handlers, sent } = permissions();
    const page = { id: 8, session: {} };
    const a = svc.askExternalApp(page, 'https://docs.example', 'ms-word', { noRemember: true });
    expect(sent[0].p.once).toBe(true);
    await handlers['permission:respond']({ sender: {} }, { id: sent[0].p.id, decision: 'allow', remember: true });
    expect(await a).toBe(true);
    expect(svc.loadPermissionDecisions()['https://docs.example::external:ms-word']).toBeUndefined();
    void svc.askExternalApp(page, 'https://docs.example', 'ms-word', { noRemember: true });
    expect(sent).toHaveLength(2);
  });
  it('main.js stops every such navigation and asks before opening', () => {
    const fn = main.slice(main.indexOf('function handleExternalProtocol'), main.indexOf('// Per-webContents throttle'));
    expect(fn).toMatch(/refusesExternalApps\(/);
    expect(fn).toMatch(/hasRecentGesture\(/);
    expect(fn).toMatch(/askExternalApp\(/);
    expect(fn.indexOf('askExternalApp(')).toBeLessThan(fn.indexOf('shell.openExternal('));
    expect(main).toMatch(/contents\.on\('will-frame-navigate', \(details\) => \{\s*if \(!details \|\| details\.isMainFrame\) return;/);
  });
});

describe('H2: off-the-record and burner sessions get what a private window gets', () => {
  it('are wired as they are made', () => {
    expect(main).toMatch(/partition\.startsWith\('otr-'\)\) _wireEphemeralBrowsing\(ses, 'otr'\)/);
    const fn = main.slice(main.indexOf('function _wireEphemeralBrowsing'), main.indexOf('function openPrivateWindow'));
    for (const piece of ['wireDownloadsOnSession(ses', 'wirePermissionsOnSession(ses', 'attachGuestPreloads(ses)', 'onBeforeRequest', 'onHeadersReceived', 'setUserAgent(CHROME_UA)', 'wireClientHintsOnSession(ses)', 'wireDisplayMediaOnSession(ses)']) {
      expect(fn, piece).toContain(piece);
    }
  });
  it('a burner over Tor is given no permission at all', () => {
    const svc = createPermissionService({ userDataPath: os.tmpdir(), secureSessions: { partitionOf: () => 'otr-burner-1', owner: () => null }, ipcMain: { on: vi.fn(), handle: vi.fn() }, _markHidRequestActive: () => {} });
    const ses = { setPermissionRequestHandler(fn) { this.req = fn; }, setPermissionCheckHandler(fn) { this.check = fn; } };
    svc.wirePermissionsOnSession(ses, 'otr', { denyOverTor: true });
    ses.__vexTor = true;
    let answer = 'prompted';
    ses.req({ getURL: () => 'https://x.example', session: ses }, 'camera', (ok) => { answer = ok; }, { requestingUrl: 'https://x.example' });
    expect(answer).toBe(false);
    expect(ses.check({ session: ses }, 'fullscreen', 'https://x.example')).toBe(false);
  });
  it('WebRTC shows only the public address, also after a route is taken off', () => {
    const page = { isDestroyed: () => false, session: null, setWebRTCIPHandlingPolicy: vi.fn() };
    const ses = { __vexEphemeral: true };
    page.session = ses;
    markRoutedSession(ses, 'direct', [page]);
    expect(page.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('default_public_interface_only');
    expect(main).toMatch(/__vexEphemeral && !contents\.session\.__vexRouted\) contents\.setWebRTCIPHandlingPolicy\('default_public_interface_only'\)/);
  });
});

describe('H3: the pop-out uses the tab\'s session', () => {
  it('open-pip-window takes the page id and checks it is this window\'s', () => {
    const fn = main.slice(main.indexOf("ipcMain.handle('open-pip-window'"), main.indexOf("ipcMain.handle('close-pip-window'"));
    expect(fn).toMatch(/secureSessions\.ownsTarget\(event, pageId\)/);
    expect(fn).toMatch(/createPipPlayer\(media, pipSession\)/);
    expect(fn).toMatch(/createPipWindow\(safe, pipSession\)/);
    const pip = fs.readFileSync(path.join(__dirname, '../../src/pip.js'), 'utf8');
    expect(pip).toMatch(/session: ses,/);
    expect(pip).toMatch(/throw new Error\('PiP needs the session/);
    const { schemas } = require('../../src/main/ipc-schemas.js');
    const [, , pageId] = schemas.get('open-pip-window');
    expect(pageId(5)).toBe(true);
    expect(pageId(undefined)).toBe(false);
  });
});

describe('H4: Vex windows open no windows, and only they hold webviews', () => {
  function security() {
    const s = createSessionSecurity({ session: { fromPartition: (p) => ({ p }) }, webContents: { getAllWebContents: () => [], fromId: () => null }, root: process.cwd() + '/src' });
    return s;
  }
  it('a link in the interface opens as a tab, never a window', () => {
    const s = security();
    const wc = { id: 1, on: vi.fn(), send: vi.fn(), isDestroyed: () => false, setWindowOpenHandler: vi.fn() };
    s.registerHost({ webContents: wc, on: vi.fn(), once: vi.fn(), isDestroyed: () => false });
    const handler = wc.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://github.com/x' })).toEqual({ action: 'deny' });
    expect(wc.send).toHaveBeenCalledWith('tab:create-from-external', { url: 'https://github.com/x' });
    wc.send.mockClear();
    expect(handler({ url: 'file:///C:/x' })).toEqual({ action: 'deny' });
    expect(wc.send).not.toHaveBeenCalled();
  });
  it('a page that is not a Vex window cannot attach a webview', () => {
    const s = security();
    const listeners = {};
    const other = { id: 9, on: (ev, fn) => { listeners[ev] = fn; } };
    s.guardWebviews(other);
    const event = { preventDefault: vi.fn() };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    listeners['will-attach-webview'](event, { preload: 'C:/evil.js', nodeIntegration: true });
    expect(event.preventDefault).toHaveBeenCalled();
    err.mockRestore();
    expect(main).toMatch(/secureSessions\.guardWebviews\(wc\)/);
  });
});

describe('M1: the farbling seed is per session and per site', () => {
  it('differs between sites and sessions, and is steady for one', () => {
    const key = Buffer.alloc(32, 7);
    const a = helpers.farbleSeed(key, 'persist:main', 'https://a.example.com/x');
    expect(helpers.farbleSeed(key, 'persist:main', 'https://www.example.com/y')).toBe(a);   // same site
    expect(helpers.farbleSeed(key, 'persist:main', 'https://other.example/')).not.toBe(a);
    expect(helpers.farbleSeed(key, 'tor-1', 'https://a.example.com/x')).not.toBe(a);
    expect(helpers.farbleSeed(Buffer.alloc(32, 8), 'persist:main', 'https://a.example.com/x')).not.toBe(a);
    expect(helpers.farbleSite('https://news.bbc.co.uk/a')).toBe('bbc.co.uk');
    expect(main).not.toMatch(/seed: FARBLE_SEED/);
  });
});

describe('M3: popup autofill waits for the person', () => {
  function vault() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-'));
    const handlers = {};
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s, 'utf8'), decryptString: (b) => b.toString('utf8').slice(4) };
    const svc = createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} }, isLocked: () => false });
    return { svc, handlers };
  }
  it('never in a private, off-the-record or Tor popup; in an isolated world after a real click otherwise', async () => {
    const { svc, handlers } = vault();
    await handlers['vault:save']({ sender: {} }, { host: 'bank.example', username: 'me', password: 'hunter2' });
    const wc = (session = {}) => ({ isDestroyed: () => false, session, getURL: () => 'https://bank.example/login', executeJavaScript: vi.fn(async () => {}), executeJavaScriptInIsolatedWorld: vi.fn(async () => {}) });
    for (const partition of ['otr-1', 'private:x', 'tor-1', 'persist:route-tor']) {
      const page = wc();
      svc._autofillPopup(page, { partition });
      expect(page.executeJavaScriptInIsolatedWorld, partition).not.toHaveBeenCalled();
    }
    const torRouted = wc({ __vexTor: true });
    svc._autofillPopup(torRouted, { partition: 'persist:container-x' });
    expect(torRouted.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    const page = wc();
    svc._autofillPopup(page, { partition: 'persist:main' });
    expect(page.executeJavaScript).not.toHaveBeenCalled();
    const [world, [{ code }]] = page.executeJavaScriptInIsolatedWorld.mock.calls[0];
    expect(world).toBeGreaterThan(0);
    expect(code).toMatch(/ev\.isTrusted/);
    expect(code).toMatch(/addEventListener\('pointerdown'/);
    expect(code).not.toMatch(/\n\s*fill\(\);\n/);   // nothing filled on load
  });
});

describe('M4, L5, S5-1: downloads', () => {
  function service({ partition = 'persist:main', sessions } = {}) {
    const sent = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dl-'));
    const tabSession = { on: (n, fn) => { tabSession._will = fn; }, downloadURL: vi.fn() };
    const host = { win: { webContents: { id: 1, send: (ch, d) => sent.push({ ch, d }) } } };
    const page = { id: 50, isDestroyed: () => false, getType: () => 'webview', session: tabSession, downloadURL: vi.fn() };
    const svc = createDownloadService({
      app: { getPath: (k) => (k === 'userData' ? dir : path.join(dir, 'dl')) },
      secureSessions: { owner: () => host, partitionOf: () => partition, fromPartition: () => ({ downloadURL: vi.fn() }), sessions: sessions || new Set([tabSession]) },
      broadcast: (ch, d) => sent.push({ ch, d }),
      ipcMain: null,
      webContents: { getAllWebContents: () => [page] },
    });
    svc.wireDownloadsOnSession(tabSession, 't');
    return { svc, sent, tabSession, page, dir };
  }
  function item(handlers = {}) {
    return { getFilename: () => 'f.bin', getURL: () => 'https://x.example/f.bin', getTotalBytes: () => 1, getReceivedBytes: () => 1, setSavePath: vi.fn(), on: (n, fn) => { handlers[n] = fn; }, once: (n, fn) => { handlers[n] = fn; }, handlers };
  }
  it('a Tor or off-the-record download is marked ephemeral; a main one is not', () => {
    const tor = service({ partition: 'tor-1' });
    tor.tabSession._will({}, item(), tor.page);
    expect(tor.sent[0].d.ephemeral).toBe(true);
    const plain = service();
    plain.tabSession._will({}, item(), plain.page);
    expect(plain.sent[0].d.ephemeral).toBe(false);
  });
  it('Retry goes through the session of the first try, and not once that private session is gone', () => {
    const s = service({ partition: 'otr-1' });
    s.tabSession._will({}, item(), s.page);
    const id = s.sent[0].d.id;
    const sender = { isDestroyed: () => false };
    expect(s.svc.retry(sender, 'https://x.example/f.bin', id)).toEqual({ ok: true });
    expect(s.page.downloadURL).toHaveBeenCalledWith('https://x.example/f.bin');
    const gone = service({ partition: 'otr-1', sessions: new Set() });
    gone.tabSession._will({}, item(), gone.page);
    expect(gone.svc.retry(sender, 'https://x.example/f.bin', gone.sent[0].d.id).ok).toBe(false);
  });
  it('Open is only for a file Vex downloaded', async () => {
    const s = service();
    const it1 = item();
    s.tabSession._will({}, it1, s.page);
    const savedTo = it1.setSavePath.mock.calls[0][0];
    expect(s.svc.isDownloadedFile(savedTo)).toBe(false);
    it1.handlers.done(null, 'completed');
    expect(s.svc.isDownloadedFile(savedTo)).toBe(true);
    expect(s.svc.isDownloadedFile('C:/Windows/System32/calc.exe')).toBe(false);
    await s.svc.flushKnown();
    expect(JSON.parse(fs.readFileSync(path.join(s.dir, 'downloaded-files.json'), 'utf8'))).toContain(path.resolve(savedTo).toLowerCase());
    expect(main).toMatch(/if \(!_downloadService\.isDownloadedFile\(filePath\)\)/);
  });
  it('the panel never writes an ephemeral download to disk', () => {
    const panel = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/downloads-panel.js'), 'utf8');
    expect(panel).toMatch(/JSON\.stringify\(this\.downloads\.filter\(d => !d\.ephemeral\)\)/);
    expect(panel).toMatch(/downloadsRetry\?\.\(dl\.url, dl\.id\)/);
  });
});

describe('IPC policy and smaller items', () => {
  it('L1: page:save, page:capture-full and image:for-ai are target-checked', () => {
    for (const ch of ['page:save', 'page:capture-full', 'image:for-ai']) expect(TARGET_CHANNELS_SOURCE).toContain(`'${ch}'`);
  });
  it('L2/L3: a private window clears its own site data, and cannot write to the main profile', () => {
    const m = /const PRIVATE_DISABLED = (\/.*\/);/.exec(TARGET_CHANNELS_SOURCE);
    const re = eval(m[1]);
    expect(re.test('site:clear-data')).toBe(false);
    for (const ch of ['app:restore-settings', 'reminders:create', 'reminders:import', 'reminders:delete', 'mail:add', 'mail:remove', 'app:open-as-app', 'overlay:open', 'mcp:auth-set']) expect(re.test(ch), ch).toBe(true);
    expect(main).toMatch(/function _siteSessionFor\(event, partition\)/);
    expect(main).toMatch(/_cookieSession = \(event, partition\) => _siteSessionFor\(event, partition\)/);
  });
  it('L3: Open as App and the overlay name the tab\'s partition, so main can refuse a private one', () => {
    const cmd = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    const wv = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
    expect(cmd).toMatch(/window\.vex\.overlayOpen\(t\.url, o, t\.partition\)/);
    expect(cmd).toMatch(/window\.vex\.openAsApp\(t\.url, t\.title, t\.partition\)/);
    expect(wv).toMatch(/window\.vex\.openAsApp\(webview\.getURL\(\), [^\n]*webview\.getAttribute\?\.\('partition'\)/);
    expect(main).toMatch(/'app:open-as-app', \(_e, url, title, partition\) => \{[\s\S]{0,200}_refuseMainProfileCopy\(partition\)/);
    expect(main).toMatch(/'overlay:open', \(_e, url, opacity, partition\) => \{[\s\S]{0,200}_refuseMainProfileCopy\(partition\)/);
  });
  it('L6: the screen-share quality is per page', () => {
    expect(main).not.toMatch(/_lastShareQuality/);
    expect(main).toMatch(/_shareQuality\.get\(event\.sender\.id\)/);
  });
  it('L9: the quick-capture window is sandboxed', () => {
    expect(main).toMatch(/preload-capture\.js'\),\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*contextIsolation: true, nodeIntegration: false, sandbox: true,/);
  });
  it('L13: a certificate error is not followed by an unencrypted load', () => {
    const fn = main.slice(main.indexOf("// HTTPS-Only fallback"), main.indexOf('// A clean main-frame load'));
    expect(fn).toMatch(/errorCode <= -200 && errorCode >= -299/);
    expect(fn.indexOf('_httpsCertNotice(')).toBeLessThan(fn.indexOf('_httpsOnlyFailed.add(bare)'));
  });
  it('S5-2: the crash log keeps no private page and only an origin otherwise', () => {
    const fn = main.slice(main.indexOf('const where = () => {'), main.indexOf("wc.on('render-process-gone'"));
    expect(fn).toMatch(/'a private page'/);
    expect(fn).toMatch(/u\.origin/);
    expect(fn).not.toMatch(/slice\(0, 120\)/);
  });
  it('S5-3: MCP tokens are kept in main, encrypted, and the server list is out of backups', () => {
    expect(main).toMatch(/const MCP_AUTH_FILE = path\.join\(userDataPath, 'mcp-auth\.enc'\)/);
    expect(main).toMatch(/secretStore\.write\(MCP_AUTH_FILE, all\)/);
    const backup = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/backup.js'), 'utf8');
    expect(backup).toMatch(/\/\^vex\\\.mcpServers\$\/i/);
  });
  it('P1: all of Vex covers sessions made later, and mail', () => {
    expect(main).toMatch(/secureSessions\.onSessionCreated\(_coverWithAllRoute\)/);
    expect(main).toMatch(/const targets = \[null, \.\.\.BROWSING_SESSIONS, \.\.\._allRouteExtraTargets\(\)\]/);
    expect(main).toMatch(/proxy: \(\) => _mailProxy\(\)/);
  });
  it('P1: mail connects through the proxy it is given, and a local bridge never does', async () => {
    const { createMail } = require('../../src/main/mail.js');
    const made = [];
    function ImapFlow(options) { made.push(options); return { connect: async () => {}, logout: async () => {}, close() {}, list: async () => [] }; }
    const accounts = [{ id: 'a', host: 'imap.example.com', port: 993, email: 'me@example.com', pass: 'x' }, { id: 'b', host: '127.0.0.1', port: 1143, email: 'me@proton.me', pass: 'x' }];
    const mail = createMail({ ImapFlow, simpleParser: async () => ({}), secrets: { read: async () => accounts, write: async () => true }, file: 'x', randomId: () => 'r', proxy: async () => 'socks5://127.0.0.1:9150' });
    await mail.inbox('a', 1).catch(() => {});
    await mail.inbox('b', 1).catch(() => {});
    expect(made[0].proxy).toBe('socks5://127.0.0.1:9150');
    expect(made[1].proxy).toBeUndefined();
    const waiting = createMail({ ImapFlow, simpleParser: async () => ({}), secrets: { read: async () => accounts, write: async () => true }, file: 'x', randomId: () => 'r', proxy: async () => { throw new Error('Tor is not connected yet'); } });
    await expect(waiting.inbox('a', 1)).rejects.toThrow(/Tor is not connected/);
  });
  it('P2: SponsorBlock asks only for a tab Vex\'s own window may ask about', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sponsor-skip.js'), 'utf8');
    const fn = src.slice(src.indexOf('async onNavigated'), src.indexOf('init()'));
    expect(fn).toMatch(/TabManager\.windowMayAsk\(tab\.partition\)/);
    expect(fn.indexOf('windowMayAsk')).toBeLessThan(fn.indexOf('this.segments('));
  });
  it('P3: a picture for the AI goes through its tab, and a private one only when agreed', () => {
    const fn = main.slice(main.indexOf("ipcMain.handle('image:for-ai'"), main.indexOf("const _faviconFetch"));
    expect(fn).toMatch(/needsConsent: true/);
    expect(fn).toMatch(/ses\.fetch\.bind\(ses\)/);
  });
});
