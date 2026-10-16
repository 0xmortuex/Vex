// @vitest-environment jsdom
//
// Reference sets (js/reference-sets.js): pages and snippets pinned to a project, opened together.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexReferenceSets: S } = require('../../src/renderer/js/reference-sets.js');

beforeEach(() => {
  localStorage.clear();
  delete globalThis.TabManager; delete globalThis.VexStorage; delete globalThis.SplitScreen; delete globalThis.ProjectSpaces; delete globalThis.WorkspaceManager;
});

describe('sets and items', () => {
  it('makes a set, pins pages and snippets, removes them', () => {
    const set = S.create('OSDev');
    S.addPage(set.id, { url: 'https://wiki.osdev.org/APIC', title: 'APIC' });
    S.addSnippet(set.id, { text: 'wrmsr 0x1b, eax\nmore' });
    const got = S.get(set.id);
    expect(got.items.map(i => i.kind)).toEqual(['page', 'snippet']);
    expect(got.items[1].title).toBe('wrmsr 0x1b, eax');
    S.removeItem(set.id, got.items[0].id);
    expect(S.get(set.id).items.length).toBe(1);
    S.remove(set.id);
    expect(S.sets()).toEqual([]);
  });
  it('refuses a page that is not http(s), has a password, or is there already', () => {
    const set = S.create('Docs');
    expect(() => S.addPage(set.id, { url: 'javascript:alert(1)', title: 'x' })).toThrow(/http and https/);
    expect(() => S.addPage(set.id, { url: 'file:///C:/x', title: 'x' })).toThrow(/http and https/);
    expect(() => S.addPage(set.id, { url: 'https://u:p@a.example/', title: 'x' })).toThrow(/user name or password/);
    S.addPage(set.id, { url: 'https://a.example/x', title: 'x' });
    expect(() => S.addPage(set.id, { url: 'https://a.example/x', title: 'x' })).toThrow(/already in/);
  });
  it('limits names, sets, items and snippet length', () => {
    expect(() => S.create('  ')).toThrow(/name/);
    S.create('A');
    expect(() => S.create('a')).toThrow(/already a set/);
    const set = S.sets()[0];
    expect(() => S.addSnippet(set.id, { text: 'x'.repeat(S.MAX_TEXT + 1) })).toThrow(/at most/);
    expect(() => S.addSnippet(set.id, { text: ' ' })).toThrow(/empty/);
    for (let i = 0; i < S.MAX_ITEMS; i++) S.addSnippet(set.id, { text: 's' + i });
    expect(() => S.addSnippet(set.id, { text: 'one more' })).toThrow(/at most 40/);
  });
  it('stops a change over a list that cannot be read, rather than overwrite it', () => {
    localStorage.setItem('vex.referenceSets', '"nope"');
    expect(() => S.create('x')).toThrow(/not readable/);
    expect(localStorage.getItem('vex.referenceSets')).toBe('"nope"');
  });
});

describe('scope', () => {
  it('is the project space in front, else the workspace', () => {
    globalThis.ProjectSpaces = { active: () => ({ id: 'sp1', name: 'Kernel' }) };
    expect(S.scope()).toEqual({ id: 'space:sp1', name: 'Kernel' });
    delete globalThis.ProjectSpaces;
    globalThis.WorkspaceManager = { workspaces: [{ id: 'w1', name: 'Home' }], activeId: 'w1' };
    expect(S.scope()).toEqual({ id: 'ws:w1', name: 'Home' });
    delete globalThis.WorkspaceManager;
    expect(S.scope()).toBeNull();
  });
  it('one set per project', () => {
    S.create('Kernel docs', { scope: 'space:sp1' });
    expect(S.forScope('space:sp1').name).toBe('Kernel docs');
    expect(() => S.create('Another', { scope: 'space:sp1' })).toThrow(/already has/);
  });
});

describe('opening', () => {
  function tabs() {
    const created = [];
    globalThis.VexStorage = { saveGroups: vi.fn() };
    globalThis.TabManager = {
      groups: [], activeTabId: 'now',
      createTab: vi.fn((url, activate, gid) => { const id = 'n' + created.length; created.push({ id, url, activate, gid }); return id; }),
      rebuildAllTabs: vi.fn(),
    };
    return created;
  }
  it('opens every page in a group called Reference: <name>', () => {
    const created = tabs();
    const set = S.create('OSDev');
    S.addPage(set.id, { url: 'https://wiki.osdev.org/APIC', title: 'a' });
    S.addPage(set.id, { url: 'https://wiki.osdev.org/UEFI', title: 'b' });
    S.addSnippet(set.id, { text: 'not a page' });
    const ids = S.openAll(set.id);
    expect(ids.length).toBe(2);
    expect(TabManager.groups.map(g => g.name)).toEqual(['Reference: OSDev']);
    expect(created.every(c => c.gid === TabManager.groups[0].id)).toBe(true);
    expect(created[0].activate).toBe(true);
  });
  it('in a split, shows the first page beside the tab that was in front', () => {
    tabs();
    globalThis.SplitScreen = { restore: vi.fn(() => true) };
    const set = S.create('Docs');
    S.addPage(set.id, { url: 'https://a.example/', title: 'a' });
    S.openAll(set.id, { split: true });
    expect(SplitScreen.restore).toHaveBeenCalledWith(['now', 'n0'], 0.5);
  });
  it('says so when a set has no pages or split is missing', () => {
    tabs();
    const set = S.create('Empty');
    expect(() => S.openAll(set.id)).toThrow(/no pages/);
    S.addPage(set.id, { url: 'https://a.example/', title: 'a' });
    expect(() => S.openAll(set.id, { split: true })).toThrow(/Split screen is not available/);
    expect(() => S.openAll('nope')).toThrow(/gone/);
  });
});
