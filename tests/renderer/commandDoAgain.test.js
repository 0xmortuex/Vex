// @vitest-environment jsdom
//
// Ctrl+K "Do That Again" (and Ctrl+Alt+A): the last command run from the bar,
// run once more.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');
const { ShortcutsRegistry } = (() => { require('../../src/renderer/js/shortcuts-registry.js'); return { ShortcutsRegistry: window.ShortcutsRegistry || globalThis.ShortcutsRegistry }; })();
window.escapeHtml = (s) => String(s);

const cmd = (id) => CommandBar.commands.find(c => c.id === id);

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  vi.spyOn(CommandBar, 'close').mockImplementation(() => {});
});

describe('do that again', () => {
  it('runs the command used most recently, and says what it is', () => {
    const links = cmd('check-links'), speed = cmd('check-speed');
    const a = vi.spyOn(links, 'action').mockImplementation(() => {});
    const b = vi.spyOn(speed, 'action').mockImplementation(() => {});
    CommandBar._execute(links);
    CommandBar._execute(speed);
    expect(cmd('do-again').hint).toBe('Again: ' + speed.label);
    CommandBar.doAgain();
    expect(b).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('never repeats itself', () => {
    const todo = cmd('todo');
    const run = vi.spyOn(todo, 'action').mockImplementation(() => {});
    CommandBar._execute(todo);
    CommandBar._execute(cmd('do-again'));           // chosen from the bar: records itself, then runs To-do
    CommandBar._execute(cmd('do-again'));
    expect(run).toHaveBeenCalledTimes(3);
    expect(CommandBar.lastCommand().id).toBe('todo');
  });

  it('with nothing run yet, says so instead of doing something', () => {
    expect(CommandBar.doAgain()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Nothing to do again/));
    expect(cmd('do-again').hint).toMatch(/last command/);
  });

  it('ignores entries that are not commands (a typed address, a search)', () => {
    localStorage.setItem('vex.commandUsage', JSON.stringify({ url: { n: 1, at: 99 }, gone: { n: 1, at: 98 } }));
    expect(CommandBar.lastCommand()).toBeNull();
  });

  it('has a rebindable shortcut, Ctrl+Alt+A, that nothing else uses', () => {
    const all = ShortcutsRegistry.getAllShortcuts();
    expect(all['do-again']).toMatchObject({ current: 'Ctrl+Alt+A', category: 'Tools' });
    expect(all['do-again'].system).toBeFalsy();
    const clash = Object.entries(all).filter(([id, s]) => id !== 'do-again' && s.current === 'Ctrl+Alt+A');
    expect(clash).toEqual([]);
  });
});
