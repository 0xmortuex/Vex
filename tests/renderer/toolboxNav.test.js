// @vitest-environment jsdom
//
// Getting around the Toolbox.
//
// Opening a tool used to destroy the launcher, so closing the tool left you at
// the browser — and finding the next one meant reopening, re-typing the search
// and scrolling back down. And there was no way to mark the tools you actually
// use among three hundred.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { ToolboxWorkbench } = require('../../src/renderer/js/toolbox-workbench.js');
globalThis.ToolboxWorkbench = ToolboxWorkbench; global.window.ToolboxWorkbench = ToolboxWorkbench;
global.window.escapeHtml = (v) => String(v == null ? '' : v);
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox; global.window.Toolbox = Toolbox;
const VexTools = require('../../src/renderer/js/tools.js');
globalThis.VexTools = VexTools;

const SPEC = (id, name) => ({
  id, name, family: 'math', desc: name + ' does a thing',
  fields: [{ id: 'n', label: 'Number', type: 'number', value: 2 }],
  run: (v) => String(v.n * 2),
  examples: [{ in: { n: 2 }, out: '4' }],
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="tools-bar"></div>';
  ToolboxPacks.specs = [];
  ToolboxPacks.add([SPEC('alpha', 'Alpha'), SPEC('beta', 'Beta'), SPEC('gamma', 'Gamma')]);
  VexTools.tools = [];
  Toolbox._launcherState = null;
  window.showToast = vi.fn();
});

describe('favourites', () => {
  it('starts empty and survives being written', () => {
    expect(Toolbox.favourites()).toEqual([]);
    expect(Toolbox.toggleFavourite('beta')).toBe(true);
    expect(Toolbox.isFavourite('beta')).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.toolFavourites'))).toEqual(['beta']);
  });

  it('toggles off again', () => {
    Toolbox.toggleFavourite('beta');
    Toolbox.toggleFavourite('beta');
    expect(Toolbox.favourites()).toEqual([]);
  });

  it('puts starred tools in their own section at the top', () => {
    Toolbox.toggleFavourite('gamma');
    Toolbox.open();
    const headings = [...document.querySelectorAll('#tb-list div')].map(d => d.textContent.trim());
    expect(headings[0]).toBe('Favourites');
    expect(document.querySelector('#tb-list .tb-tool').textContent).toContain('Gamma');
  });

  it('draws a star on every tool card', () => {
    Toolbox.open();
    const cards = document.querySelectorAll('#tb-list .tb-tool');
    const stars = document.querySelectorAll('#tb-list .tb-fav');
    // Every card except "Add a link", which is not a tool and cannot be starred.
    expect(stars.length).toBeGreaterThanOrEqual(3);
    expect(cards.length - stars.length).toBeLessThanOrEqual(1);
  });

  // The star lives inside the card button, so its click must not also open it.
  it('starring does not open the tool', () => {
    Toolbox.open();
    document.querySelector('#tb-list .tb-fav').click();
    expect(document.getElementById('vex-workbench')).toBe(null);
    expect(Toolbox.favourites().length).toBe(1);
  });

  it('ignores a corrupt favourites list rather than throwing', () => {
    localStorage.setItem('vex.toolFavourites', '{"not":"an array"}');
    expect(Toolbox.favourites()).toEqual([]);
  });
});

describe('getting back to where you were', () => {
  const clickTool = (name) => {
    const card = [...document.querySelectorAll('#tb-list .tb-tool')]
      .find(b => b.textContent.includes(name));
    if (!card) throw new Error(`no card for ${name}`);
    card.click();
  };

  it('a tool opened from the launcher has a way back', () => {
    Toolbox.open();
    clickTool('Alpha');
    expect(document.getElementById('vex-toolbox')).toBe(null);
    expect(document.getElementById('wb-back')).toBeTruthy();
  });

  it('restores the search and the family filter', () => {
    Toolbox.open();
    const s = document.getElementById('tb-search');
    s.value = 'beta';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    clickTool('Beta');

    document.getElementById('wb-back').click();
    expect(document.getElementById('vex-toolbox')).toBeTruthy();
    expect(document.getElementById('tb-search').value).toBe('beta');
    expect(document.querySelectorAll('#tb-list .tb-tool').length).toBe(1);
  });

  // jsdom does no layout, so the position is checked where it is recorded and
  // where it is handed back, rather than through a scrollTop that is always 0.
  it('records the scroll position and hands it back', () => {
    Toolbox.open();
    const list = document.getElementById('tb-list');
    Object.defineProperty(list, 'scrollTop', { value: 240, writable: true, configurable: true });
    clickTool('Alpha');
    expect(Toolbox._launcherState).toMatchObject({ scroll: 240 });

    let applied = null;
    const realOpen = Toolbox.open.bind(Toolbox);
    Toolbox.open = (restore) => { applied = restore; return realOpen(restore); };
    try { document.getElementById('wb-back').click(); } finally { Toolbox.open = realOpen; }
    expect(applied).toMatchObject({ scroll: 240 });
  });

  // A tool reached from Ctrl+K or a job button was not opened from the
  // launcher, so offering "back" there would go somewhere the user never was.
  it('a tool opened directly has no back button', () => {
    Toolbox.openTool('alpha');
    expect(document.getElementById('wb-back')).toBe(null);
  });
});
