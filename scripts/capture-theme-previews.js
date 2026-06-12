// Render a consistent preview for every theme by loading the _preview.html
// app-replica (a faithful static copy of the Vex window — top bar, sidebar,
// tabs, Settings/Vex Sync content) under each data-theme and screenshotting it
// at 1400x600 (matching the original previews). Reliable and identical in style
// across all themes. Run: `npm run capture-themes`.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const THEMES = [
  'oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin',
  'sunset', 'rose', 'matrix', 'mocha', 'solarized', 'vaporwave',
  'aurora', 'crimson', 'gold', 'sakura', 'cyberpunk', 'monochrome',
  'slate', 'emerald', 'amethyst', 'volcano', 'sapphire', 'honey', 'mint', 'obsidian', 'custom',
];
const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const list = args.length ? args : THEMES;
const OUT = path.join(__dirname, '..', 'assets', 'theme-previews');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 600, show: false, webPreferences: { offscreen: false } });
  for (const id of list) {
    await win.loadFile(path.join(OUT, '_preview.html'), { search: 'theme=' + id });
    await new Promise(r => setTimeout(r, 350));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, id + '.png'), img.toPNG());
    console.log('captured', id + '.png');
  }
  win.destroy();
  app.quit();
}).catch(err => { console.error(err); app.quit(); });
