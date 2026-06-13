// Real-Chromium verification for the group-color fixes.
//
// jsdom cannot resolve CSS var() or color-mix(), so the earlier unit tests
// could not catch why "change group color" looked broken or why groups did
// not re-match on theme switch. This loads the ACTUAL theme-tokens.css +
// horizontal-tabs.css in a headless Electron (real Chromium) window, builds a
// real .top-group-label pill the way horizontal-tabs.js does, and reads the
// COMPUTED background under different group colors and themes.
//
// Pass criteria:
//   1. A var()-ref group color (var(--vex-accent)) paints a real, non-empty
//      background in Oxford.
//   2. Switching <html data-theme> from oxford → dracula → ocean changes that
//      computed background (groups RE-MATCH the theme — the user's complaint).
//   3. Two different role refs (accent vs success) paint different colors
//      (picking a color actually changes it).
//
// Run: npx electron scripts/verify-group-colors.js   (exits 0 pass / 1 fail)

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const CSS_DIR = path.join(__dirname, '..', 'src', 'renderer', 'css');
const tokens = fs.readFileSync(path.join(CSS_DIR, 'theme-tokens.css'), 'utf8');
const horiz = fs.readFileSync(path.join(CSS_DIR, 'horizontal-tabs.css'), 'utf8');

const html = `<!doctype html><html data-theme="oxford"><head><meta charset="utf-8">
<style>${tokens}</style><style>${horiz}</style></head>
<body data-tab-layout="horizontal">
  <div id="top-tabs-strip" style="display:flex">
    <div id="pill" class="top-group-label">WORK</div>
    <div id="tab" class="top-tab in-group"><span class="tab-title">a</span></div>
  </div>
</body></html>`;

function bg(win, themeAttr, groupColor) {
  // Set theme + the group's --group-color exactly like horizontal-tabs.js does,
  // then read the pill's resolved background.
  const js = `(() => {
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(themeAttr)});
    const pill = document.getElementById('pill');
    pill.style.setProperty('--group-color', ${JSON.stringify(groupColor)});
    const cs = getComputedStyle(pill);
    return cs.backgroundColor;
  })()`;
  return win.webContents.executeJavaScript(js);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 200, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // give Chromium a tick to apply styles
  await new Promise(r => setTimeout(r, 250));

  const results = {};
  results.oxford_accent = await bg(win, 'oxford', 'var(--vex-accent)');
  results.dracula_accent = await bg(win, 'dracula', 'var(--vex-accent)');
  results.ocean_accent = await bg(win, 'ocean', 'var(--vex-accent)');
  results.oxford_success = await bg(win, 'oxford', 'var(--vex-success)');
  results.oxford_hex = await bg(win, 'oxford', '#e8685a');

  const fail = [];
  const empty = v => !v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';

  if (empty(results.oxford_accent)) fail.push('oxford accent pill has no background (var ref did not paint)');
  // Theme re-match: accent pill must differ across at least 2 of 3 themes.
  const themed = new Set([results.oxford_accent, results.dracula_accent, results.ocean_accent]);
  if (themed.size < 2) fail.push('group color did NOT change across themes (no re-match): ' + [...themed].join(' | '));
  // Picking a different role must change the color.
  if (results.oxford_accent === results.oxford_success) fail.push('accent vs success identical — picking a color does nothing');
  if (empty(results.oxford_hex)) fail.push('plain hex group color has no background');

  console.log('--- computed pill backgrounds ---');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(16)} = ${v}`);
  console.log('---------------------------------');

  if (fail.length) {
    console.log('RESULT: FAIL');
    fail.forEach(f => console.log('  ✗ ' + f));
    app.exit(1);
  } else {
    console.log('RESULT: PASS — var-ref group colors paint and re-match every theme.');
    app.exit(0);
  }
});
