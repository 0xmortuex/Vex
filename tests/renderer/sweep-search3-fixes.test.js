// @vitest-environment jsdom
//
// Search / Ctrl+K / Toolbox / shortcuts sweep (found 2026-09-29): the Toolbox
// "Also known as" split on the letter s, the cron tool refused 7 and @daily and
// gave up after a year, five tools were listed twice, recording a key in the
// shortcut editor also ran it, Print/View Source/Bookmark could be "moved" but
// kept their keys inside pages, keys Vex already answers were accepted without
// a word, the Shortcuts guide ignored Escape, and "open settings" was not a
// short name to Ctrl+K.
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox, ToolboxLib } = require('../../src/renderer/js/toolbox.js');
const PACK_FILES = ['toolbox-pack-text.js', 'toolbox-pack-units-math-science.js', 'toolbox-pack-money-date-health.js',
  'toolbox-pack-dev-data-web.js', 'toolbox-pack-encoding-net-css.js', 'toolbox-pack-formats-text.js'];
beforeAll(() => {
  ToolboxPacks.specs = [];
  for (const f of PACK_FILES) require('../../src/renderer/js/' + f);
});

describe('Toolbox', () => {
  it('"Also known as" splits a keyword string on spaces and commas, not on the letter s', () => {
    const wb = Toolbox._specToWorkbench({ id: 'x', name: 'X', keywords: 'ssl sha, hashes', fields: [{ id: 'text', label: 'Text' }], run: () => '' });
    expect(wb.details.find(d => d.title === 'Also known as').text).toBe('ssl, sha, hashes');
  });

  it('lists each tool once: the five duplicates are gone and their twins stay', () => {
    const ids = ToolboxPacks.specs.map(s => s.id);
    for (const gone of ['sci-energy-cost', 'dev-unicode', 'enc-crc32', 'css-shadow', 'web-http-status']) expect(ids, gone).not.toContain(gone);
    for (const kept of ['fin-electricity', 'unicode-info', 'sec-crc32', 'design-box-shadow', 'dev-http-status']) expect(ids, kept).toContain(kept);
  });
});

describe('cron', () => {
  const from = new Date('2026-09-29T10:00:00');

  it('reads @daily and the other shorthands', () => {
    expect(ToolboxLib.cronDescribe('@daily')).toBe('at 00:00');
    expect(ToolboxLib.cronNext('@hourly', 1, from)[0].getMinutes()).toBe(0);
    expect(ToolboxLib.cronNext('@weekly', 1, from)[0].getDay()).toBe(0);
  });

  it('describes a stepped hour as words, not "at */2:00"', () => {
    expect(ToolboxLib.cronDescribe('0 */2 * * *')).toBe('at minute 0, every 2 hours');
    expect(ToolboxLib.cronDescribe('30 9 * * *')).toBe('at 09:30');
  });

  it('takes 7 as Sunday, ORs the two day fields, and finds a leap day years ahead', () => {
    expect(ToolboxLib.cronNext('0 0 * * 7', 1, from)[0].getDay()).toBe(0);
    const either = ToolboxLib.cronNext('0 0 1 * 1', 3, from).map(d => d.getDate() === 1 || d.getDay() === 1);
    expect(either).toEqual([true, true, true]);
    expect(ToolboxLib.cronNext('0 0 1 * 1', 1, from)[0].getDate()).toBe(1);   // Thu 1 Oct before Mon 5 Oct
    const leap = ToolboxLib.cronNext('0 0 29 2 *', 1, from)[0];
    expect([leap.getFullYear(), leap.getMonth(), leap.getDate()]).toEqual([2028, 1, 29]);
  });

  it('the Cron tool itself accepts 7 and @daily, and looks 8 years ahead', () => {
    let spec;
    window.ToolboxWorkbench = { open: (s) => { spec = s; } };
    Toolbox._cron();
    const out = (input, count = '5') => spec.run({ input, opt: { count } }).output;
    expect(out('0 0 * * 7', '0')).toMatch(/day of week\s+7\s+0/);
    expect(out('0 0 * * *', '0')).toMatch(/day of week\s+\*\s+every day of week/);
    expect(out('@daily', '0')).toMatch(/hour\s+0\s+0/);
    expect(out('0 0 29 2 *', '1')).toMatch(/next runs\n\s+\S/);
    expect(() => out('@reboot')).toThrow(/@reboot/);
  });
});

describe('shortcuts', () => {
  const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
  const ShortcutEditor = require('../../src/renderer/js/shortcut-editor.js');
  let ran, toasts;
  beforeAll(() => { ShortcutsRegistry.init(); });
  beforeEach(() => {
    localStorage.clear();
    ShortcutsRegistry.resetAll();
    ran = []; toasts = [];
    window.showToast = (m, k) => toasts.push(k + ':' + m);
    globalThis.ShortcutsRegistry = ShortcutsRegistry;
    globalThis.CommandBar = { commands: [
      { id: 'library', label: 'Library', action: () => ran.push('library') },
      { id: 'tasks', label: 'Running tasks', action: () => ran.push('tasks') },
    ] };
    document.body.innerHTML = '<div id="host"></div>';
  });
  const press = (key, mods = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

  it('recording a key that is taken warns and does NOT run what has it', () => {
    const host = document.getElementById('host');
    ShortcutEditor.renderPanel(host);
    host.querySelector('button.shortcut-key[data-id="tasks"]').click();
    press('b', { ctrlKey: true, altKey: true });              // Library's key
    expect(ran).toEqual([]);
    expect(toasts.join()).toMatch(/already used by "Library/);
    press('b', { ctrlKey: true, altKey: true });              // capture over: the key works again
    expect(ran).toEqual(['library']);
  });

  it('Print, View Source and Bookmark are fixed, and an old saved rebind is ignored', () => {
    for (const id of ['print-page', 'view-source', 'bookmark']) {
      expect(ShortcutsRegistry.setShortcut(id, 'F7'), id).toEqual({ system: true });
      expect(ShortcutsRegistry.getAllShortcuts()[id].system, id).toBe(true);
    }
    localStorage.setItem('vex.userShortcuts', JSON.stringify({ 'print-page': 'F7' }));
    ShortcutsRegistry.init();
    expect(ShortcutsRegistry.getShortcut('print-page')).toBe('Ctrl+P');
    expect(ShortcutsRegistry.getAllShortcuts()['print-page'].current).toBe('Ctrl+P');
  });

  it('refuses keys Vex answers elsewhere, naming what uses them', () => {
    const cases = { 'Ctrl+Shift+N': 'Notes', 'Ctrl+=': 'Zoom in', 'Ctrl+-': 'Zoom out', 'Ctrl+0': 'Reset Zoom',
      'Alt+Left': 'Back', 'Alt+Right': 'Forward', 'Ctrl+1': 'Go to tab 1', 'Ctrl+9': 'Go to the last tab',
      'Ctrl+Tab': 'Next Tab', 'Alt+Space': 'the Windows window menu', 'Ctrl+Alt+H': 'Hide Vex (boss key)' };
    for (const [combo, label] of Object.entries(cases)) {
      expect(ShortcutsRegistry.setShortcut('tasks', combo), combo).toEqual({ conflict: 'fixed', conflictLabel: label });
    }
    expect(ShortcutsRegistry.setShortcut('tasks', 'Ctrl+Alt+9')).toBe(true);
  });
});

describe('the Shortcuts & Gestures guide', () => {
  beforeAll(() => { require('../../src/renderer/js/shortcuts-guide.js'); });

  it('closes on Escape, wherever the focus is', () => {
    window.ShortcutsGuide.open();
    expect(document.getElementById('vex-shortcutsguide')).toBeTruthy();
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('vex-shortcutsguide')).toBe(null);
  });

  it('lists Print and View Source', () => {
    const keys = window.ShortcutsGuide.KEYS.map(r => r[1]);
    expect(keys).toContain('Ctrl+P');
    expect(keys).toContain('Ctrl+U');
  });
});

describe('"open settings" in Ctrl+K', () => {
  const { VexQuickCommands } = (() => { require('../../src/renderer/js/quick-commands.js'); return { VexQuickCommands: window.VexQuickCommands || globalThis.VexQuickCommands }; })();

  it('drops the opening word from a short name', () => {
    expect(VexQuickCommands.withoutOpener('open settings')).toBe('settings');
    expect(VexQuickCommands.withoutOpener('show history')).toBe('history');
    expect(VexQuickCommands.withoutOpener('go to the downloads')).toBe('downloads');
    expect(VexQuickCommands.plainly('open settings')).toBe('settings');
  });

  it('leaves real sentences alone', () => {
    for (const s of ['open the file I downloaded yesterday', 'show me how to pin a tab', 'open', 'settings']) {
      expect(VexQuickCommands.withoutOpener(s), s).toBe(s);
    }
    expect(VexQuickCommands.plainly('open a timer for 10 minutes')).toBe('timer 10 minutes');
  });
});

describe('the setup wizard', () => {
  require('../../src/renderer/js/vex-utils.js');
  require('../../src/renderer/js/i18n.js');
  const { Onboarding } = require('../../src/renderer/js/onboarding.js');

  it('tells the host when the search engine changes', () => {
    globalThis.WebviewManager = { webviews: new Map() };
    const seen = vi.fn();
    window.addEventListener('vex-search-engine-changed', (e) => seen(e.detail));
    Onboarding._setStart('vex.searchEngine', 'bing');
    expect(seen).toHaveBeenCalledWith({ id: 'bing' });
    expect(localStorage.getItem('vex.searchEngine')).toBe('bing');
  });

  it('the time left goes through the translations', () => {
    const t = vi.spyOn(window.VexI18n, 't').mockImplementation((k, f) => (k === 'minutesLeft' ? 'yaklaşık {n} dakika kaldı' : k === 'nearlyDone' ? 'neredeyse bitti' : f));
    Onboarding.step = 0;
    expect(Onboarding._timeLeft([{}, { secs: 120 }, { secs: 120 }])).toBe('yaklaşık 4 dakika kaldı');
    expect(Onboarding._timeLeft([{}, { secs: 20 }])).toBe('neredeyse bitti');
    t.mockRestore();
  });
});
