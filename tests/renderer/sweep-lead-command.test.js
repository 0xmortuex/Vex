// @vitest-environment jsdom
//
// The command bar after the 2026-09-29 sweep: typing a command's exact name
// ran something else ("Remind me" selected the "could not read that" row,
// "Read Later" ran the Library guide), "Duplicate Tab" switched to the
// original instead of copying it, and two pairs of commands shared an id.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox;
const { CommandBar } = require('../../src/renderer/js/command.js');
window.escapeHtml = (s) => String(s);

beforeEach(() => {
  ToolboxPacks.specs = [];
  document.body.innerHTML = '<div id="command-results"></div>';
  try { localStorage.clear(); } catch {}
  delete globalThis.VexQuickCommands;
});

describe('what was typed is what runs', () => {
  it('an exact command name comes first, above a guide card or an unreadable-sentence row', () => {
    const saved = CommandBar.commands;
    CommandBar.commands = [
      { id: 'readlater', label: 'Read Later', hint: 'Save this page', action() {} },
      { id: 'remind', label: 'Remind me', hint: 'Set a reminder', action() {} },
    ];
    globalThis.VexQuickCommands = {
      results: (q) => (/remind/i.test(q)
        ? [{ id: 'quick-error', isPrimary: false, label: 'Say when', action() {} }]
        : [{ id: 'quick-guide', isPrimary: true, label: 'Library', action() {} }]),
    };
    try {
      CommandBar.search('Read Later');
      expect(CommandBar.results[0].id).toBe('readlater');
      CommandBar.search('Remind me');
      expect(CommandBar.results[0].id).toBe('remind');
    } finally { CommandBar.commands = saved; }
  });

  it('a real quick action still comes first', () => {
    globalThis.VexQuickCommands = { results: () => [{ id: 'quick-timer', isPrimary: true, label: 'Timer 10 min', action() {} }] };
    CommandBar.search('timer 10 min');
    expect(CommandBar.results[0].id).toBe('quick-timer');
  });
});

describe('the command list itself', () => {
  it('every command id is used once', () => {
    const ids = CommandBar.commands.map(c => c.id);
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it('Duplicate Tab makes a copy instead of switching to the original', () => {
    const tab = { id: 't1', url: 'https://example.com/', groupId: null };
    globalThis.TabManager = { getActiveTab: () => tab, createTab: vi.fn() };
    try {
      CommandBar.commands.find(c => c.id === 'duplicatetab').action();
      const [url, activate, , opts] = TabManager.createTab.mock.calls[0];
      expect(url).toBe('https://example.com/');
      expect(activate).toBe(true);
      expect(opts.allowDuplicate).toBe(true);
    } finally { delete globalThis.TabManager; }
  });

  it('"Go to" keeps the address as typed', () => {
    CommandBar.search('youtube.com/watch?v=dQw4w9WgXcQ');
    const go = CommandBar.results.find(r => r.id === 'url');
    expect(go.hint).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
  });
});
