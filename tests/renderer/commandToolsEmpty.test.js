// @vitest-environment jsdom
//
// "Tools" on a fresh profile re-opened the command bar with "No results found"
// and nothing else (walkthrough M4, 2026-10-07). With no tools it now says what
// a tool is and offers to add one, or to open the Toolbox.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { CommandBar } = require('../../src/renderer/js/command.js');

beforeEach(() => {
  vi.spyOn(CommandBar, 'open').mockImplementation(() => {});
  vi.spyOn(CommandBar, 'close').mockImplementation(() => {});
  vi.spyOn(CommandBar, 'renderResults').mockImplementation(() => {});
  globalThis.VexTools = { tools: [], showEditModal: vi.fn(), openTool: vi.fn() };
  window.Toolbox = { open: vi.fn() };
  globalThis.Toolbox = window.Toolbox;
});

describe('Tools with none added', () => {
  it('offers to add one and to open the Toolbox, and both do something', () => {
    CommandBar.showTools();
    expect(CommandBar.results.map(r => r.id)).toEqual(['tool-add', 'tool-toolbox']);
    expect(CommandBar.results[0].hint).toMatch(/no tools yet/i);
    CommandBar.results[0].action();
    expect(VexTools.showEditModal).toHaveBeenCalled();
    CommandBar.results[1].action();
    expect(Toolbox.open).toHaveBeenCalled();
  });

  it('lists your tools when you have some', () => {
    VexTools.tools = [{ id: 'a', name: 'Mail', desc: 'my mail', icon: 'mail', url: 'https://mail.example' }];
    CommandBar.showTools();
    expect(CommandBar.results.map(r => r.label)).toEqual(['Mail']);
  });
});
