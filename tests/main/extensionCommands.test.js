// Extensions' keyboard shortcuts (chrome.commands), 2026-10-08
// (src/main/extension-commands.js): the manifest's suggested keys, the keys
// you choose, and never a key Vex itself answers.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/main/extension-commands.js');

describe('a manifest key in Vex\'s words', () => {
  it('reads Chrome\'s key names', () => {
    expect(C.normalizeKey('Ctrl+Shift+Y')).toEqual({ combo: 'Ctrl+Shift+Y' });
    expect(C.normalizeKey('Shift+Alt+p')).toEqual({ combo: 'Alt+Shift+P' });
    expect(C.normalizeKey('Ctrl+Comma')).toEqual({ combo: 'Ctrl+,' });
    expect(C.normalizeKey('Alt+Up')).toEqual({ combo: 'Alt+Up' });
    expect(C.normalizeKey('Command+Shift+1')).toEqual({ combo: 'Ctrl+Shift+1' });
    expect(C.normalizeKey('Alt+F5')).toEqual({ combo: 'Alt+F5' });
  });
  it('refuses what Chrome refuses on Windows', () => {
    expect(C.normalizeKey('Shift+Y').error).toMatch(/needs Ctrl or Alt/);
    expect(C.normalizeKey('Ctrl+Alt+Y').error).toMatch(/AltGr/);
    expect(C.normalizeKey('MediaPlayPause').error).toMatch(/media key/);
    expect(C.normalizeKey('Ctrl+Tab').error).toMatch(/not a key/);
    expect(C.normalizeKey('Hyper+Y').error).toMatch(/not a modifier/);
  });
  it('says it back the way Chrome writes it', () => {
    expect(C.toChrome('Ctrl+,')).toBe('Ctrl+Comma');
    expect(C.toChrome('Alt+Shift+P')).toBe('Alt+Shift+P');
    expect(C.toChrome('')).toBe('');
  });
});

describe('the key pressed', () => {
  it('is the physical key, so Ctrl+Shift+1 is not Ctrl+Shift+!', () => {
    expect(C.comboFromInput({ key: '!', code: 'Digit1', control: true, shift: true })).toBe('Ctrl+Shift+1');
    expect(C.comboFromInput({ key: 'Y', code: 'KeyY', control: true, shift: true })).toBe('Ctrl+Shift+Y');
    expect(C.comboFromInput({ key: 'y', ctrl: true, shift: true })).toBe('Ctrl+Shift+Y');
    expect(C.comboFromInput({ key: 'ArrowUp', code: 'ArrowUp', alt: true })).toBe('Alt+Up');
    expect(C.comboFromInput({ key: 'Control', control: true })).toBe('');
  });
});

describe('who gets which key', () => {
  const ext = (folder, commands, name = folder) => ({ folder, id: folder.padEnd(32, 'a').slice(0, 32), name, manifest: { commands } });
  const vex = (taken) => (combo) => taken[combo] || null;

  it('the suggested key, unless Vex answers it or an earlier extension has it', () => {
    const r = C.resolve([
      ext('a', { run: { suggested_key: { default: 'Ctrl+Shift+Y', windows: 'Alt+Shift+R' }, description: 'Run' }, _execute_action: { suggested_key: { default: 'Ctrl+Shift+E' } } }),
      ext('b', { go: { suggested_key: { default: 'Alt+Shift+R' } }, mute: { suggested_key: { default: 'Ctrl+M' } } }),
    ], {}, vex({ 'Ctrl+M': 'Mute Tab' }));
    expect(r.byCombo.get('Alt+Shift+R')).toMatchObject({ folder: 'a', command: 'run' });
    expect(r.byCombo.get('Ctrl+Shift+E')).toMatchObject({ folder: 'a', command: '_execute_action' });
    const b = Object.fromEntries(r.byFolder.b.map(x => [x.name, x]));
    expect(b.go).toMatchObject({ shortcut: '', conflict: 'extension', conflictWith: 'a' });
    expect(b.mute).toMatchObject({ shortcut: '', conflict: 'vex', conflictWith: 'Mute Tab' });
    expect(r.byFolder.a.find(x => x.name === '_execute_action').description).toBe('Activate the extension');
  });
  it('a key you chose comes first; one you removed is gone', () => {
    const r = C.resolve([
      ext('a', { run: { suggested_key: { default: 'Alt+Shift+R' } } }),
      ext('b', { go: { suggested_key: { default: 'Alt+Shift+G' } } }),
    ], { b: { go: 'Alt+Shift+R' }, a: { run: '' } }, vex({}));
    expect(r.byCombo.get('Alt+Shift+R')).toMatchObject({ folder: 'b', command: 'go' });
    expect(r.byFolder.a[0]).toMatchObject({ shortcut: '', source: 'removed' });
    expect(r.byFolder.b[0]).toMatchObject({ shortcut: 'Alt+Shift+R', source: 'user', suggested: 'Alt+Shift+G' });
  });
  it('Vex\'s own keys are known, including the page-first ones', () => {
    for (const k of ['Ctrl+T', 'Ctrl+B', 'Ctrl+Shift+M', 'Ctrl+Shift+Z', 'Ctrl+K', 'Ctrl+1', 'Ctrl+C', 'Alt+Left']) {
      expect(C.FIXED_VEX_KEYS.has(k), k).toBe(true);
    }
    expect(C.FIXED_VEX_KEYS.has('Alt+Shift+Y')).toBe(false);
  });
});

describe('the keys you chose are kept beside the extensions', () => {
  it('round-trips, drops what could not be a key, and says when the file is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-extcmd-'));
    try {
      expect(C.readOverrides(dir)).toEqual({});
      C.writeOverrides(dir, { a: { run: 'Alt+Shift+R', off: '' } });
      expect(C.readOverrides(dir)).toEqual({ a: { run: 'Alt+Shift+R', off: '' } });
      fs.writeFileSync(path.join(dir, C.OVERRIDES_FILE), JSON.stringify({ a: { bad: 'Y', ok: 'Ctrl+Shift+1' } }));
      expect(C.readOverrides(dir)).toEqual({ a: { ok: 'Ctrl+Shift+1' } });
      fs.writeFileSync(path.join(dir, C.OVERRIDES_FILE), '[]');
      expect(() => C.readOverrides(dir)).toThrow(/corrupt/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
