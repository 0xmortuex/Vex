// @vitest-environment jsdom
//
// Vex has more than sixty keyboard shortcuts and gained eleven in one
// release. They were all in Settings — a page you have to decide to go and
// read, and nobody decides to read a list of keys, so the keys went unused.
// One press puts them over whatever you are doing, relevant ones first.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { KeysSheet } = require('../../src/renderer/js/keys-sheet.js');
globalThis.KeysSheet = KeysSheet;

const SHORTCUTS = {
  'command-bar': { current: 'Ctrl+K', label: 'Command Bar', category: 'Navigation', hasHandler: true },
  'new-tab': { current: 'Ctrl+T', label: 'New Tab', category: 'Tabs', hasHandler: true },
  'ai-panel': { current: 'Ctrl+Shift+A', label: 'Toggle AI Panel', category: 'AI', hasHandler: true },
  'notes-panel': { current: 'Ctrl+Alt+N', label: 'Notes Panel', category: 'Panels', hasHandler: true },
  'dead-one': { current: 'Ctrl+Alt+Q', label: 'Nothing behind it', category: 'Tabs', hasHandler: false },
  'unbound': { current: '', label: 'No key', category: 'Tabs', hasHandler: true },
  'cmd:mine': { current: 'Ctrl+Alt+7', label: 'Something of my own', category: 'Your own', hasHandler: true, isCustom: true },
};

beforeEach(() => {
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.ShortcutsRegistry = { getAllShortcuts: () => SHORTCUTS };
  globalThis.SidebarManager = { activePanel: null, openPanel: vi.fn() };
  globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.test/' }) };
  delete globalThis.SettingsUI;
});

describe('what it lists', () => {
  it('leaves out a key with nothing behind it and one with no key', () => {
    const labels = KeysSheet.rows().flatMap(g => g.keys.map(k => k.label));
    expect(labels).toContain('Command Bar');
    expect(labels).not.toContain('Nothing behind it');
    expect(labels).not.toContain('No key');
  });

  it('puts the categories that matter where you are first, and marks them', () => {
    // On a web page: Navigation and Tabs are what you would reach for.
    const groups = KeysSheet.rows();
    expect(groups.slice(0, 2).map(g => g.name).sort()).toEqual(['Navigation', 'Tabs']);
    expect(groups.find(g => g.name === 'Navigation').here).toBe(true);
    expect(groups.find(g => g.name === 'AI').here).toBe(false);
  });

  it('follows you: with the AI panel open, its keys come first', () => {
    document.body.innerHTML = '<div id="ai-panel" class="open"></div>';
    const groups = KeysSheet.rows();
    expect(groups[0].name).toBe('AI');
    expect(groups.find(g => g.name === 'AI').here).toBe(true);
  });

  it('says nothing rather than guessing when the registry is unavailable', () => {
    delete globalThis.ShortcutsRegistry;
    expect(KeysSheet.rows()).toEqual([]);
  });
});

describe('the sheet itself', () => {
  it('opens, groups, and draws each combination as keycaps', () => {
    KeysSheet.open();
    const el = document.getElementById('vex-keys');
    expect(el).not.toBeNull();
    expect(el.querySelectorAll('.vexkeys-group').length).toBeGreaterThan(1);
    const caps = [...el.querySelectorAll('.vexkeys-row')]
      .find(r => r.textContent.includes('Toggle AI Panel'))
      .querySelectorAll('kbd');
    expect([...caps].map(k => k.textContent)).toEqual(['Ctrl', 'Shift', 'A']);
    expect(el.textContent).toMatch(/On a web page/);
  });

  it('marks a key you set yourself', () => {
    KeysSheet.open();
    const row = [...document.querySelectorAll('.vexkeys-row')].find(r => r.textContent.includes('Something of my own'));
    expect(row.querySelector('i').textContent).toBe('yours');
  });

  // A reference you can break is one you open carefully.
  it('changes nothing itself, and points at the screen that does', () => {
    KeysSheet.open();
    expect(document.querySelector('#vex-keys input, #vex-keys select')).toBe(null);
    document.querySelector('.vexkeys-edit').click();
    expect(document.getElementById('vex-keys')).toBe(null);
    expect(SidebarManager.openPanel).toHaveBeenCalledWith('settings');
  });

  it('the same key closes it again, and so does Escape', () => {
    KeysSheet.toggle();
    expect(document.getElementById('vex-keys')).not.toBeNull();
    KeysSheet.toggle();
    expect(document.getElementById('vex-keys')).toBe(null);
    KeysSheet.open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('vex-keys')).toBe(null);
  });
});
