'use strict';
// === Unblock centre: the parts that touch Electron, the network and helper programs ======
//
// The rules are in ./unblock.js. This file hands them what they need and registers the
// channels the window uses:
//
//   unblock:assess  a page failed to load: is it worth offering help (two small checks first)
//   unblock:try     open this site by the first way that works (doh, light, byedpi)
//   unblock:sync    the window's list of sites and its global switch
//   unblock:status  which ways exist, which sites are on, why one could not be switched on
//
// What it never does: start Zapret, winws or WinDivert, or anything that needs administrator
// rights; touch the Discord or Roblox bypass settings; or leave a helper behind. The only
// program it can start is ByeDPI (no admin rights), through the same shared process the Discord
// and Roblox bypasses use, and it stops that process when the last site that needs it goes away,
// and when Vex closes. The encrypted-DNS proxy it may open is closed the same way.

const net = require('net');
const fs = require('fs');
const path = require('path');
const { createUnblock, buildPac } = require('./unblock');
const { handleConnect } = require('./connect-tunnel');

// What each way is called, and how long a test may take.
const REQUEST_TIMEOUT_MS = 7000;
const BYEDPI_PRESETS_TRIED = 6;     // of the ten; the later ones are rarely the ones that work
// Cloudflare's address: Vex already asks it for encrypted DNS. An empty request to it says only
// that this network reaches the internet; no site name is in it.
const CONTROL_URL = 'https://1.1.1.1/';

function proxyConfigFor(route) {
  if (!route) return { mode: 'direct' };
  return { proxyRules: (route.kind === 'http' ? 'http://127.0.0.1:' : 'socks5://127.0.0.1:') + route.port };
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}

// The methods, in the order they are tried. `deps`: { dohResolve, sniSplit, lightPort(), byedpi, share, userData, downloadBuffer }.
function createMethods(deps) {
  const { dohResolve, lightPort, byedpi, share, userData, downloadBuffer } = deps;

  // ---- doh: a local proxy that looks the name up over encrypted DNS and splits nothing ----
  let dohServer = null, dohStarting = null;
  async function ensureDoh() {
    if (dohServer) return dohServer.address().port;
    if (!dohStarting) {
      dohStarting = (async () => {
        const server = net.createServer(client => handleConnect(client, { resolve: dohResolve, split: () => 0 }));
        await listenOnLoopback(server);
        dohServer = server;
      })().finally(() => { dohStarting = null; });
    }
    await dohStarting;
    return dohServer.address().port;
  }
  const doh = {
    id: 'doh',
    label: 'Encrypted DNS',
    note: 'Looks the site name up over encrypted DNS, which beats a block that only lies about the address. Nothing is installed.',
    async available() { return { ok: true }; },
    async find(host, test) {
      const route = { kind: 'http', port: await ensureDoh() };
      return (await test(route)).ok ? { route } : null;
    },
    async restore() { return { kind: 'http', port: await ensureDoh() }; },
    async releaseIfUnused(count) {
      if (count > 0 || !dohServer) return;
      const server = dohServer;
      dohServer = null;
      await new Promise(resolve => server.close(() => resolve()));
    },
  };

  // ---- light: the proxy Vex already runs for the Discord bypass (encrypted DNS and a split hello) ----
  const light = {
    id: 'light',
    label: 'Encrypted DNS and a split handshake',
    note: 'The small proxy built into Vex: encrypted DNS, and the first packet of the secure handshake is cut in two so a name filter cannot read it. Nothing is installed.',
    async available() {
      return lightPort() ? { ok: true } : { ok: false, reason: 'The small proxy built into Vex is not running' };
    },
    async find(host, test) {
      const route = { kind: 'http', port: lightPort() };
      return (await test(route)).ok ? { route } : null;
    },
    async restore() {
      if (!lightPort()) throw new Error('The small proxy built into Vex is not running');
      return { kind: 'http', port: lightPort() };
    },
  };

  // ---- byedpi: the downloaded helper, no administrator rights ----
  const exePath = () => path.join(userData, 'byedpi', 'ciadpi.exe');
  const byedpiMethod = {
    id: 'byedpi',
    label: 'ByeDPI helper',
    note: 'A small helper program (ByeDPI) that Vex downloads from GitHub once, and starts only while a site needs it. No administrator rights.',
    async available({ allowDownload }) {
      if (process.platform !== 'win32') return { ok: false, reason: 'The ByeDPI helper Vex downloads is for Windows' };
      if (byedpi.isRunning() || fs.existsSync(exePath()) || allowDownload) return { ok: true };
      return { ok: false, needsDownload: true, reason: 'The ByeDPI helper is not on this computer yet' };
    },
    async find(host, test) {
      // Already running (for Discord, Roblox or another site): use it as it is. It is never restarted
      // from here, because the others have its port.
      if (byedpi.isRunning()) {
        const route = { kind: 'socks5', port: byedpi.getPort() };
        if (!(await test(route)).ok) return { route: null, reason: 'The helper that is already running (for Discord or Roblox) did not open this site, and Vex does not restart it while they use it' };
        share.attachUnblock(true);
        return { route, preset: null };
      }
      share.attachUnblock(true);
      let thrown = 0, lastErr = null;
      for (let i = 0; i < Math.min(BYEDPI_PRESETS_TRIED, byedpi.PRESETS.length); i++) {
        let port;
        try { port = await share.start(userData, downloadBuffer, i); }
        catch (err) { thrown++; lastErr = err; continue; }
        const route = { kind: 'socks5', port };
        if ((await test(route)).ok) return { route, preset: i };
      }
      share.releaseUnblock();
      if (lastErr && thrown === Math.min(BYEDPI_PRESETS_TRIED, byedpi.PRESETS.length)) throw lastErr;
      return { route: null, reason: 'None of the first ' + Math.min(BYEDPI_PRESETS_TRIED, byedpi.PRESETS.length) + ' ByeDPI settings opened this site' };
    },
    async restore({ preset }) {
      if (byedpi.isRunning()) { share.attachUnblock(true); return { kind: 'socks5', port: byedpi.getPort() }; }
      if (!fs.existsSync(exePath())) throw new Error('The ByeDPI helper is not on this computer. Press Test now to download it again.');
      share.attachUnblock(true);
      try { return { kind: 'socks5', port: await share.start(userData, downloadBuffer, preset == null ? 0 : preset) }; }
      catch (err) { share.releaseUnblock(); throw err; }
    },
    async releaseIfUnused(count) {
      if (count === 0 && share.isUnblockAttached()) share.releaseUnblock();
    },
  };

  // ---- admin: shown, never run ----
  const admin = {
    id: 'admin',
    label: 'Zapret / WinDivert',
    adminOnly: true,
    note: 'The strongest way, but it needs administrator rights, so Vex never starts it. The Game Control Center tool can run it for you.',
    async available() { return { ok: false, reason: 'Needs administrator rights' }; },
    async find() { throw new Error('Vex does not start tools that need administrator rights'); },
    async restore() { throw new Error('Vex does not start tools that need administrator rights'); },
  };

  return { methods: [doh, light, byedpiMethod, admin], shutdown() {
    if (dohServer) { const s = dohServer; dohServer = null; s.close(); }
    if (share.isUnblockAttached()) share.releaseUnblock();
  } };
}

// Wires everything. `ctx`: { ipcMain, net (electron), secureSessions, userData, byedpi, share, dohResolve,
//   lightPort(), downloadBuffer, reapplyBrowsing(discordPort), isRouted(partition), log }
function wireUnblock(ctx) {
  const { ipcMain, secureSessions, byedpi, share } = ctx;
  const state = { routes: [] };
  const { methods, shutdown } = createMethods({
    dohResolve: ctx.dohResolve, lightPort: ctx.lightPort, byedpi, share, userData: ctx.userData, downloadBuffer: ctx.downloadBuffer,
  });

  // One request through a route, on a session that has no cookies and keeps nothing.
  const probeSession = secureSessions.fromPartition('vex-unblock-probe');
  const controlSession = secureSessions.fromPartition('vex-unblock-control');
  function ask(ses, url) {
    const started = Date.now();
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve({ ms: Date.now() - started, ...v }); } };
      const req = ctx.net.request({ url, session: ses, useSessionCookies: false });
      const timer = setTimeout(() => { try { req.abort(); } catch (err) { ctx.log('[Unblock] abort after timeout: ' + err.message); } fin({ ok: false, error: 'no answer in ' + Math.round(REQUEST_TIMEOUT_MS / 1000) + ' s' }); }, REQUEST_TIMEOUT_MS);
      req.on('response', (res) => {
        clearTimeout(timer);
        const status = res.statusCode || 0;
        try { req.abort(); } catch (err) { ctx.log('[Unblock] abort after the answer: ' + err.message); }
        fin({ ok: status > 0, status });
      });
      req.on('error', (err) => { clearTimeout(timer); fin({ ok: false, error: (err && err.message) || 'failed' }); });
      req.end();
    });
  }
  async function request(host, route) {
    await probeSession.setProxy(proxyConfigFor(route));
    await probeSession.closeAllConnections();
    return ask(probeSession, 'https://' + host + '/');
  }
  async function control() {
    await controlSession.setProxy({ mode: 'direct' });
    return ask(controlSession, CONTROL_URL);
  }

  const unblock = createUnblock({
    methods,
    request,
    control,
    resolveHost: ctx.dohResolve,
    isRouted: ctx.isRouted,
    log: ctx.log,
    applyRoutes: (routes) => { state.routes = routes; ctx.reapplyBrowsing(); },
  });

  // The shared ByeDPI process moved or stopped: the sites that ride it follow it, or fall back to direct.
  share.setUnblockRepoint((port) => unblock.methodPortChanged('byedpi', port));

  ipcMain.handle('unblock:assess', (_e, url, code, partition) => unblock.assess({ url, code, partition, isPrivate: false }));
  ipcMain.handle('unblock:try', (_e, host, opts) => unblock.try(host, opts || {}));
  ipcMain.handle('unblock:sync', (_e, payload) => unblock.sync(payload));
  ipcMain.handle('unblock:status', () => unblock.status());

  return {
    // For _routeBrowsingDiscord: the proxy the browsing sessions get while a site is on. null = nothing of ours,
    // so the Discord-only rules stand as they were.
    browsingConfig(discordPort) {
      if (!state.routes.length) return null;
      const pac = buildPac(discordPort || 0, state.routes);
      return { pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64') };
    },
    shutdown,
    unblock,
  };
}

module.exports = { wireUnblock, createMethods, proxyConfigFor, CONTROL_URL, BYEDPI_PRESETS_TRIED };
