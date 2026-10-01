// @vitest-environment node
//
// Fixes of 2026-09-30 (r4-tor), main side: a session on the Tor Vex runs is
// closed off when that Tor stops and starts it again on its next page load;
// a Tor page that cannot load is told to its window; Stop closes the Tor tabs
// of every window; a session set back to direct keeps the Discord bypass; the
// print-preview comment says what really happens. main.js cannot be loaded
// outside Electron, so it is read as text, and one block is run on its own.
// Verified live as well (scratchpad agents/r4-tor p5, p6, p7).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
const path = require('path');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const between = (from, to) => { const a = MAIN.indexOf(from); const b = MAIN.indexOf(to, a); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); return MAIN.slice(a, b); };

describe('when the Tor Vex runs stops', () => {
  // The block that keeps track of the sessions on Tor, run on its own.
  const block = between('const _torSessions = new Set();', "// Every window's \"Tor is running\" indicator");
  const REFUSED = { proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' };
  const make = () => new Function('require', block + '\nreturn { _torSessions, _useTor, _leaveTor, _torWentDown };')(() => ({ REFUSED_PROXY: REFUSED }));
  const ses = () => ({ setProxy: vi.fn(() => Promise.resolve()) });

  it('every session on its port gets the refusing proxy and is marked down; others are left alone', () => {
    const t = make();
    const route = ses(), tab = ses(), borrowed = ses(), left = ses();
    t._useTor(route, 50100, true);
    t._useTor(tab, 50100, false);
    t._useTor(borrowed, 9150, true);    // Tor Browser's, which Vex does not stop
    t._useTor(left, 50100, true);
    t._leaveTor(left);                   // set back to direct or a proxy since
    t._torWentDown(50100);
    expect(route.setProxy).toHaveBeenCalledWith(REFUSED);
    expect(tab.setProxy).toHaveBeenCalledWith(REFUSED);
    expect(route.__vexTorDown && tab.__vexTorDown).toBe(true);
    expect(route.__vexTorRevive).toBe(true);
    expect(tab.__vexTorRevive).toBe(false);
    expect(borrowed.setProxy).not.toHaveBeenCalled();
    expect(left.setProxy).not.toHaveBeenCalled();
    expect(left.__vexTorDown).toBe(false);
  });

  it('is told by the launcher, with the port it had', () => {
    const hook = between('_torLauncher.onStateChange((running) => {', '});');
    expect(hook).toContain('if (running) _ownTorPort = _torLauncher.getPort();');
    expect(hook).toContain('else { _torWentDown(_ownTorPort); _ownTorPort = 0; }');
  });

  it('a Tor tab, a Tor route and every other way onto Tor are registered, and leaving Tor is too', () => {
    const create = between("ipcMain.handle('tor:create'", "ipcMain.handle('tor:verify'");
    expect(create).toContain('_useTor(ses, port, false);');
    const apply = between('async function applyRouting(', "ipcMain.handle('routing:set',");
    expect(apply).toContain('_useTor(ses, port, true);');
    expect(apply.match(/_leaveTor\(ses\);/g)).toHaveLength(2);
  });
});

describe('a Tor route starting Tor again', () => {
  it('starts on a real page load in a down route, never for a Tor tab\'s own session', () => {
    const hook = between("contents.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {\n    const ses", '});');
    expect(hook).toContain('ses.__vexTorDown && ses.__vexTorRevive && /^https?:/i.test(url)) _reviveTor(contents);');
  });

  it('keeps the refusing proxy until Tor is up, puts every down route on the new port, then reloads the pages that failed', () => {
    const revive = between('function _reviveTor(contents) {', '// Vex\'s own windows');
    const start = revive.indexOf('_torLauncher.start(');
    const setProxy = revive.indexOf("await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`");
    expect(start).toBeGreaterThan(0);
    expect(setProxy).toBeGreaterThan(start);
    expect(revive).toContain("if (!ses.__vexTorDown || !ses.__vexTorRevive) continue;");
    expect(revive).toContain("send('tor:progress', { phase, value, detail })");
    expect(revive).toContain("win.webContents.send('tor:reviving')");
    expect(revive).toContain('wc.reload()');
    // A failure is logged unless it was cancelled, and each waiting page says so.
    expect(revive).toContain("if (!cancelled) console.error('[tor] could not start Tor again for a Tor route:', err);");
    expect(revive).toContain("_torPageDown(wc, 'failed', cancelled ? null : err.message)");
  });

  it('a page that cannot load while Tor is down is named to its window, waiting or not', () => {
    const hook = between("contents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {\n    const ses", '});');
    expect(hook).toContain('errorCode === -3');
    expect(hook).toContain("_torRevival.waiting.add(contents); _torPageDown(contents, 'starting');");
    expect(hook).toContain("_torPageDown(contents, ses.__vexTorRevive ? 'failed' : 'stopped')");
    expect(MAIN).toContain("host.win.webContents.send('tor:page-down', { id: contents.id, state, error: error || null });");
  });
});

describe('Stop, in every window', () => {
  it('counts the Tor tabs of every Vex window for the question, and closes them in each before Tor stops', () => {
    const status = between("ipcMain.handle('tor:status', async () => {", "ipcMain.handle('tor:stop'");
    expect(status).toContain("_torTabsInWindows('countTorTabs')");
    expect(status).toContain('tabs: counts.reduce((a, b) => a + b, 0), windows: counts.filter(Boolean).length, routed: _torRoutedPages()');
    expect(MAIN).toContain("ipcMain.handle('tor:stop', async () => {\n  await _torTabsInWindows('closeTorTabs');\n  _torLauncher.stop();");
    expect(MAIN).toContain('[...secureSessions.hosts.values()].map(h => h.win)');
  });

  // r7 (2026-09-30): Stop closed the tabs of Tor-routed containers, burners
  // and site rules too. Only a Tor tab's own session is marked as one; the
  // routed pages are counted (tab pages only) for the question, not closed.
  it('tells Tor tabs from pages routed through Tor', () => {
    const create = between("ipcMain.handle('tor:create', async (event) => {", "ipcMain.handle('tor:verify'");
    expect(create).toContain('ses.__vexTorTab = true;');
    const routed = between('function _torRoutedPages() {', '}\n');
    expect(routed).toContain("wc.getType() === 'webview' && wc.session && wc.session.__vexTor && !wc.session.__vexTorTab");
    expect(MAIN).not.toContain('function _torPages(');
  });
});

describe('a session set back to direct keeps the Discord bypass', () => {
  it('gets what startup gives it, for the sessions the bypass covers', () => {
    const apply = between('async function applyRouting(', "ipcMain.handle('routing:set',");
    expect(apply).toContain("await ses.setProxy(!partition || BROWSING_SESSIONS.includes(partition) ? _discordBrowsingProxy : { mode: 'direct' });");
    const route = between('function _routeBrowsingDiscord(port) {', '// A session with a saved route');
    expect(route).toContain('_discordBrowsingProxy = cfg;');
    expect(MAIN).toContain("let _discordBrowsingProxy = { mode: 'direct' };");
  });
});

describe('the print comment', () => {
  it('says window.print() opens the Windows system print dialog, and the switches are unchanged', () => {
    const head = MAIN.slice(0, MAIN.indexOf("app.commandLine.appendSwitch('enable-print-preview');") + 60);
    expect(head).toContain('window.print() and Print (Ctrl+P) open the Windows system print');
    expect(head).not.toContain('Enable Chromium\'s rich print preview UI');
    expect(head).toContain("app.commandLine.appendSwitch('enable-features', 'PrintPreview,HardwareSecureDecryption');");
  });
});
