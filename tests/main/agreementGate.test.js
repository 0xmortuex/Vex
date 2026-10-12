// While the agreement is up in a window (js/legal.js), the keys main acts on
// itself did not stand aside: Ctrl+T, Ctrl+K and the rest went straight to
// the window from main's before-input-event, and a page's keys were passed up
// (release check, 2026-10-12). The window tells main (legal:gate), and every
// key path in main asks src/main/agreement-gate.js first.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const { createAgreementGate } = require('../../src/main/agreement-gate.js');
const { validatePayload, UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8');

function fakeWindow(id) {
  const webContents = Object.assign(new EventEmitter(), { id, isDestroyed: () => false });
  return { webContents, isDestroyed: () => false };
}

describe('the gate', () => {
  it('holds a window\'s keys back while its agreement is up, and only that window\'s', () => {
    const gate = createAgreementGate();
    const a = fakeWindow(1), b = fakeWindow(2);
    expect(gate.blocks(a)).toBe(false);
    gate.set(a.webContents, true);
    expect(gate.blocks(a)).toBe(true);
    expect(gate.blocks(b)).toBe(false);
    gate.set(a.webContents, false);
    expect(gate.blocks(a)).toBe(false);
  });

  it('a window that goes away is forgotten (its id may be used again)', () => {
    const gate = createAgreementGate();
    const a = fakeWindow(7);
    gate.set(a.webContents, true);
    gate.set(a.webContents, true);
    expect(a.webContents.listenerCount('destroyed')).toBe(1);
    a.webContents.emit('destroyed');
    expect(gate.blocks(fakeWindow(7))).toBe(false);
  });

  it('no window, or one already gone, is not blocked', () => {
    const gate = createAgreementGate();
    expect(gate.blocks(null)).toBe(false);
    const a = fakeWindow(3);
    gate.set(a.webContents, true);
    expect(gate.blocks({ ...a, isDestroyed: () => true })).toBe(false);
  });

  it('refuses anything but true or false', () => {
    const gate = createAgreementGate();
    expect(() => gate.set(fakeWindow(1).webContents, 'yes')).toThrow();
  });
});

describe('legal:gate', () => {
  it('only Vex\'s own window may say it, with true or false', () => {
    expect(UI_ONLY_CHANNELS.has('legal:gate')).toBe(true);
    expect(() => validatePayload('legal:gate', [true])).not.toThrow();
    expect(() => validatePayload('legal:gate', ['x'])).toThrow();
    expect(PRELOAD).toMatch(/legalGate: \(up\) => ipcRenderer\.send\('legal:gate', up\)/);
  });
});

describe('every key path in main asks the gate', () => {
  const body = (start, end) => { const i = MAIN.indexOf(start); expect(i, start).toBeGreaterThan(-1); return MAIN.slice(i, MAIN.indexOf(end, i)); };

  it('the main window\'s own keys (Ctrl+T, Ctrl+K, zoom, F11...)', () => {
    const h = body("mainWindow.webContents.on('before-input-event'", "mainWindow.webContents.send('toggle-command-bar')");
    expect(h).toMatch(/_agreementGate\.blocks\(mainWindow\)\) return;/);
  });

  it('a page\'s keys: passed up, page-first, the command bar, dictation, extensions, fullscreen', () => {
    const h = body('fired on GUEST webContents', 'handleBrowserShortcut(event, input, contents);');
    expect(h).toMatch(/_agreementBlocks\(contents\) \|\| _agreementGate\.blocks\(mainWindow\)\) return;/);
    expect(body('function _shortcutWindow(contents)', '\n}')).toMatch(/_agreementGate\.blocks\(win\)/);
  });

  it('DevTools and the boss key, in every window and page', () => {
    expect(body('function handleWindowKeys(event, input, contents)', 'const action =')).toMatch(/_agreementBlocks\(contents\)\) return false;/);
  });
});
