// @vitest-environment jsdom
//
// T2-041: Ctrl+K ranks by frecency (how often, with the history fading over weeks), says
// why the highlighted result is where it is, can forget the order, and the toolbar buttons
// carry the Ctrl+K name of their command in their tooltip.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');
window.escapeHtml = (s) => String(s);

const DAY = 86400000;
const NOW = 1_800_000_000_000;
const cmd = (id) => CommandBar.commands.find(c => c.id === id);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('frecency', () => {
  it('adds up to 12 for how often plus 3 for today', () => {
    expect(CommandBar._frecencyBonus({ n: 10, at: NOW }, NOW)).toBe(15);
    expect(CommandBar._frecencyBonus({ n: 1, at: NOW }, NOW)).toBe(6);
  });
  it('halves every 14 days and has no today bonus after the first day', () => {
    expect(CommandBar._frecencyBonus({ n: 10, at: NOW - 14 * DAY }, NOW)).toBeCloseTo(6, 5);
    expect(CommandBar._frecencyBonus({ n: 10, at: NOW - 28 * DAY }, NOW)).toBeCloseTo(3, 5);
  });
  it('a command used a lot long ago no longer beats one used lately', () => {
    const old = CommandBar._frecencyBonus({ n: 20, at: NOW - 90 * DAY }, NOW);
    const fresh = CommandBar._frecencyBonus({ n: 3, at: NOW - DAY / 2 }, NOW);
    expect(fresh).toBeGreaterThan(old);
  });
  it('ranks by it for a typed query', () => {
    const a = cmd('history'), b = cmd('history-overlay');
    const q = 'history';
    const base = CommandBar._rankCommands(q).map(c => c.id);
    expect(base.indexOf('history')).toBeGreaterThanOrEqual(0);
    localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ [b.id]: { n: 10, at: Date.now() } }));
    const ranked = CommandBar._rankCommands(q).map(c => c.id);
    expect(ranked.indexOf(b.id)).toBeLessThan(ranked.indexOf(a.id));
  });
});

describe('why this order', () => {
  it('names the match tier and the history that added to it', () => {
    localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ history: { n: 4, at: NOW - 2 * DAY } }));
    const line = CommandBar._whyOrder(cmd('history'), 'hist', NOW);
    expect(line).toMatch(/^Why this order: its name starts with what you typed; used 4 times, last 2 days ago \(adds /);
  });
  it('says so for the empty box, with or without a history', () => {
    expect(CommandBar._whyOrder(cmd('history'), '', NOW)).toBe('Why this order: a suggestion Vex starts with');
    localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ history: { n: 1, at: NOW } }));
    expect(CommandBar._whyOrder(cmd('history'), '', NOW)).toBe('Why this order: you used 1 time, last today');
  });
  it('is empty for something that is not a command', () => {
    expect(CommandBar._whyOrder({ id: 'tab-1', label: 'A tab' }, 'a', NOW)).toBe('');
  });
  it('is written under the list for the highlighted result', () => {
    document.body.innerHTML = '<div id="command-bar"><input id="command-input"><div id="command-results"></div></div>';
    document.getElementById('command-input').value = 'hist';
    CommandBar.results = [cmd('history')];
    CommandBar.selectedIndex = 0;
    CommandBar._showWhy();
    const el = document.getElementById('command-why');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toMatch(/^Why this order: /);
    CommandBar.results = [{ id: 'url', label: 'Go' }];
    CommandBar._showWhy();
    expect(el.hidden).toBe(true);
  });
});

describe('reset', () => {
  it('forgets the usage and nothing else', () => {
    localStorage.setItem(CommandBar.USAGE_KEY, JSON.stringify({ history: { n: 4, at: NOW } }));
    localStorage.setItem('vex.commandAliases', '{"keep":1}');
    CommandBar.resetUsage();
    expect(localStorage.getItem(CommandBar.USAGE_KEY)).toBeNull();
    expect(localStorage.getItem('vex.commandAliases')).toBe('{"keep":1}');
  });
  it('is a Ctrl+K command that asks first', async () => {
    window.vexConfirm = vi.fn(async () => false);
    localStorage.setItem(CommandBar.USAGE_KEY, '{"history":{"n":1,"at":1}}');
    await cmd('reset-command-order').action();
    expect(localStorage.getItem(CommandBar.USAGE_KEY)).not.toBeNull();
    window.vexConfirm = vi.fn(async () => true);
    await cmd('reset-command-order').action();
    expect(localStorage.getItem(CommandBar.USAGE_KEY)).toBeNull();
  });
});

describe('tooltips with the Ctrl+K name', () => {
  it('appends the command name once, keeping the old tooltip', () => {
    document.body.innerHTML = '<button id="btn-downloads-top" title="Downloads"></button><button id="btn-notes-top" title="Notes (Ctrl+Shift+N)"></button>';
    expect(CommandBar.nameTips()).toBe(2);
    expect(document.getElementById('btn-downloads-top').title).toBe('Downloads · Ctrl+K: Downloads');
    expect(document.getElementById('btn-notes-top').title).toBe('Notes (Ctrl+Shift+N) · Ctrl+K: Notes');
    expect(CommandBar.nameTips()).toBe(0);
    expect(document.getElementById('btn-downloads-top').title).toBe('Downloads · Ctrl+K: Downloads');
  });
  it('skips a button that is not there, and names that exist as commands', () => {
    document.body.innerHTML = '';
    expect(CommandBar.nameTips()).toBe(0);
    for (const id of Object.values(CommandBar.TIPS)) expect(cmd(id), id).toBeTruthy();
  });
});
