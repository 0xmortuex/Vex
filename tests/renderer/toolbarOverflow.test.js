// @vitest-environment jsdom
// Classic toolbar in a narrow / scaled window (walkthrough H1, 2026-10-07):
// the address field shrank to 60px, the right-hand buttons slid under the
// window controls, and at 1000px / 150% Close was off the window. Buttons that
// do not fit now move into a chevron menu, least-used first, until the address
// field has its room; window controls never move.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');

// A toy layout: the address field gets what the bar's width leaves after the
// fixed left side and every visible button.
let BAR_W = 1000;
const LEFT = 300, BTN = 40;
function layout() {
  const bar = document.getElementById('top-bar');
  const shown = [...bar.querySelectorAll('button')].filter(b => !b.hidden && !b.classList.contains('tb-overflowed') && !b.closest('#url-bar') && !b.closest('#window-controls'));
  const compact = bar.classList.contains('tb-compact') ? 60 : 0;
  return Math.max(60, BAR_W - LEFT + compact - BTN * shown.length - 120);
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `
    <div id="top-bar">
      <div id="top-bar-left"><button id="btn-back"></button><button id="btn-onboarding" title="Setup wizard"><svg></svg></button><button id="btn-restart-app" title="Restart Vex"></button></div>
      <div id="url-bar-wrapper"><div id="url-bar"><input id="url-input"><button id="btn-copy-url"></button></div></div>
      <div id="top-bar-right">
        <button id="btn-tor" title="Tor"></button><button id="btn-notes-top" title="Notes"></button>
        <button id="btn-downloads-top" title="Downloads"></button><button id="btn-extensions" title="Extensions"></button>
        <button id="btn-toggle-ai" title="AI"></button><button id="btn-split" title="Split"></button>
        <button id="btn-dev-dash" hidden></button><button id="btn-command" title="Command Bar"></button>
        <button id="btn-profile" aria-label="Profiles"></button>
      </div>
      <div id="window-controls"><button id="btn-close"></button></div>
    </div>`;
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  // jsdom has no layout: every element is "visible" unless hidden / moved.
  Element.prototype.getClientRects = function () { return (this.hidden || this.classList.contains('tb-overflowed')) ? [] : [{}]; };
  Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'url-input') return { width: layout(), left: 0, right: layout(), top: 0, bottom: 30 };
    if (this.id === 'top-bar') return { width: BAR_W, left: 0, right: BAR_W, top: 0, bottom: 44 };
    return { width: 32, left: 0, right: 32, top: 0, bottom: 32 };
  };
  BAR_W = 1000;
});

const load = () => {
  const p = require.resolve('../../src/renderer/js/toolbar-overflow.js');
  delete require.cache[p];
  return require(p);
};
const moved = (api) => api.moved().map(e => e.id);

describe('toolbar overflow', () => {
  it('a wide window moves nothing and hides the chevron', () => {
    BAR_W = 1600;
    const api = load();
    api.relayout();
    expect(moved(api)).toEqual([]);
    expect(document.getElementById('btn-toolbar-overflow').hidden).toBe(true);
  });

  it('a narrow window goes compact, then moves the least-used buttons first until the address field fits', () => {
    BAR_W = 900;
    const api = load();
    api.relayout();
    expect(document.getElementById('top-bar').classList.contains('tb-compact')).toBe(true);
    expect(moved(api).slice(0, 3)).toEqual(['btn-restart-app', 'btn-onboarding', 'btn-tor']);
    expect(layout()).toBeGreaterThanOrEqual(api.MIN_URL_INPUT);
    expect(document.getElementById('btn-toolbar-overflow').hidden).toBe(false);
    // never the window controls, Back, a hidden button, or a button in the address bar
    for (const id of ['btn-close', 'btn-back', 'btn-dev-dash', 'btn-copy-url']) expect(moved(api)).not.toContain(id);
  });

  it('getting wider again brings the buttons back', () => {
    BAR_W = 800;
    const api = load();
    api.relayout();
    expect(moved(api).length).toBeGreaterThan(3);
    BAR_W = 1600;
    api.relayout();
    expect(moved(api)).toEqual([]);
    expect(document.querySelectorAll('.tb-overflowed')).toHaveLength(0);
  });

  it('the chevron menu lists the moved buttons and clicks the real one; Escape closes it', () => {
    BAR_W = 900;
    const api = load();
    api.relayout();
    const tor = document.getElementById('btn-tor');
    const clicked = vi.fn();
    tor.addEventListener('click', clicked);
    document.getElementById('btn-toolbar-overflow').click();
    const items = [...document.querySelectorAll('.tb-overflow-item')];
    expect(items.map(i => i.textContent)).toContain('Tor');
    items.find(i => i.textContent === 'Tor').click();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(document.getElementById('toolbar-overflow-menu')).toBeNull();
    document.getElementById('btn-toolbar-overflow').click();
    expect(document.getElementById('toolbar-overflow-menu')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('toolbar-overflow-menu')).toBeNull();
  });

  it('app.css hides a moved button and keeps the window controls out of it', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/renderer/css/app.css'), 'utf8');
    expect(css).toMatch(/#top-bar \.tb-overflowed:not\(\.tb-overflow-proxy\) \{ display: none !important; \}/);
    const js = fs.readFileSync(path.join(ROOT, 'src/renderer/js/toolbar-overflow.js'), 'utf8');
    expect(js).toMatch(/'window-controls'/);
  });
});
