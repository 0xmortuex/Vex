// @vitest-environment jsdom
//
// Ctrl+K shortcut words: made by the user, learned from what they pick, shown,
// changed and deleted; and put first by the command bar itself.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');
const { VexAliases } = require('../../src/renderer/js/command-aliases.js');

const fake = [
  { id: 'pr-desk', label: 'PR Desk', hint: 'Pull requests', action: () => {} },
  { id: 'price-history', label: 'Price History', hint: 'What it cost', action: () => {} },
  { id: 'todo', label: 'To-do List', hint: 'Tasks', action: () => {} },
  { id: 'hidden', label: 'Hidden', hint: '', when: () => false, action: () => {} },
];

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  globalThis.window.showToast = window.showToast;
  globalThis.VexAliases = VexAliases;
  window.VexAliases = VexAliases;
  document.body.innerHTML = '<div id="command-overlay"></div><input id="command-input"><div id="command-results"></div>';
});

describe('making and reading shortcut words', () => {
  it('a word points at a command and is found, case-insensitively', () => {
    VexAliases.set('PR', 'pr-desk', {}, fake);
    expect(VexAliases.lookup('pr')).toBe('pr-desk');
    expect(VexAliases.lookup(' Pr ')).toBe('pr-desk');
    expect(VexAliases.list(fake)).toEqual([expect.objectContaining({ word: 'pr', id: 'pr-desk', label: 'PR Desk', auto: false })]);
  });

  it('refuses words that are not words, commands that do not exist, and a word that is another command’s name', () => {
    expect(() => VexAliases.set('two words', 'pr-desk', {}, fake)).toThrow(/no spaces/);
    expect(() => VexAliases.set('', 'pr-desk', {}, fake)).toThrow();
    expect(() => VexAliases.set('x', 'nope', {}, fake)).toThrow(/no command/);
    expect(() => VexAliases.set('todo', 'pr-desk', {}, fake)).toThrow(/already the name/);
    expect(() => VexAliases.set('todo', 'todo', {}, fake)).not.toThrow();
  });

  it('a stored list that cannot be read is said, not taken as empty', () => {
    localStorage.setItem('vex.commandAliases', '{nope');
    expect(() => VexAliases.list(fake)).toThrow(/could not be read/);
  });

  it('finds a command by its id or its name', () => {
    expect(VexAliases.commandFor('PR Desk', fake).id).toBe('pr-desk');
    expect(VexAliases.commandFor('price-history', fake).id).toBe('price-history');
    expect(VexAliases.commandFor('nothing', fake)).toBeNull();
  });
});

describe('putting the command first', () => {
  const results = [{ id: 'search', label: 'Search "pr"' }, { id: 'price-history', label: 'Price History' }, { id: 'pr-desk', label: 'PR Desk', hint: 'Pull requests' }];

  it('moves the aliased command to the front once, with its own words as the hint', () => {
    VexAliases.set('pr', 'pr-desk', {}, fake);
    const out = VexAliases.apply('pr', results, fake, () => true);
    expect(out.map(r => r.id)).toEqual(['pr-desk', 'search', 'price-history']);
    expect(out[0].hint).toMatch(/shortcut "pr"/);
    expect(results[2].hint).toBe('Pull requests');   // the command keeps its own
  });

  it('leaves the results alone for another word, a hidden command, or when switched off', () => {
    VexAliases.set('pr', 'pr-desk', {}, fake);
    expect(VexAliases.apply('prx', results, fake, () => true)).toBe(results);
    expect(VexAliases.apply('pr', results, fake, () => false)).toBe(results);
    VexAliases.savePrefs({ enabled: false });
    expect(VexAliases.apply('pr', results, fake, () => true)).toBe(results);
  });

  it('the real command bar uses it', () => {
    const real = CommandBar.commands.find(c => c.id === 'todo');
    VexAliases.set('tt', 'todo', {}, CommandBar.commands);
    document.getElementById('command-input').value = 'tt';
    CommandBar.search('tt');
    expect(CommandBar.results[0].id).toBe('todo');
    expect(CommandBar.results[0].label).toBe(real.label);
  });
});

describe('learning from what is picked', () => {
  const learn = (typed, id, index = 2) => VexAliases.learn(typed, fake.find(c => c.id === id), fake, index);

  it('becomes a shortcut after three picks, and says so with an Undo', () => {
    expect(learn('pr', 'pr-desk')).toBeNull();
    expect(learn('pr', 'pr-desk')).toBeNull();
    const l = learn('pr', 'pr-desk');
    expect(l).toMatchObject({ word: 'pr', id: 'pr-desk' });
    expect(VexAliases.lookup('pr')).toBe('pr-desk');
    expect(VexAliases.list(fake)[0].auto).toBe(true);
    const [msg, , , opts] = window.showToast.mock.calls.at(-1);
    expect(msg).toMatch(/type "pr"/);
    opts.action.run();
    expect(VexAliases.lookup('pr')).toBeNull();
  });

  it('does not learn when the command was already the first row, or for rows that are not commands', () => {
    for (let i = 0; i < 5; i++) learn('pr', 'pr-desk', 0);
    expect(VexAliases.lookup('pr')).toBeNull();
    for (let i = 0; i < 5; i++) expect(VexAliases.learn('go', { id: 'search' }, fake, 3)).toBeNull();
    expect(VexAliases.lookup('go')).toBeNull();
  });

  it('does not learn a word that is another command’s name, or with learning switched off', () => {
    for (let i = 0; i < 4; i++) learn('todo', 'pr-desk');
    expect(VexAliases.lookup('todo')).toBeNull();
    VexAliases.savePrefs({ learn: false });
    for (let i = 0; i < 4; i++) learn('pr', 'pr-desk');
    expect(VexAliases.lookup('pr')).toBeNull();
  });

  it('a learned word you delete is not learned again; one you made is just gone', () => {
    for (let i = 0; i < 3; i++) learn('pr', 'pr-desk');
    VexAliases.remove('pr');
    for (let i = 0; i < 5; i++) learn('pr', 'pr-desk');
    expect(VexAliases.lookup('pr')).toBeNull();
    VexAliases.set('mine', 'todo', {}, fake);
    VexAliases.remove('mine');
    expect(VexAliases.all().blocked).not.toContain('mine');
  });

  it('forgetting what was learned keeps the words you made', () => {
    VexAliases.set('mine', 'todo', {}, fake);
    for (let i = 0; i < 3; i++) learn('pr', 'pr-desk');
    expect(VexAliases.forgetLearned()).toBe(1);
    expect(VexAliases.list(fake).map(a => a.word)).toEqual(['mine']);
  });

  it('a learned word moves when you now pick something else more; one you made never does', () => {
    for (let i = 0; i < 3; i++) learn('pr', 'pr-desk');
    for (let i = 0; i < 4; i++) learn('pr', 'price-history');
    expect(VexAliases.lookup('pr')).toBe('price-history');
    VexAliases.set('pr', 'pr-desk', {}, fake);
    for (let i = 0; i < 6; i++) learn('pr', 'price-history');
    expect(VexAliases.lookup('pr')).toBe('pr-desk');
  });

  it('the command bar tells it what was typed, only while it is open', () => {
    const target = CommandBar.commands.find(c => c.id === 'todo');
    vi.spyOn(target, 'action').mockImplementation(() => {});
    vi.spyOn(CommandBar, 'close').mockImplementation(() => {});
    const input = document.getElementById('command-input');
    input.value = 'tt';
    CommandBar.isOpen = true;
    CommandBar.selectedIndex = 3;
    for (let i = 0; i < 3; i++) CommandBar._execute(target);
    expect(VexAliases.lookup('tt')).toBe('todo');
    VexAliases.forgetLearned();
    CommandBar.isOpen = false;
    for (let i = 0; i < 3; i++) CommandBar._execute(target);   // Do That Again, with the box left as it was
    expect(VexAliases.lookup('tt')).toBeNull();
  });
});
