// @vitest-environment jsdom
//
// Ctrl+K ranking, 2026-11-07 (owner screenshot: "setup wizard" listed the feature "Setup offered again" above the command "Run Setup Wizard").
// A multi-word query that appears whole, at a word boundary, inside a command's name now scores 92: above a feature row (80) and the
// "every word is somewhere" tier (70), below a name that STARTS with the phrase (100). Pure scoring on synthetic commands; no clock, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { CommandBar } = require('../../src/renderer/js/command.js');

const cmd = (id, label, hint = '') => ({ id, label, hint, action() {} });

describe('_scoreCommand: the whole phrase inside the name', () => {
  it('"setup wizard" against "Run Setup Wizard" is 92, above the feature row score of 80', () => {
    const s = CommandBar._scoreCommand('setup wizard', cmd('setup', 'Run Setup Wizard', 'Set up your tools again'));
    expect(s).toBe(92);
    expect(s).toBeGreaterThan(80);
  });

  it('a feature-like entry that only has the words (name and keywords) stays below 92', () => {
    const s = CommandBar._scoreCommand('setup wizard', cmd('setup-again', 'Setup offered again', 'setup wizard again monthly welcome back'));
    expect(s).toBeLessThan(92);
    expect(s).toBe(70);
  });

  it('a name that starts with the phrase is still 100', () => {
    expect(CommandBar._scoreCommand('setup wizard', cmd('a', 'Setup Wizard Guide'))).toBe(100);
    expect(CommandBar._scoreCommand('run setup', cmd('setup', 'Run Setup Wizard'))).toBe(100);
  });

  it('a partly typed last word still counts (the phrase starts at a word boundary)', () => {
    expect(CommandBar._scoreCommand('setup wiz', cmd('setup', 'Run Setup Wizard'))).toBe(92);
  });

  it('the phrase in the middle of a word is not a boundary match', () => {
    expect(CommandBar._scoreCommand('up wizard', cmd('setup', 'Run Setup Wizard'))).toBeLessThan(92);
  });

  it('single-word queries are unchanged: prefix 100, word prefix 85', () => {
    const c = cmd('setup', 'Run Setup Wizard');
    expect(CommandBar._scoreCommand('run', c)).toBe(100);
    expect(CommandBar._scoreCommand('wizard', c)).toBe(85);
    expect(CommandBar._scoreCommand('setup', c)).toBe(85);
  });

  it('folds Turkish letters on both sides (capital dotted I, dotless i, cedilla)', () => {
    const c = cmd('ist', 'Çalıştır İstanbul Rehberi');
    expect(CommandBar._scoreCommand('İstanbul rehberi', c)).toBe(92);
    expect(CommandBar._scoreCommand('istanbul rehberi', c)).toBe(92);
    expect(CommandBar._scoreCommand('calistir istanbul', c)).toBe(100);
  });
});

describe('_rankCommands: order for multi-word queries', () => {
  const saved = CommandBar.commands;
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { CommandBar.commands = saved; });

  it('the command with the phrase in its name is above one that only has the words in its hint', () => {
    CommandBar.commands = [
      cmd('decoy', 'Setup offered again', 'setup wizard again monthly welcome back'),
      cmd('setup', 'Run Setup Wizard', 'Set up your tools again'),
      cmd('other', 'Wizard of Tabs', 'setup'),
    ];
    const got = CommandBar._rankCommands('setup wizard').map(c => c.id);
    expect(got[0]).toBe('setup');
    expect(got.indexOf('setup')).toBeLessThan(got.indexOf('decoy'));
  });

  it('the command beats a feature row score of 80 once the +0.5 command bonus of search() is added', () => {
    CommandBar.commands = [cmd('setup', 'Run Setup Wizard')];
    const e = CommandBar._rankCommands('setup wizard', true)[0];
    expect(e.score + 0.5).toBeGreaterThan(80);
  });

  // [query, expected first command] over one synthetic list.
  const LIST = () => [
    cmd('setup', 'Run Setup Wizard', 'Set up your tools again'),
    cmd('tabnew', 'New Tab', 'Open a new tab'),
    cmd('tabclose', 'Close Tab', 'Close the current tab'),
    cmd('tabdup', 'Duplicate Tab', 'Make a copy of this tab'),
    cmd('closeothers', 'Close Other Tabs', 'Close every tab but this one'),
    cmd('darkmode', 'Toggle Dark Mode', 'Switch the theme'),
    cmd('clear', 'Clear Browsing Data', 'History, cookies and cache'),
    cmd('dl', 'Open Downloads Folder', 'Show downloaded files'),
    cmd('bm', 'Add Bookmark', 'Save this page to bookmarks'),
    cmd('pwd', 'Show Saved Passwords', 'The password manager'),
    cmd('splitv', 'Split Screen View', 'Two pages side by side'),
    cmd('reading', 'Open Reading Mode', 'Plain text of the page'),
    cmd('pdf', 'Save Page As PDF', 'Export the page'),
    cmd('mute', 'Mute This Tab', 'Silence the sound'),
    cmd('print', 'Print This Page', 'Send to a printer'),
  ];
  const TABLE = [
    ['setup wizard', 'setup'], ['setup wiz', 'setup'], ['run setup', 'setup'],
    ['dark mode', 'darkmode'], ['browsing data', 'clear'], ['downloads folder', 'dl'],
    ['reading mode', 'reading'], ['saved passwords', 'pwd'], ['split screen', 'splitv'],
    ['screen view', 'splitv'], ['page as', 'pdf'], ['this tab', 'mute'],
    ['other tabs', 'closeothers'], ['new tab', 'tabnew'], ['close tab', 'tabclose'],
    ['duplicate tab', 'tabdup'], ['add bookmark', 'bm'], ['print this', 'print'],
    ['wizard', 'setup'], ['folder', 'dl'], ['data', 'clear'],
  ];
  for (const [q, id] of TABLE) {
    it(`"${q}" lists ${id} first`, () => {
      CommandBar.commands = LIST();
      const got = CommandBar._rankCommands(q).map(c => c.id);
      expect(got[0], `${q} -> ${got.slice(0, 4).join(' | ')}`).toBe(id);
    });
  }
});
