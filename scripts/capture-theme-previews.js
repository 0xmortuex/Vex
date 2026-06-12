// Capture a consistent preview PNG for every theme by rendering the
// _preview.html mock window (assets/theme-previews/_preview.html) under each
// data-theme and screenshotting it. Run: `npm run capture-themes`.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Only the newer themes — the original 8 keep their hand-captured screenshots.
// Pass `--all` to regenerate every theme.
const ALL = [
  'oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin',
  'sunset', 'rose', 'matrix', 'mocha', 'solarized', 'vaporwave',
  'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome', 'custom',
];
const NEW = ['sunset', 'rose', 'matrix', 'mocha', 'solarized', 'vaporwave', 'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome', 'custom'];
const THEMES = process.argv.includes('--all') ? ALL : NEW;
const OUT = path.join(__dirname, '..', 'assets', 'theme-previews');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 600, show: false,
    webPreferences: { offscreen: false },
  });
  for (const id of THEMES) {
    await win.loadFile(path.join(OUT, '_preview.html'), { search: 'theme=' + id });
    await new Promise(r => setTimeout(r, 350));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, id + '.png'), img.toPNG());
    console.log('captured', id + '.png');
  }
  win.destroy();
  app.quit();
}).catch(err => { console.error(err); app.quit(); });
