// @vitest-environment jsdom
//
// "Organize Tabs with AI" is on Ctrl+Shift+G through the shortcut registry.
// app.js also had a hard-coded Ctrl+Shift+G listener from the first release,
// so after rebinding it the old key still started the AI grouping (found
// 2026-10-10). The app.js block runs here beside the real registry.
import { beforeEach, describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');

let ran;

function groupingBlock() {
  const start = APP.indexOf('  // === Phase 16: Tab auto-grouping ===');
  const end = APP.indexOf('  // === Phase 14: AI Router');
  if (start < 0 || end < start) throw new Error('tab auto-grouping block not found in app.js');
  return APP.slice(start, end);
}

const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

beforeEach(() => {
  localStorage.clear();
  ran = [];
  ShortcutsRegistry.resetAll();
  ShortcutsRegistry.init();
  const TabGrouper = { init() {}, analyzeAndPropose: () => ran.push('group') };
  ShortcutsRegistry.register('group-tabs', () => TabGrouper.analyzeAndPropose());
  // eslint-disable-next-line no-new-func
  new Function('document', 'TabGrouper', groupingBlock())(document, TabGrouper);
});

describe('Organize Tabs with AI key', () => {
  it('runs on its default key, once', () => {
    expect(ShortcutsRegistry.getShortcut('group-tabs')).toBe('Ctrl+Shift+G');
    press('G');
    expect(ran).toEqual(['group']);
  });

  it('after rebinding, only the new key runs it', () => {
    expect(ShortcutsRegistry.setShortcut('group-tabs', 'Ctrl+Alt+Shift+O')).toBe(true);
    press('G');
    expect(ran).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }));
    expect(ran).toEqual(['group']);
  });
});
