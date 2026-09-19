// @vitest-environment jsdom
//
// "Can Vex do this?": asked in plain words, answered from Vex's real feature
// list — never from a model's memory — and ending with the thing itself one
// press away. No match says so rather than inventing a feature.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { VexGuide } = require('../../src/renderer/js/vex-guide.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.VexFeatures = VexFeatures;
  globalThis.CommandBar = { commands: [{ id: 'group-tabs', label: 'Group Tabs by AI', shortcut: 'Ctrl+Shift+G', action: vi.fn() }] };
});

describe('what the question is', () => {
  it('knows a question about Vex from anything else', () => {
    for (const q of ['how do i group my tabs', 'can vex block ads', 'is there a way to record the screen', 'where is the reading list']) expect(VexGuide.isAbout(q), q).toBe(true);
    for (const q of ['tides in the bay of fundy', 'remind me at 5']) expect(VexGuide.isAbout(q), q).toBe(false);
  });

  it('throws away the words that carry no meaning', () => {
    expect(VexGuide.ask('how do i group my tabs')).toEqual(['group', 'my', 'tabs'].filter(w => w !== 'my'));
  });
});

describe('the answer', () => {
  it('names the real feature, says what it is for, and how to get to it', () => {
    const a = VexGuide.answer('how do i group my tabs');
    expect(a.found).toBe(true);
    expect(a.entry.id).toBe('tab-groups');
    expect(a.headline).toContain('Tab groups');
    expect(a.steps.some(s => s.includes('Press Ctrl+K and choose “Group Tabs by AI”'))).toBe(true);
    expect(a.steps.some(s => s.includes('Ctrl+Shift+G'))).toBe(true);
  });

  it('says so plainly when Vex has nothing, rather than inventing one', () => {
    const a = VexGuide.answer('how do i order a pizza');
    expect(a.found).toBe(false);
    expect(a.headline).toMatch(/nothing for that yet/);
    expect(a.steps).toEqual([]);
  });

  it('doing it runs the real command', async () => {
    const a = VexGuide.answer('can vex group tabs');
    await VexGuide.run(a.entry);
    expect(CommandBar.commands[0].action).toHaveBeenCalled();
  });
});
