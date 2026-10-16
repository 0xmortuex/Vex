// Audit (2026-10): saved "Open as App" windows reopened on top of the lock
// screen, and links or quick capture from other programs bypassed the lock.
// Main now holds them in memory while locked and runs them after the PIN.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

describe('main.js holds outside requests while locked', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const block = (start, len = 900) => {
    const i = MAIN.indexOf(start);
    expect(i, start).toBeGreaterThan(-1);
    return MAIN.slice(i, i + len);
  };

  it('an app window is refused while locked, before anything else happens', () => {
    expect(block('function _openAppWindow(', 120)).toContain('_refuseWhileLocked();');
  });

  it('"Reopen closed window" is refused before the entry is taken off the list', () => {
    const h = block("ipcMain.handle('windows:reopen-closed'", 500);
    expect(h.indexOf('_refuseWhileLocked()')).toBeGreaterThan(-1);
    expect(h.indexOf('_refuseWhileLocked()')).toBeLessThan(h.indexOf('_windowSet.takeClosed()'));
  });

  it('saved app windows wait for the PIN and come back on unlock', () => {
    expect(block('mainWindow.webContents.once(\'did-finish-load\', () => setTimeout(() => {', 300)).toContain('if (_vexLocked) { _appRestoreHeld = true; return; }');
    expect(block("ipcMain.handle('vex-lock:unlock'", 900)).toContain('if (_appRestoreHeld) { _appRestoreHeld = false; _restoreAppWindows(); }');
  });

  it('a link from another program is held before the mini window can take it, and opens after unlock', () => {
    const h = block("app.on('second-instance'", 4500);
    const held = h.indexOf('if (url && _vexLocked) { _holdLinkWhileLocked(url); return; }');
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(h.indexOf('_miniWindows().take(url)'));
    expect(block("ipcMain.handle('vex-lock:unlock'", 900)).toContain('_openHeldLinks();');
    expect(block('function _holdLinkWhileLocked', 300)).toContain('MAX_HELD_LINKS');
  });

  it('quick capture opens no window while locked', () => {
    expect(block('function openQuickCapture()', 300)).toContain('if (_vexLocked)');
    expect(block('function openQuickCapture()', 300).indexOf('_vexLocked')).toBeLessThan(block('function openQuickCapture()', 600).indexOf('new BrowserWindow'));
  });
});
