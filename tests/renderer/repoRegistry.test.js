// @vitest-environment jsdom
//
// Repo registry (js/repo-registry.js): the list, which tabs belong to a repository, the suggestion
// (never an automatic move), and the group it makes when accepted.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexRepos: R } = require('../../src/renderer/js/repo-registry.js');

beforeEach(() => {
  localStorage.clear();
  R._suggested.clear(); R._pending.clear();
  delete globalThis.TabManager; delete globalThis.VexAttention; delete globalThis.VexStorage;
});

describe('reading addresses', () => {
  it('github.com pages of a repository', () => {
    expect(R.parseUrl('https://github.com/0xmortuex/vex/actions/runs/1')).toMatchObject({ owner: '0xmortuex', repo: 'vex', section: 'actions' });
    expect(R.parseUrl('https://github.com/0xmortuex/vex/issues/3')).toMatchObject({ section: 'issues' });
    expect(R.parseUrl('https://github.com/0xmortuex/vex.git')).toMatchObject({ repo: 'vex' });
  });
  it('raw files and the github.io docs site belong to the repository', () => {
    expect(R.parseUrl('https://raw.githubusercontent.com/o/r/main/a.md')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(R.parseUrl('https://o.github.io/r/docs/x')).toMatchObject({ owner: 'o', repo: 'r', host: 'pages' });
    expect(R.parseUrl('https://o.github.io/')).toMatchObject({ repo: 'o.github.io' });
  });
  it('github.com pages that are not a repository', () => {
    for (const u of ['https://github.com/settings/profile', 'https://github.com/marketplace/x', 'https://github.com/o', 'https://example.com/o/r', 'not a url']) expect(R.parseUrl(u), u).toBeNull();
  });
  it('normalises owner/name and addresses, and refuses the rest', () => {
    expect(R.normalize('0xmortuex/vex')).toBe('0xmortuex/vex');
    expect(R.normalize('https://github.com/0xmortuex/vex/issues')).toBe('0xmortuex/vex');
    expect(() => R.normalize('vex')).toThrow(/owner\/name/);
    expect(() => R.normalize('settings/profile')).toThrow(/owner\/name/);
  });
});

describe('the list', () => {
  it('adds, finds without caring about case, sets the folder and removes', () => {
    expect(R.add('0xmortuex/vex', { path: 'C:\\code\\vex' })).toBe('0xmortuex/vex');
    expect(R.get('0XMORTUEX/Vex').path).toBe('C:\\code\\vex');
    expect(R.match('https://github.com/0xmortuex/Vex/pull/9').name).toBe('0xmortuex/vex');
    expect(R.match('https://github.com/other/thing')).toBeNull();
    R.setPath('0xmortuex/vex', '');
    expect(R.get('0xmortuex/vex').path).toBe('');
    R.remove('0xmortuex/vex');
    expect(R.list()).toEqual([]);
  });
  it('refuses a duplicate, a missing repo and a path that is not a full path', () => {
    R.add('a/b');
    expect(() => R.add('A/B')).toThrow(/already/);
    expect(() => R.remove('x/y')).toThrow(/not in your list/);
    expect(() => R.setPath('a/b', 'relative\\path')).toThrow(/full path/);
    expect(() => R.setPath('a/b', 'C:\\x\ny')).toThrow(/not valid/);
  });
  it('stops a change over a list that cannot be read, rather than overwrite it', () => {
    localStorage.setItem('vex.repos', '{"not":"a list"}');
    expect(() => R.add('a/b')).toThrow(/not readable/);
    expect(localStorage.getItem('vex.repos')).toBe('{"not":"a list"}');
  });
});

describe('the suggestion', () => {
  function setup(tabs, groups = []) {
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    globalThis.TabManager = { tabs, groups };
    return suggest;
  }
  it('is a suggestion in the inbox, once per tab and repository, and moves nothing', () => {
    R.add('a/b');
    const tab = { id: 't1', url: 'https://github.com/a/b/issues/1', groupId: null };
    const suggest = setup([tab]);
    expect(R.suggestFor(tab)).toBe(true);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'repo-registry', title: 'Group this tab under a/b?' });
    expect(tab.groupId).toBeNull();
    expect(R.suggestFor(tab)).toBe(false);
    expect(suggest).toHaveBeenCalledTimes(1);
  });
  it('stays quiet for a tab already in the repo group, an unlisted repo, and when switched off', () => {
    R.add('a/b');
    const inGroup = { id: 't2', url: 'https://github.com/a/b', groupId: 'g1' };
    const suggest = setup([inGroup], [{ id: 'g1', name: 'a/b' }]);
    expect(R.suggestFor(inGroup)).toBe(false);
    expect(R.suggestFor({ id: 't3', url: 'https://github.com/c/d', groupId: null })).toBe(false);
    R.setEnabled(false);
    expect(R.suggestFor({ id: 't4', url: 'https://github.com/a/b', groupId: null })).toBe(false);
    expect(suggest).not.toHaveBeenCalled();
  });
  it('accepting it puts the tab in a group named after the repository, made if missing', () => {
    R.add('a/b');
    const tab = { id: 't1', url: 'https://github.com/a/b', groupId: null };
    setup([tab]);
    const moved = [];
    globalThis.VexStorage = { saveGroups: vi.fn() };
    globalThis.TabManager.moveTabToGroup = (id, gid) => { moved.push([id, gid]); return true; };
    globalThis.TabManager.rebuildAllTabs = vi.fn();
    globalThis.TabManager.persistTabs = vi.fn();
    const token = (() => { R.suggestFor(tab); return [...R._pending.keys()][0]; })();
    R._onAction('group:' + token);
    expect(globalThis.TabManager.groups.map(g => g.name)).toEqual(['a/b']);
    expect(moved).toEqual([['t1', globalThis.TabManager.groups[0].id]]);
    expect(() => R._onAction('group:' + token)).toThrow(/out of date/);
    expect(() => R._onAction('nonsense')).toThrow(/Unknown repository action/);
  });
});
