// @vitest-environment jsdom
//
// With the AI panel open, a click on the tab strip's "+" landed on the panel
// (#ai-current-tab): the panel was fixed from the top of the window, so in
// every look it covered the right end of the tab strip and the toolbar, the
// window's minimise/maximise/close included (release check, 2026-10-12). The
// panel and its focus-mode dimmer now start where the page area starts, below
// whatever chrome the look has, and follow it when that changes (a look switch,
// the bookmarks bar, full screen).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
globalThis.VexFeatures = VexFeatures; global.window.VexFeatures = VexFeatures;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

const MARKUP = `
  <div id="top-tab-bar"><button id="btn-new-tab-top">+</button></div>
  <div id="top-bar"><button id="btn-close"></button></div>
  <div id="main-layout"><div id="content-area"></div></div>
  <div id="ai-panel">
    <div class="ai-header"><button id="ai-expand"></button><button id="ai-close"></button></div>
    <span id="ai-current-tab"></span>
    <div class="ai-messages" id="ai-messages"></div>
    <textarea id="ai-input"></textarea>
  </div>`;

let mainTop;
let observed;
beforeEach(() => {
  document.body.innerHTML = MARKUP;
  document.documentElement.style.removeProperty('--ai-top');
  localStorage.clear();
  window.escapeHtml = (v) => String(v == null ? '' : v);
  mainTop = 93;
  document.getElementById('main-layout').getBoundingClientRect = () => ({ top: mainTop, left: 0, right: 1280, bottom: 900, width: 1280, height: 900 - mainTop });
  observed = [];
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = []; observed.push(this); } observe(el) { this.els.push(el); } disconnect() {} };
  global.window.TabManager = { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'A page' }], getActiveTab: () => ({ id: 'tab-1', title: 'A page' }) };
  globalThis.TabManager = global.window.TabManager;
  AIPanel._shellReady = false;
  AIPanel._chromeWatch = null;
  AIPanel._unbindDismiss();
});

const aiTop = () => document.documentElement.style.getPropertyValue('--ai-top');

describe('the AI panel starts below the tab strip and toolbar', () => {
  it('opening the panel places it where the page area starts', () => {
    AIPanel._initShell();
    mainTop = 101; // the look changed while it was shut
    AIPanel.open();
    expect(aiTop()).toBe('101px');
  });

  it('follows the chrome when its height changes while open (bookmarks bar, look switch, full screen)', () => {
    AIPanel._initShell();
    AIPanel.open();
    expect(aiTop()).toBe('93px');
    const ro = observed.find(o => o.els.includes(document.getElementById('main-layout')));
    expect(ro).toBeTruthy();
    // The bars themselves are watched too: the page area's height can come
    // out the same while its top moves.
    expect(ro.els).toEqual(expect.arrayContaining([document.getElementById('top-bar'), document.getElementById('top-tab-bar')]));
    mainTop = 0; // full screen: no chrome
    ro.cb([]);
    expect(aiTop()).toBe('0px');
    // Each element is observed once: observing it again would report it again
    // and loop.
    expect(new Set(ro.els).size).toBe(ro.els.length);
  });

  it('a look switch, which settles over several steps, places it again when it is done', () => {
    AIPanel._initShell();
    AIPanel.open();
    mainTop = 77;
    window.dispatchEvent(new CustomEvent('vex:gui-style', { detail: { style: 'classic' } }));
    expect(aiTop()).toBe('77px');
  });

  it('the CSS uses it for the docked panel, focus mode and the dimmer behind it', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/ai-panel.css'), 'utf8');
    const rule = (sel) => { const i = css.indexOf('\n' + sel + ' {'); expect(i, sel).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i)); };
    expect(rule('#ai-panel')).toMatch(/top:\s*var\(--ai-top,\s*0px\)/);
    expect(rule('#ai-panel.expanded')).toMatch(/top:\s*var\(--ai-top,\s*0px\)/);
    expect(rule('#ai-backdrop')).toMatch(/top:\s*var\(--ai-top,\s*0px\)/);
    expect(rule('#ai-panel.expanded')).not.toMatch(/top:\s*0[;\s]/);
  });
});

void vi;
