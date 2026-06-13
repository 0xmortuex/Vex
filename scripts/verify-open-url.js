// Real-Electron verification of the cold-start open-url race fix.
//
// Reproduces the exact scenario: main sends 'open-url' at did-finish-load,
// while the (real, sandboxed) preload.js is loaded and the page registers its
// onOpenUrl handler LATE (after a delay, like the renderer's async init). The
// buffered URL must still reach the late handler.
//
// Run: npx electron scripts/verify-open-url.js   (exits 0 pass / 1 fail)

const { app, BrowserWindow } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, '..', 'src', 'preload.js');
const TEST_URL = 'https://example.com/the-clicked-link';

// Minimal page: registers onOpenUrl only AFTER a 600ms delay (simulating the
// renderer's late async init), then records what it received on window.__got.
const page = `<!doctype html><meta charset="utf-8"><title>boot</title><script>
  window.__got = null;
  setTimeout(() => {
    window.vex.onOpenUrl((u) => { window.__got = u; document.title = 'GOT:' + u; });
  }, 600);
</script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });

  // Send the URL the instant the page finishes loading — BEFORE the page's
  // 600ms-delayed onOpenUrl registration. This is the cold-start race.
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('open-url', TEST_URL);
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));

  // Wait past the 600ms late registration + flush.
  await new Promise(r => setTimeout(r, 1200));
  const got = await win.webContents.executeJavaScript('window.__got');

  console.log('--- cold-start open-url ---');
  console.log('  sent : ' + TEST_URL);
  console.log('  got  : ' + got);
  console.log('---------------------------');

  if (got === TEST_URL) {
    console.log('RESULT: PASS — buffered URL reached the late-registered handler.');
    app.exit(0);
  } else {
    console.log('RESULT: FAIL — clicked link was dropped (Vex would open to start page).');
    app.exit(1);
  }
});
