// @vitest-environment jsdom
//
// The keyboard audit (2026-11-06) as a test that cannot rot: every key Vex answers is in ONE table
// (docs/KEYBOARD-SHORTCUTS.md, generated from the code by scripts/gen-shortcuts-doc.js), no two actions
// share a key, every key has something behind it, every key a page leaves alone gets to Vex, and the
// places that name keys (README, FAQ, the Ctrl+K hints) name keys that exist.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let Registry, CommandBar, Guest, gen;
const NATIVE = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Esc', 'Escape']);

beforeAll(() => {
  localStorage.clear();
  Registry = require('../../src/renderer/js/shortcuts-registry.js');
  globalThis.ShortcutsRegistry = Registry;
  ({ CommandBar } = require('../../src/renderer/js/command.js'));
  globalThis.CommandBar = CommandBar;
  Guest = require('../../src/main/guest-shortcuts.js');
  gen = require('../../scripts/gen-shortcuts-doc.js');
});
beforeEach(() => { Registry.resetAll(); });

const known = () => {
  const out = new Set(Object.values(Registry.getAllShortcuts()).map(d => d.current));
  for (const k of Object.keys(Registry.fixedKeys())) out.add(k);
  for (const k of NATIVE) out.add(k);
  out.add('Ctrl+Shift+I'); out.add('Ctrl+Shift+J');
  return out;
};

describe('the master table', () => {
  it('docs/KEYBOARD-SHORTCUTS.md is the table the code makes (run node scripts/gen-shortcuts-doc.js after moving a key)', () => {
    const have = read('docs/KEYBOARD-SHORTCUTS.md').replace(/\r\n/g, '\n');
    expect(have).toBe(gen.render());
  });

  it('lists every registry key', () => {
    const rows = gen.buildRows();
    for (const id of Object.keys(Registry.getAllShortcuts())) expect(rows.some(r => r.id === id), id).toBe(true);
  });
});

describe('conflicts and dead keys', () => {
  it('no two actions share a default key', () => {
    const seen = new Map();
    for (const [id, d] of Object.entries(Registry.getAllShortcuts())) {
      expect(seen.has(d.current), `${d.current} is on both ${seen.get(d.current)} and ${id}`).toBe(false);
      seen.set(d.current, id);
    }
  });

  it('no default sits on a key Vex answers outside the list, and every default is a key that can be bound', () => {
    const fixed = Registry.fixedKeys();
    for (const [id, d] of Object.entries(Registry.getAllShortcuts())) {
      if (fixed[d.current]) {
        // Ctrl+0 and Ctrl+Tab are in both places on purpose: the registry entry IS that key.
        expect(['zoom-reset', 'next-tab', 'prev-tab'], `${id} sits on the fixed key ${d.current}`).toContain(id);
      }
      expect(Registry.getAllShortcuts()[id].current).toBe(d.default);
    }
  });

  it('every registry entry has a handler in app.js or names a Ctrl+K command that exists', () => {
    const app = read('src/renderer/js/app.js');
    const registered = new Set([...app.matchAll(/ShortcutsRegistry\.register\('([^']+)'/g)].map(m => m[1]));
    const commands = new Set(CommandBar.commands.map(c => c.id));
    // split-keys.js and link-hints.js add their commands when they load; the ids are in their own files.
    const elsewhere = ['split-focus-next', 'split-swap-panes', 'tab-hints', 'link-hints', 'search-selection'];
    for (const [id, d] of Object.entries(Registry.getAllShortcuts())) {
      if (d.cmd) {
        const ok = commands.has(d.cmd) || elsewhere.includes(d.cmd) || fs.readdirSync(path.join(ROOT, 'src/renderer/js')).some(f => f.endsWith('.js') && read('src/renderer/js/' + f).includes("id: '" + d.cmd + "'"));
        expect(ok, `${id} runs the command ${d.cmd}, which does not exist`).toBe(true);
      } else {
        expect(registered.has(id), `${id} (${d.current}) has no handler: it does nothing`).toBe(true);
      }
    }
    // ... and nothing is registered for an id the registry does not know.
    const all = Registry.getAllShortcuts();
    for (const id of registered) expect(all[id], `app.js registers ${id}, which is not in the registry`).toBeTruthy();
  });

  it('every key a page leaves alone gets to Vex (taken first, passed up, or reported by the page preload)', () => {
    const all = Registry.getAllShortcuts();
    const wanted = new Set(Object.values(all).map(d => d.current));
    for (const k of ['Ctrl+Alt+1', 'Ctrl+Alt+2', 'Ctrl+Alt+3']) wanted.add(k);
    const rows = gen.buildRows();
    for (const r of rows.filter(x => x.id !== '-')) {
      expect(r.page, `${r.combo} (${r.id}) cannot be reached while a page has the focus`).not.toBe('not reachable from a page');
    }
    // the guest handler and the registry agree on the page-first letters the preload watches
    expect(Object.keys(Guest.PAGE_FIRST.plain).sort().join('')).toBe('bdhmpu');
  });
});

describe('what the ways of naming a key say', () => {
  it('every key a Ctrl+K command shows is a key that is bound', () => {
    const ok = known();
    for (const c of CommandBar.commands) {
      if (typeof c.shortcut === 'string' && c.shortcut) expect(ok.has(c.shortcut), `${c.id} shows ${c.shortcut}, which does nothing`).toBe(true);
    }
  });

  it('every key in the README table is a key Vex answers', () => {
    const text = read('README.md');
    const start = text.indexOf('## Keyboard shortcuts');
    const table = text.slice(start, text.indexOf('###', start));
    const ok = known();
    const bad = [];
    for (const m of table.matchAll(/`([^`]+)`/g)) {
      let t = m[1].replace('←', 'Left').replace('→', 'Right');
      if (/^Ctrl\+Alt\+1\/2\/3$/.test(t)) t = 'Ctrl+Alt+1';
      if (t === 'Ctrl+1…' || t === '…') continue;
      if (t === 'Ctrl++') t = 'Ctrl+=';
      if (!ok.has(t)) bad.push(t);
    }
    expect(bad).toEqual([]);
  });

  it('the README names the action each key really does', () => {
    const row = (key) => read('README.md').split('\n').find(l => l.includes('`' + key + '`')) || '';
    const cell = (key) => { const l = row(key); const parts = l.split('|').map(s => s.trim()); const at = parts.findIndex(p => p.includes('`' + key + '`')); return (parts[at + 1] || '').toLowerCase(); };
    expect(cell('Ctrl+Shift+O')).toMatch(/session/);
    expect(cell('Ctrl+Shift+O')).not.toMatch(/save session/);
    expect(cell('Ctrl+Shift+H')).toMatch(/history/);
    expect(cell('Ctrl+Shift+Z')).toMatch(/sleep tab\b/);
  });

  it('every key in an FAQ answer, in the Turkish FAQ and in a tip is a key Vex answers', () => {
    const ok = known();
    const bad = [];
    for (const f of ['src/renderer/js/faq-data.js', 'src/renderer/js/faq-tr.js', 'src/renderer/js/vex-fortune.js']) {
      for (const m of read(f).matchAll(/\b((?:Ctrl|Alt|Shift)(?:\+(?:Ctrl|Alt|Shift))*\+(?:[A-Z0-9]|F\d{1,2}|Tab|Delete|PageUp|PageDown))\b/g)) if (!ok.has(m[1])) bad.push(f + ': ' + m[1]);
    }
    expect(bad).toEqual([]);
  });

  it('a tip names the key that does what it says', () => {
    // [key, a word the tip must hold]: the registry label of each key says the same thing.
    const all = Registry.getAllShortcuts();
    const label = (combo) => Object.values(all).find(d => d.current === combo)?.label.toLowerCase() || '';
    const tips = [...read('src/renderer/js/vex-fortune.js').matchAll(/\['k', '((?:Ctrl|Alt|F)[^']*)'\]/g)].map(m => m[1]);
    expect(tips.length).toBeGreaterThan(20);
    const WORDS = { 'Ctrl+Alt+K': 'read later', 'Alt+Q': 'last tab', 'Ctrl+Shift+T': 'reopen', 'Ctrl+Alt+F': 'focus', 'Ctrl+J': 'ask', 'Ctrl+Alt+B': 'library', 'Ctrl+Alt+X': 'toolbox', 'Ctrl+Alt+E': 'everything', 'Ctrl+Shift+Z': 'sleep', 'Ctrl+Shift+S': 'split', 'Ctrl+Alt+M': 'memory', 'Ctrl+Alt+R': 'reading', 'Ctrl+Alt+S': 'screenshot', 'Ctrl+Alt+A': 'again', 'Ctrl+Alt+W': 'watch', 'Ctrl+Alt+C': 'clip', 'Ctrl+Alt+G': 'translate', 'Ctrl+Alt+J': 'download', 'Ctrl+Shift+G': 'organize', 'Ctrl+Shift+Y': 'theme', 'Ctrl+Shift+O': 'session', 'Ctrl+Alt+L': 'lock', 'Ctrl+Alt+N': 'incognito', 'Ctrl+B': 'sidebar', 'Ctrl+M': 'mute', 'F11': 'fullscreen', 'Ctrl+Alt+P': 'logins', 'Ctrl+Alt+T': 'tasks', 'Ctrl+Shift+A': 'ai', 'Ctrl+Shift+M': 'memory', 'Ctrl+H': 'history', 'Ctrl+Shift+P': 'picture', 'Ctrl+Shift+L': 'schedule', 'Ctrl+Alt+D': 'dictate', 'Ctrl+Shift+K': 'press' };
    for (const tip of tips) {
      const key = Object.keys(WORDS).filter(k => tip.startsWith(k + ' ')).sort((a, b) => b.length - a.length)[0];
      if (!key) continue;
      expect(label(key), `${key} -> ${tip}`).toContain(WORDS[key]);
    }
  });
});

describe('rebinding', () => {
  const press = (combo, target = document.body) => {
    const parts = combo.split('+'); const key = parts.pop();
    const e = new KeyboardEvent('keydown', { key: key.length === 1 ? key.toLowerCase() : key, ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };

  it('the new key works, the old one stops, reset brings it back', () => {
    let n = 0;
    Registry.init();
    Registry.register('reading-mode', () => { n++; });
    expect(press('Ctrl+Alt+R').defaultPrevented).toBe(true);
    expect(n).toBe(1);
    expect(Registry.setShortcut('reading-mode', 'Ctrl+Alt+F9')).toBe(true);
    press('Ctrl+Alt+R'); expect(n).toBe(1);
    press('Ctrl+Alt+F9'); expect(n).toBe(2);
    Registry.resetShortcut('reading-mode');
    press('Ctrl+Alt+F9'); expect(n).toBe(2);
    press('Ctrl+Alt+R'); expect(n).toBe(3);
  });

  it('a taken key is refused with the name of what has it', () => {
    expect(Registry.setShortcut('reading-mode', 'Ctrl+T')).toMatchObject({ conflict: 'new-tab', conflictLabel: 'New Tab' });
    expect(Registry.setShortcut('reading-mode', 'Ctrl+Alt+S')).toMatchObject({ conflict: 'screenshot' });
    expect(Registry.setShortcut('reading-mode', 'Ctrl+Shift+N')).toMatchObject({ conflict: 'fixed', conflictLabel: 'Notes' });
    expect(Registry.setShortcut('reading-mode', 'Ctrl+3')).toMatchObject({ conflict: 'fixed' });
    expect(Registry.setShortcut('reading-mode', 'F12')).toMatchObject({ conflict: 'fixed' });
    expect(Registry.getShortcut('reading-mode')).toBe('Ctrl+Alt+R');
  });

  it('a fixed key cannot be moved', () => {
    expect(Registry.setShortcut('new-tab', 'Ctrl+Alt+F9')).toEqual({ system: true });
    expect(Registry.getShortcut('new-tab')).toBe('Ctrl+T');
  });

  it('keys that would break typing, or that Windows keeps, are refused', () => {
    for (const k of ['Q', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Backspace', 'Ctrl+Left', 'Ctrl+Shift+Right', 'Ctrl+Home', 'Ctrl+Shift+V', 'Alt+Tab', 'Ctrl+Escape', 'Alt+F4', 'Ctrl+Shift+I']) {
      expect(Registry.setShortcut('reading-mode', k), k).toHaveProperty('invalid');
    }
  });

  it('a binding saved before a key was refused does not take the key from the field being edited', () => {
    let n = 0;
    Registry.init();
    Registry.register('reading-mode', () => { n++; });
    localStorage.setItem('vex.userShortcuts', JSON.stringify({ 'reading-mode': 'Ctrl+Left' }));
    Registry.init();
    const input = document.createElement('input'); document.body.appendChild(input);
    const e = press('Ctrl+Left', input);
    expect(e.defaultPrevented).toBe(false);
    expect(n).toBe(0);
  });

  it('Ctrl++ (Ctrl+Shift+=) and Ctrl+Shift+- zoom from inside a page too', () => {
    const k = (key) => ({ type: 'keyDown', key, control: true, alt: false, shift: true, meta: false });
    expect(Guest.shortcutFor(k('+'))).toEqual({ channel: 'zoom-in' });
    expect(Guest.shortcutFor(k('_'))).toEqual({ channel: 'zoom-out' });
  });

  it('main answers no key of Vex’s behind the lock screen, and Ctrl+K / dictate go to the page’s own window', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/if \(_vexLocked\) \{ handleFullscreenShortcut\(event, input\); return; \}/);
    expect(main).toMatch(/const win = _shortcutWindow\(contents\);\s+if \(!win\) return false;\s+win\.webContents\.send\('toggle-command-bar'\)/);
    expect(main).toMatch(/win\.webContents\.send\('dictate-toggle'\)/);
    expect(read('src/renderer/js/app.js')).toMatch(/VexLock\.locked\(\)\) return;\s+\/\/ like every other key/);
  });

  it('Ctrl+Tab is a page’s again once next-tab moves off it', () => {
    const tab = { type: 'keyDown', key: 'Tab', control: true, alt: false, shift: false, meta: false };
    const wantedNow = new Set(['Ctrl+Tab', 'Ctrl+Shift+Tab']);
    expect(Guest.shortcutFor(tab, { wanted: wantedNow })).toMatchObject({ channel: 'guest-shortcut' });
    const wantedMoved = new Set(['Ctrl+Alt+F9']);
    expect(Guest.shortcutFor(tab, { wanted: wantedMoved })).toBeNull();
    expect(Guest.shortcutFor({ ...tab, shift: true }, { wanted: wantedMoved })).toBeNull();
    // before the window has said which keys it answers they keep working
    expect(Guest.shortcutFor(tab)).toEqual({ channel: 'next-tab' });
  });
});
