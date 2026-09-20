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
    // 'tabs' and 'tab' are the same word to a person.
    expect(VexGuide.ask('how do i group my tabs')).toEqual(['group', 'tab']);
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

describe('the words people actually type', () => {
  const asked = (q) => { const a = VexGuide.answer(q); return a.found ? a.entry.id : null; };

  it('lands on the right feature for everyday wording', () => {
    expect(asked('how do i stop ads')).toBe('adblock');
    expect(asked('how do i make it dark')).toBe('themes');
    expect(asked('can vex hide my ip')).toBe('tor');
    expect(asked('how do i get rid of cookie banners')).toBe('consent-banners');
    expect(asked('how do i watch a video in a small window')).toBe('pip');
    expect(asked('how do i sync my tabs to another computer')).toBe('sync');
    expect(asked('how do i find a word on the page')).toBe('find-in-page');
    expect(asked('can vex remember my passwords')).toBe('passwords');
  });

  it('prefers the plain feature over a specialised one with the same word', () => {
    expect(asked('can vex take a screenshot')).toBe('screenshot');   // not "screenshot to code"
    expect(asked('how do i zoom a page')).toBe('zoom');              // not "find on this page"
  });

  it('a word with an ending still matches; a word that merely starts the same does not', () => {
    expect(asked('is there a reading list')).toBe('library');        // "list" is not "listen"
  });

  it('still refuses what Vex does not have', () => {
    expect(asked('how do i order a pizza')).toBeNull();
    expect(asked('how do i mine bitcoin')).toBeNull();
  });
});

describe('a walkthrough', () => {
  it('runs the feature\'s own steps when it has them, else points at the control', () => {
    const runs = [];
    globalThis.VexTour = { run: (steps) => runs.push(steps) };
    VexGuide.walk(VexFeatures.get('agent'));
    expect(runs[0].map(s => s.sel)).toEqual(['#btn-toggle-ai', '#ai-input', '#ai-send']);
    VexGuide.walk(VexFeatures.get('vertical-tabs'));
    expect(runs[1].map(s => s.sel)).toEqual(['#tabs-list']);
  });
});
