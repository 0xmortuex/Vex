// @vitest-environment jsdom
//
// The wheel anywhere over Settings scrolls it (the owner, 2026-10-11: "i can
// only scroll in the middle and not in the right or left"). The scroll area
// is the whole panel (css/settings-redesign.css), and the wheel over the
// pinned search box and chips is handed to it (SettingsUI._wheelToArea),
// unless a scroll box there can still use it.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');

const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8');

function scrollable(el, { scrollHeight, clientHeight, scrollTop = 0 }) {
  let top = scrollTop;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; } });
}

function wheel(target, init) {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('Settings scroll area', () => {
  it('the category list on the left keeps the wheel at its ends instead of passing it on to the settings', () => {
    const rule = css.match(/#panel-settings\[data-set-nav="side"\] \.set-nav \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/overflow-y:\s*auto/);
    expect(rule[1]).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('is the whole panel, not a box in the middle', () => {
    const rule = css.match(/\n\.settings-content \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/max-width:\s*none/);
    expect(rule[1]).toMatch(/margin:\s*0;/);
    expect(rule[1]).not.toMatch(/max-width:\s*780px/);
  });
});

describe('the wheel over the Settings toolbar', () => {
  let panel, root, toolbar, search, nav;
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="panel" id="panel-settings">
        <div class="settings-content">
          <h2>Settings</h2>
          <div class="setting-group"><label class="setting-label">General</label></div>
          <div class="setting-group"><label class="setting-label">Downloads</label></div>
        </div>
      </div>`;
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
    SettingsUI.enhance();
    toolbar = panel.querySelector('.set-toolbar');
    search = toolbar.querySelector('.set-search');
    nav = toolbar.querySelector('.set-nav');
    scrollable(root, { scrollHeight: 5000, clientHeight: 800 });
  });

  it('scrolls the settings from the search box and the chips', () => {
    const e = wheel(search, { deltaY: 120 });
    expect(root.scrollTop).toBe(120);
    expect(e.defaultPrevented).toBe(true);
    wheel(nav.querySelector('.set-nav-chip'), { deltaY: -50 });
    expect(root.scrollTop).toBe(70);
  });

  it('counts lines and pages as the browser does', () => {
    wheel(search, { deltaY: 3, deltaMode: 1 });
    expect(root.scrollTop).toBe(48);
    wheel(search, { deltaY: 1, deltaMode: 2 });
    expect(root.scrollTop).toBe(848);
  });

  it('leaves Ctrl+wheel (zoom) and a sideways wheel alone', () => {
    const z = wheel(search, { deltaY: 120, ctrlKey: true });
    expect(z.defaultPrevented).toBe(false);
    const x = wheel(search, { deltaY: 0, deltaX: 120 });
    expect(x.defaultPrevented).toBe(false);
    expect(root.scrollTop).toBe(0);
  });

  it('lets the one-row chip nav scroll itself while it still can', () => {
    nav.style.overflowY = 'auto';
    scrollable(nav, { scrollHeight: 120, clientHeight: 34, scrollTop: 0 });
    const down = wheel(nav.querySelector('.set-nav-chip'), { deltaY: 40 });
    expect(down.defaultPrevented).toBe(false);
    expect(root.scrollTop).toBe(0);
    // At its end it has nothing left to scroll, so the settings scroll.
    nav.scrollTop = 86;
    const more = wheel(nav.querySelector('.set-nav-chip'), { deltaY: 40 });
    expect(more.defaultPrevented).toBe(true);
    expect(root.scrollTop).toBe(40);
  });

  it('never takes the wheel from a scroll box that keeps it (overscroll-behavior: contain)', () => {
    nav.style.overflowY = 'auto';
    scrollable(nav, { scrollHeight: 120, clientHeight: 34, scrollTop: 86 });
    const real = globalThis.getComputedStyle;
    globalThis.getComputedStyle = window.getComputedStyle = (el) => {
      const cs = real(el);
      return el === nav ? { overflowY: cs.overflowY, overscrollBehaviorY: 'contain' } : cs;
    };
    try {
      const e = wheel(nav.querySelector('.set-nav-chip'), { deltaY: 40 });
      expect(e.defaultPrevented).toBe(false);
      expect(root.scrollTop).toBe(0);
    } finally { globalThis.getComputedStyle = window.getComputedStyle = real; }
  });

  it('does not touch a wheel the scroll area gets itself', () => {
    const e = wheel(root.querySelector('.setting-group'), { deltaY: 120 });
    expect(e.defaultPrevented).toBe(false);
    expect(root.scrollTop).toBe(0);
  });
});
