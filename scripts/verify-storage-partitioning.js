// Proves the ThirdPartyStoragePartitioning fix actually changes Chromium's
// behavior — the root cause of the Firebase "missing initial state" sign-in
// error on sites like ElevenLabs.
//
// Setup: localhost and 127.0.0.1 are two distinct origins on the loopback.
//   1. Load b.html as TOP-LEVEL on http://localhost  → it writes localStorage.foo='TOP'
//   2. Load a.html on http://127.0.0.1 which embeds an IFRAME to http://localhost/b.html
//      → the iframe reads localStorage.foo and reports it.
//
// With partitioning ON  (Chromium default): the embedded localhost iframe gets a
//   storage bucket keyed by the 127.0.0.1 top-site → it CANNOT see 'TOP' → null.
//   (This is exactly why Firebase's auth-handler iframe loses its state.)
// With partitioning OFF (our flag): the iframe uses localhost's first-party
//   storage → it reads 'TOP'.
//
// Run WITH the fix:     npx electron scripts/verify-storage-partitioning.js off
// Run WITHOUT (control): npx electron scripts/verify-storage-partitioning.js on

const { app, BrowserWindow } = require('electron');
const http = require('http');

const mode = process.argv[2] === 'off' ? 'off' : 'on'; // 'off' = apply the Vex fix
if (mode === 'off') app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'text/html');
  const port = server.address().port;
  if (u.pathname === '/b.html') {
    res.end(`<!doctype html><meta charset=utf-8><script>
      const m = new URLSearchParams(location.search).get('m');
      if (m === 'write') { try { localStorage.setItem('foo','TOP'); } catch(e){} document.title = 'wrote'; }
      else { let v = null; try { v = localStorage.getItem('foo'); } catch(e){ v = 'ERR'; }
        if (window.parent !== window) parent.postMessage({ foo: v }, '*');
      }
    </script>`);
  } else if (u.pathname === '/a.html') {
    res.end(`<!doctype html><meta charset=utf-8><script>
      window.__result = 'PENDING';
      addEventListener('message', e => { if (e.data && 'foo' in e.data) window.__result = String(e.data.foo); });
    </script><iframe src="http://localhost:${port}/b.html?m=read"></iframe>`);
  } else { res.statusCode = 404; res.end('no'); }
});

app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const win = new BrowserWindow({ show: false, webPreferences: {} });

  await win.loadURL(`http://localhost:${port}/b.html?m=write`); // first-party write on localhost
  await wait(200);
  await win.loadURL(`http://127.0.0.1:${port}/a.html`);          // 127.0.0.1 embeds localhost iframe
  await wait(700);
  const result = await win.webContents.executeJavaScript('window.__result');

  const partitioned = (result !== 'TOP');
  console.log(`mode: ${mode === 'off' ? 'FIX APPLIED (partitioning disabled)' : 'CONTROL (Chromium default)'}`);
  console.log(`iframe read of cross-site localStorage: ${JSON.stringify(result)}`);
  console.log(`storage partitioned: ${partitioned}`);
  // Expected: control(on) → partitioned=true (null); fix(off) → partitioned=false ('TOP')
  const expectedOk = mode === 'off' ? result === 'TOP' : partitioned;
  console.log('RESULT:', expectedOk ? 'PASS' : 'FAIL');
  app.exit(expectedOk ? 0 : 1);
});
