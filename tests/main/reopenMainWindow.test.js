// Audit TA6 (2026-10-10): with the main window closed and a private window (or
// an Open as App window) still open, Vex kept running but had no main window.
// A link from another program was stashed for a window that never came, a
// second start did nothing, and a link clicked in an app window was dropped.
// Now the main window is made again, with its keys, and the link opens in it.
// Driven for real in the probe (scratchpad b1b); this pins the wiring.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const block = (start, len = 1200) => MAIN.slice(MAIN.indexOf(start), MAIN.indexOf(start) + len);

describe('a main window made again', () => {
  it('second-instance: a link, or a plain second start, opens the main window again when it is gone', () => {
    const si = block("app.on('second-instance'", 4000);
    expect(si).toMatch(/\} else if \(url && !mainWindow\) \{[\s\S]{0,200}_reopenMainWindow\(url\);/);
    expect(si).toContain('if (!mainWindow) _reopenMainWindow(null);');
    expect(si).not.toMatch(/else if \(url && !mainWindow\) \{[^}]*pendingOpenUrl = url;/);
  });

  it('a link from an Open as App window with no main window opens it again', () => {
    expect(block('function _openLinksAsTabs(', 500)).toContain('else _reopenMainWindow(url);');
  });

  it('it is made with its keys and gets the link once it has loaded; while Vex is still starting the link waits', () => {
    const fn = block('function _reopenMainWindow(', 500);
    expect(fn).toContain('if (!_wireMainWindowKeys) { if (url) pendingOpenUrl = url; return; }');
    expect(fn.indexOf('createWindow();')).toBeLessThan(fn.indexOf('_wireMainWindowKeys();'));
    expect(fn).toContain("wc.once('did-finish-load', () => { if (!wc.isDestroyed()) wc.send('open-url', url); });");
  });

  it('the main window\'s keys are one function, used at start and for a window made again', () => {
    const ready = MAIN.slice(MAIN.indexOf('  // Register global shortcuts'), MAIN.indexOf('  // Disable default menu'));
    expect(ready).toMatch(/^ {2}\/\/ Register global shortcuts\n {2}_wireMainWindowKeys = \(\) => \{\n {2}mainWindow\.on\('blur'/);
    expect(ready.trimEnd().endsWith('  };\n  _wireMainWindowKeys();')).toBe(true);
  });

  it('what createWindow registers only once stays registered only once', () => {
    expect(block('function createWindow()', 30000)).toContain('if (!ipcMain.__vexBypassWired) {');
  });
});
