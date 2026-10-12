// @vitest-environment jsdom
//
// Settings uses a wide window (the owner, 2026-10-11: "we have a large screen
// so i think we should maximize it but in a way that doesnt make it so long
// to take to scroll"). SettingsUI.columnsFor picks one, two or three columns
// from the scroll area's width; _layout turns them on and gives every block
// its height in grid rows, keeping the sections in their order.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/settings-redesign.css'), 'utf8');

describe('SettingsUI.columnsFor', () => {
  it('keeps one column in a small window (1280 x 720: a 1228px scroll area)', () => {
    expect(SettingsUI.columnsFor(1228)).toBe(1);
    expect(SettingsUI.columnsFor(900)).toBe(1);
    expect(SettingsUI.columnsFor(0)).toBe(1);
    expect(SettingsUI.columnsFor(undefined)).toBe(1);
  });

  it('uses two columns in a 1920px window and three in a 2560px one', () => {
    expect(SettingsUI.columnsFor(1868)).toBe(2);   // 1920 window, Firefox look
    expect(SettingsUI.columnsFor(2508)).toBe(3);   // 2560 window
    expect(SettingsUI.columnsFor(5000)).toBe(3);   // never more than three
  });

  it('switches exactly where the columns reach their least width', () => {
    const two = 2 * SettingsUI.COL_MIN + SettingsUI.COL_GAP + 2 * SettingsUI.COL_SIDE;
    expect(SettingsUI.columnsFor(two - 1)).toBe(1);
    expect(SettingsUI.columnsFor(two)).toBe(2);
    const three = 3 * SettingsUI.COL_MIN + 2 * SettingsUI.COL_GAP + 2 * SettingsUI.COL_SIDE;
    expect(SettingsUI.columnsFor(three - 1)).toBe(2);
    expect(SettingsUI.columnsFor(three)).toBe(3);
  });

  it('falls back to fewer columns for Larger and Largest text (the zoomed panel has fewer CSS pixels)', () => {
    // A 1920 window's 1868px area at zoom 1.3 and 1.5.
    expect(SettingsUI.columnsFor(1868 / 1.3)).toBe(2);
    expect(SettingsUI.columnsFor(1868 / 1.5)).toBe(1);
    // A 2560 window at Largest: two, not three.
    expect(SettingsUI.columnsFor(2508 / 1.5)).toBe(2);
  });
});

describe('SettingsUI._layout', () => {
  let panel, root;
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="panel" id="panel-settings">
        <div class="settings-content">
          <h2>Settings</h2>
          <div class="setting-group" id="g1"><label class="setting-label">General</label></div>
          <div class="setting-group" id="g2"><label class="setting-label">Downloads</label></div>
          <div class="setting-group" id="g3" style="display:none"><label class="setting-label">Hidden</label></div>
        </div>
      </div>`;
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
    // jsdom has no layout: give every block a height and a box.
    const heights = { H2: 50, g1: 402, g2: 97, g3: 300 };
    for (const el of root.children) {
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => heights[el.id || el.tagName] });
      el.getClientRects = () => (el.style.display === 'none' ? [] : [{}]);
    }
  });
  const width = (w) => Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => w });

  it('turns columns on for a wide area and spans each block by its height', () => {
    width(1868);
    root.querySelector('#g1').style.marginBottom = '16px';
    SettingsUI._layout(root);
    expect(panel.dataset.setCols).toBe('2');
    expect(panel.style.getPropertyValue('--set-cols')).toBe('2');
    expect(panel.style.getPropertyValue('--set-grid-max')).toBe((2 * SettingsUI.COL_MAX + SettingsUI.COL_GAP) + 'px');
    expect(root.querySelector('h2').style.gridRowEnd).toBe('span 13');      // ceil(50 / 4)
    expect(root.querySelector('#g1').style.gridRowEnd).toBe('span 105');    // ceil((402 + 16) / 4)
    expect(root.querySelector('#g2').style.gridRowEnd).toBe('span 25');     // ceil(97 / 4)
    expect(root.querySelector('#g3').style.gridRowEnd).toBe('');            // hidden: left alone
  });

  it('goes back to one plain column when the area narrows', () => {
    width(1868);
    SettingsUI._layout(root);
    width(1100);
    SettingsUI._layout(root);
    expect(panel.dataset.setCols).toBeUndefined();
    expect(panel.style.getPropertyValue('--set-cols')).toBe('');
    for (const el of root.children) expect(el.style.gridRowEnd).toBe('');
  });

  it('keeps the sections in their order in the document (Tab and screen readers read it)', () => {
    width(2508);
    const before = [...root.children].map(e => e.id || e.tagName);
    SettingsUI._layout(root);
    expect(panel.dataset.setCols).toBe('3');
    expect([...root.children].map(e => e.id || e.tagName)).toEqual(before);
  });

  it('lays out the search results too', () => {
    width(1868);
    SettingsUI._filter(root, 'zzznotathing');
    const empty = root.querySelector('.set-empty');
    expect(empty).toBeTruthy();
    expect(panel.dataset.setCols).toBe('2');
  });
});

describe('the column CSS', () => {
  it('is only on while _layout says so, and spans everything but a section across the columns', () => {
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content \{[^}]*display:\s*grid/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(var\(--set-cols/);
    expect(css).toMatch(/grid-auto-rows:\s*4px/);
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content > \* \{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content > \.setting-group \{ grid-column: auto; \}/);
    expect(SettingsUI.ROW_UNIT).toBe(4);
  });
});
