// Proves the Discord-OAuth popup fix end-to-end, headlessly — no interactive
// login. Exercises the REAL gate (shouldKeepPopupReal) and the REAL partition
// resolution used by main.js's setWindowOpenHandler, for BOTH:
//
//   Scenario A — container tab (persist:container-work, persistent):
//     the partition string IS derivable from the session storage path, so the
//     popup is pinned EXPLICITLY to persist:container-work.
//
//   Scenario B — off-the-record tab (otr-<ts>, in-memory):
//     no on-disk storage path → no derivable partition string → the popup
//     inherits the opener's (same in-memory) session IMPLICITLY. We prove that
//     inheritance still yields the right jar: session identity, cookie present
//     in the OTR session, cookie absent from persist:main, and the OTR session
//     is ephemeral (no on-disk storage path / no Partitions dir).
//
//   Scenario C — BOUNCE then OAuth (the real Ticket Tool / Discord flow):
//     the popup opens at a NON-OAuth-shaped bounce URL (window.open with
//     features + a name) that 302-redirects into an OAuth-shaped URL. URL-shape
//     gating sees only the first (non-shaped) url and would DENY → Peek dead-end;
//     only the disposition+features gate keeps it real. We prove the popup stays
//     a real window with window.opener intact THROUGH the redirect, pinned to the
//     opener's partition, with the post-redirect cookie in the right jar.
//
// Run:  npx electron scripts/verify-oauth-popup-partition.js
// Exit 0 = all assertions passed; 1 = a failure (prints which).

const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helpers = require('../src/main-helpers.js');

app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

// Mirror main.js exactly. getLastWebPreferences() omits `partition`, so derive
// from the session's on-disk partition path: <userData>/Partitions/<name>
// -> persist:<name>. In-memory (OTR) sessions have no path -> null.
function resolveOpenerPartition(contents) {
  try {
    const wp = typeof contents.getLastWebPreferences === 'function' ? contents.getLastWebPreferences() : null;
    if (wp && typeof wp.partition === 'string' && wp.partition) return wp.partition;
  } catch { /* ignore */ }
  try {
    const p = contents.session && contents.session.getStoragePath && contents.session.getStoragePath();
    if (p) { const m = /[\\/]Partitions[\\/]([^\\/]+)$/.exec(p); if (m) return 'persist:' + m[1]; }
  } catch { /* ignore */ }
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const port = server.address().port;
  res.setHeader('content-type', 'text/html');
  if (u.pathname === '/host.html') {
    const p = u.searchParams.get('p');
    const c = u.searchParams.get('c');
    const b = u.searchParams.get('b') === '1' ? '&bounce=1' : '';
    res.end(`<!doctype html><meta charset=utf-8>
      <webview id=wv partition="${p}" allowpopups webpreferences="contextIsolation=yes"
               src="http://localhost:${port}/opener.html?c=${encodeURIComponent(c)}${b}"
               style="width:600px;height:400px"></webview>`);
  } else if (u.pathname === '/opener.html') {
    const c = u.searchParams.get('c');
    const bounce = u.searchParams.get('bounce') === '1';
    if (bounce) {
      // Scenario C: open at a NON-OAuth-shaped bounce URL with window features
      // and a name (a scripted handback popup). /bounce 302-redirects into the
      // OAuth-shaped /oauth.html — modelling Ticket Tool -> Discord. The gate
      // must keep this real on SHAPE (disposition+features), not first-url shape.
      res.end(`<!doctype html><meta charset=utf-8><title>opener</title><script>
        const bounceUrl = 'http://localhost:${port}/bounce?c=${encodeURIComponent(c)}';
        window._popup = window.open(bounceUrl, 'login', 'width=500,height=700');
        document.title = window._popup ? 'opened' : 'blocked';
      </script>`);
    } else {
      res.end(`<!doctype html><meta charset=utf-8><title>opener</title><script>
        const popupUrl = 'http://localhost:${port}/oauth.html?c=${encodeURIComponent(c)}&client_id=1&redirect_uri=x&response_type=code';
        window._popup = window.open(popupUrl, 'oauthpopup');
        document.title = window._popup ? 'opened' : 'blocked';
      </script>`);
    }
  } else if (u.pathname === '/bounce') {
    // Non-OAuth-shaped bounce (like api.tickettool.xyz/api/auth/login) that
    // 302-redirects into the real OAuth-shaped URL. Same window, opener intact.
    const c = u.searchParams.get('c') || 'vexbounce';
    res.statusCode = 302;
    res.setHeader('location', `http://localhost:${port}/oauth.html?c=${encodeURIComponent(c)}&client_id=1&redirect_uri=x&response_type=code`);
    res.end('redirecting');
  } else if (u.pathname === '/oauth.html') {
    const c = (u.searchParams.get('c') || 'vexoauth').replace(/[^a-z0-9_]/gi, '');
    res.end(`<!doctype html><meta charset=utf-8><title>oauth</title><script>
      try { document.cookie = '${c}=1; path=/'; } catch(e){}
      document.title = 'oauth-opener-' + (window.opener != null);
    </script>`);
  } else { res.statusCode = 404; res.end('no'); }
});

// Per-scenario capture, filled by the global web-contents-created listener.
let cur = null;
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview' || !cur) return;
  cur.guest = contents;
  contents.setWindowOpenHandler((details) => {
    const { url, disposition, frameName, features } = details || {};
    // Mirror main.js's combined gate exactly: keep the popup real if the FIRST
    // url is OAuth-shaped OR it's a scripted window.open popup (shape, not url).
    if (helpers.shouldKeepPopupReal(url) ||
        helpers.isScriptedHandbackPopup(disposition, features, frameName)) {
      const webPreferences = { contextIsolation: true, nodeIntegration: false };
      const part = resolveOpenerPartition(contents);
      if (part) webPreferences.partition = part;            // explicit for persist:*
      return { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences } };
    }
    return { action: 'deny' };
  });
  contents.on('did-create-window', (win) => { cur.popupWin = win; });
});

async function runScenario(partition, cookie, port, opts = {}) {
  cur = { guest: null, popupWin: null, host: null };
  const host = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false } });
  cur.host = host;
  const b = opts.bounce ? '&b=1' : '';
  await host.loadURL(`http://localhost:${port}/host.html?p=${encodeURIComponent(partition)}&c=${encodeURIComponent(cookie)}${b}`);
  let tries = 0;
  while ((!cur.popupWin || cur.popupWin.webContents.isLoading()) && tries++ < 80) await wait(100);
  await wait(300);
  return cur;
}

app.whenReady().then(() => {
  server.listen(0, async () => {
    const port = server.address().port;
    // Clean slate (throwaway 'Electron' profile, not Vex's) so presence/absence
    // checks reflect THIS run, not leftovers.
    await session.fromPartition('persist:container-work').clearStorageData({ storages: ['cookies'] });
    await session.fromPartition('persist:main').clearStorageData({ storages: ['cookies'] });

    // ===== Scenario A: container tab — EXPLICIT partition =====
    {
      const s = await runScenario('persist:container-work', 'vexoauth', port);
      console.log('\n-- Scenario A: persist:container-work (explicit) --');
      const openerPart = s.guest ? resolveOpenerPartition(s.guest) : null;
      check('A: opener partition resolves to persist:container-work', openerPart === 'persist:container-work');
      check('A: OAuth-shaped popup allowed as a real window', !!s.popupWin && !s.popupWin.isDestroyed());
      if (s.popupWin) {
        const openerSes = s.guest.session, popupSes = s.popupWin.webContents.session;
        check('A: popup.session === opener.session', popupSes === openerSes);
        const pp = (popupSes.getStoragePath && popupSes.getStoragePath()) || '';
        check('A: popup storage path is …/Partitions/container-work', /[\\/]Partitions[\\/]container-work$/.test(pp));
        const hasOpener = await s.popupWin.webContents.executeJavaScript('!!window.opener').catch(() => false);
        check('A: window.opener non-null in popup', hasOpener === true);
        await wait(150);
        const inC = await session.fromPartition('persist:container-work').cookies.get({ name: 'vexoauth' });
        const inM = await session.fromPartition('persist:main').cookies.get({ name: 'vexoauth' });
        check('A: cookie present in persist:container-work', inC.length > 0);
        check('A: cookie ABSENT from persist:main', inM.length === 0);
      }
      try { s.popupWin && !s.popupWin.isDestroyed() && s.popupWin.close(); } catch {}
      try { s.host && !s.host.isDestroyed() && s.host.close(); } catch {}
    }

    // ===== Scenario B: off-the-record tab — IMPLICIT inheritance =====
    {
      const OTR = 'otr-verify';
      const s = await runScenario(OTR, 'vexotr', port);
      console.log('\n-- Scenario B: ' + OTR + ' (in-memory, implicit inheritance) --');
      const openerPart = s.guest ? resolveOpenerPartition(s.guest) : 'n/a';
      console.log('      resolveOpenerPartition(otr) =', JSON.stringify(openerPart), '(expected null — no derivable string)');
      check('B: OTR partition is NOT derivable (null) — the documented exception', openerPart === null);
      check('B: OAuth-shaped popup allowed as a real window', !!s.popupWin && !s.popupWin.isDestroyed());
      if (s.popupWin) {
        const openerSes = s.guest.session, popupSes = s.popupWin.webContents.session;
        const otrSes = session.fromPartition(OTR);
        check('B: popup.session === opener.session (identity via inheritance)', popupSes === openerSes);
        check('B: popup.session === session.fromPartition(otr) (it IS the OTR jar)', popupSes === otrSes);
        const hasOpener = await s.popupWin.webContents.executeJavaScript('!!window.opener').catch(() => false);
        check('B: window.opener non-null in popup', hasOpener === true);
        await wait(150);
        const inOtr = await otrSes.cookies.get({ name: 'vexotr' });
        const inMain = await session.fromPartition('persist:main').cookies.get({ name: 'vexotr' });
        check('B: cookie present in the OTR session', inOtr.length > 0);
        check('B: cookie ABSENT from persist:main', inMain.length === 0);
        // Ephemerality: in-memory session has no on-disk storage path, and no
        // Partitions/otr-verify dir is created.
        const otrPath = (otrSes.getStoragePath && otrSes.getStoragePath()) || '';
        const popupPath = (popupSes.getStoragePath && popupSes.getStoragePath()) || '';
        console.log('      OTR getStoragePath() =', JSON.stringify(otrPath));
        check('B: OTR session has NO on-disk storage path (ephemeral)', !otrPath && !popupPath);
        const otrDir = path.join(app.getPath('userData'), 'Partitions', OTR);
        check('B: no Partitions/' + OTR + ' dir written to disk', !fs.existsSync(otrDir));
      }
      try { s.popupWin && !s.popupWin.isDestroyed() && s.popupWin.close(); } catch {}
      try { s.host && !s.host.isDestroyed() && s.host.close(); } catch {}
    }

    // ===== Scenario C: BOUNCE then OAuth — the real Ticket Tool/Discord flow =====
    // The popup opens at a NON-OAuth-shaped bounce URL (like
    // api.tickettool.xyz/api/auth/login) WITH window features + a name, then
    // 302-redirects into an OAuth-shaped URL. URL-shape gating alone would DENY
    // this (first url not shaped) and the popup would dead-end in Peek — the bug.
    // It can only stay real via the disposition+features gate. We prove the popup
    // stays real with window.opener intact THROUGH the redirect, pinned to the
    // opener's partition.
    {
      const bounceFirstUrl = `http://localhost:${port}/bounce?c=vexbounce`;
      // The thing that makes this scenario meaningful: the FIRST url is NOT
      // OAuth-shaped, so the old shape-only gate could never have allowed it.
      check('C: first (bounce) URL is NOT OAuth-shaped — shape gate cannot save it',
        helpers.shouldKeepPopupReal(bounceFirstUrl) === false);
      const s = await runScenario('persist:container-work', 'vexbounce', port, { bounce: true });
      console.log('\n-- Scenario C: persist:container-work, bounce -> OAuth redirect --');
      check('C: scripted bounce popup allowed as a real window (disposition gate)',
        !!s.popupWin && !s.popupWin.isDestroyed());
      if (s.popupWin) {
        const finalUrl = s.popupWin.webContents.getURL();
        console.log('      popup final URL =', finalUrl);
        check('C: popup redirected through bounce into the OAuth URL', /\/oauth\.html/.test(finalUrl));
        const openerSes = s.guest.session, popupSes = s.popupWin.webContents.session;
        check('C: popup.session === opener.session', popupSes === openerSes);
        const pp = (popupSes.getStoragePath && popupSes.getStoragePath()) || '';
        check('C: popup pinned to …/Partitions/container-work', /[\\/]Partitions[\\/]container-work$/.test(pp));
        const hasOpener = await s.popupWin.webContents.executeJavaScript('!!window.opener').catch(() => false);
        check('C: window.opener STILL non-null after the redirect', hasOpener === true);
        await wait(150);
        const inC = await session.fromPartition('persist:container-work').cookies.get({ name: 'vexbounce' });
        const inM = await session.fromPartition('persist:main').cookies.get({ name: 'vexbounce' });
        check('C: post-redirect cookie present in persist:container-work', inC.length > 0);
        check('C: post-redirect cookie ABSENT from persist:main', inM.length === 0);
      }
      try { s.popupWin && !s.popupWin.isDestroyed() && s.popupWin.close(); } catch {}
      try { s.host && !s.host.isDestroyed() && s.host.close(); } catch {}
    }

    const failed = results.filter(r => !r.ok);
    console.log(`\n${failed.length ? 'RESULT: FAIL (' + failed.length + ')' : 'RESULT: PASS — all ' + results.length + ' checks'}`);
    server.close();
    app.exit(failed.length ? 1 : 0);
  });
});
