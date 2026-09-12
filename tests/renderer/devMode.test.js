// @vitest-environment jsdom
//
// Developer mode: a mode, not a theme. It adds surfaces rather than changing
// how anything looks, so it works under every Vex look — and it is off unless
// asked for, because none of it is useful while browsing.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexDevMode } = require('../../src/renderer/js/dev-mode.js');
globalThis.VexDevMode = VexDevMode; global.window.VexDevMode = VexDevMode;

const MARKUP = `
  <div id="top-bar-right">
    <button id="btn-dev-dash" hidden></button>
    <button id="btn-command"></button>
  </div>
  <button class="sidebar-icon" data-panel="devtools-dash" data-dev-only hidden></button>
  <div id="panel-devtools-dash"></div>`;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  document.body.className = '';
  localStorage.clear();
  window.escapeHtml = (v) => String(v == null ? '' : v);
  window.showToast = vi.fn();
});

describe('the mode itself', () => {
  it('is off until asked for', () => {
    VexDevMode.apply();
    expect(VexDevMode.isOn()).toBe(false);
    expect(document.getElementById('btn-dev-dash').hidden).toBe(true);
    expect(document.querySelector('[data-dev-only]').hidden).toBe(true);
  });

  it('reveals every developer surface at once', () => {
    VexDevMode.set(true);
    expect(document.getElementById('btn-dev-dash').hidden).toBe(false);
    expect(document.querySelector('[data-dev-only]').hidden).toBe(false);
    expect(document.body.classList.contains('vex-dev-mode')).toBe(true);
  });

  it('hides them again', () => {
    VexDevMode.set(true);
    VexDevMode.set(false);
    expect(document.getElementById('btn-dev-dash').hidden).toBe(true);
    expect(document.body.classList.contains('vex-dev-mode')).toBe(false);
  });

  it('survives a reload', () => {
    VexDevMode.set(true);
    document.body.innerHTML = MARKUP;
    VexDevMode.apply();
    expect(document.getElementById('btn-dev-dash').hidden).toBe(false);
  });

  // It sits beside the Toolbox button, which JobProfiles re-creates on every
  // redraw — so the position has to be re-established, not fixed in markup.
  it('moves itself next to the Toolbox button whenever that is redrawn', () => {
    const bar = document.getElementById('top-bar-right');
    const toolbox = document.createElement('button');
    toolbox.className = 'vex-job-btn';
    toolbox.title = 'Toolbox — your job tools';
    bar.insertBefore(toolbox, document.getElementById('btn-command'));

    VexDevMode.set(true);
    expect(toolbox.nextElementSibling.id).toBe('btn-dev-dash');
  });
});

describe('the dashboard', () => {
  it('reports what is actually running', () => {
    VexDevMode.set(true);
    const { root } = VexDevMode.openDashboard();
    expect(root.querySelectorAll('.dd-stat').length).toBeGreaterThan(4);
    expect(root.querySelectorAll('.dd-action').length).toBeGreaterThan(4);
  });

  it('marks the destructive action as destructive before it is clicked', () => {
    VexDevMode.set(true);
    const { root } = VexDevMode.openDashboard();
    expect(root.querySelectorAll('.dd-action.dd-danger').length).toBe(1);
  });

  it('offers the same actions in the sidebar, from one list', () => {
    VexDevMode.set(true);
    const panel = document.getElementById('panel-devtools-dash');
    VexDevMode.renderPanel(panel);
    expect(panel.querySelectorAll('.dd-action').length).toBe(VexDevMode.actions().length);
  });

  it('counts storage without throwing when there is none', () => {
    expect(() => VexDevMode.stats()).not.toThrow();
    expect(VexDevMode.stats().keys).toBe(0);
  });
});

// A misclick must not be able to wipe the browser.
describe('Reset Vex is guarded', () => {
  const reset = () => VexDevMode.actions().find(a => a.id === 'reset');

  it('asks for the word to be typed', async () => {
    localStorage.setItem('vex.something', 'keep me');
    let asked = '';
    window.vexPrompt = async (msg) => { asked = msg; return ''; };
    await VexDevMode._runAction(reset());
    expect(asked).toContain('Type RESET');
    expect(localStorage.getItem('vex.something')).toBe('keep me');
  });

  it('does nothing when the word is wrong', async () => {
    localStorage.setItem('vex.something', 'keep me');
    window.vexPrompt = async () => 'yes';
    await VexDevMode._runAction(reset());
    expect(localStorage.getItem('vex.something')).toBe('keep me');
    expect(window.showToast).toHaveBeenCalledWith('Cancelled');
  });

  it('says what it removed when confirmed', async () => {
    localStorage.setItem('vex.a', '1');
    localStorage.setItem('vex.b', '2');
    localStorage.setItem('unrelated', '3');
    window.vexPrompt = async () => 'reset';
    await VexDevMode._runAction(reset());
    expect(localStorage.getItem('vex.a')).toBe(null);
    // Anything that is not Vex's own is left alone.
    expect(localStorage.getItem('unrelated')).toBe('3');
  });

  it('reports a failure instead of pretending it worked', async () => {
    window.vexConfirm = async () => true;
    const boom = { id: 'boom', label: 'x', what: 'y', run: () => { throw new Error('nope'); } };
    await VexDevMode._runAction(boom);
    expect(window.showToast).toHaveBeenCalledWith('nope', 'error');
  });
});
