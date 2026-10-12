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
    // The heading across both columns, then General and Downloads side by side.
    expect(root.querySelector('h2').style.gridColumn).toBe('1 / -1');
    expect(root.querySelector('h2').style.gridRow).toBe('1 / span 13');      // ceil(50 / 4)
    expect(root.querySelector('#g1').style.gridColumn).toBe('1');
    expect(root.querySelector('#g1').style.gridRow).toBe('14 / span 105');   // ceil((402 + 16) / 4)
    expect(root.querySelector('#g2').style.gridColumn).toBe('2');
    expect(root.querySelector('#g2').style.gridRow).toBe('14 / span 25');    // ceil(97 / 4)
    expect(root.querySelector('#g3').style.gridRow).toBe('');                // hidden: left alone
  });

  it('goes back to one plain column when the area narrows', () => {
    width(1868);
    SettingsUI._layout(root);
    width(1100);
    SettingsUI._layout(root);
    expect(panel.dataset.setCols).toBeUndefined();
    expect(panel.style.getPropertyValue('--set-cols')).toBe('');
    for (const el of root.children) { expect(el.style.gridRow).toBe(''); expect(el.style.gridColumn).toBe(''); }
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

// Where every block lands. In a wide window, and more so in full screen
// (three columns), the AI chip row spanned every column and waited for the
// longest one: the shorter columns ended in an empty band of 180-420px (the
// owner, 2026-10-12: "once I press F11 ... some gaps in settings").
describe('SettingsUI.placeBlocks', () => {
  // Every pair of blocks in the same column: none overlaps, and none starts
  // later than where the one above it in that column ended.
  const check = (items, at, cols) => {
    const byCol = {};
    at.forEach((p, i) => {
      const cs = p.col === 0 ? Array.from({ length: cols }, (_, k) => k + 1) : [p.col];
      for (const c of cs) (byCol[c] = byCol[c] || []).push({ ...p, i });
    });
    for (const list of Object.values(byCol)) {
      list.sort((a, b) => a.row - b.row);
      for (let k = 1; k < list.length; k++) {
        const above = list[k - 1], b = list[k];
        expect(b.row).toBeGreaterThanOrEqual(above.row + above.rows);           // no overlap
        if (at[b.i].col !== 0) expect(b.row).toBe(above.row + above.rows);    // no gap above a section
      }
    }
  };

  it('puts each section at the end of the column that ends first, in order', () => {
    const items = [{ rows: 10, wide: true }, { rows: 100 }, { rows: 30 }, { rows: 50 }, { rows: 20 }, { rows: 5, wide: true }];
    const at = SettingsUI.placeBlocks(items, 2);
    expect(at).toEqual([
      { col: 0, row: 1, rows: 10 },
      { col: 1, row: 11, rows: 100 },   // column 1 now ends at 111
      { col: 2, row: 11, rows: 30 },    // column 2 at 41
      { col: 2, row: 41, rows: 50 },    // still the shorter: 91
      { col: 2, row: 91, rows: 20 },    // 111, level with column 1
      { col: 0, row: 111, rows: 5 },    // across both, under the longer
    ]);
    check(items, at, 2);
  });

  it('keeps a group\'s chip row above its first section, in that section\'s column, with no band under the other columns', () => {
    // Settings in full screen: three columns, the AI chip row in the middle.
    const items = [{ rows: 12, wide: true }];
    const heights = [120, 40, 180, 90, 60, 150, 30, 200, 75];
    for (const h of heights) items.push({ rows: h });
    items.push({ rows: 11, lead: true });            // the AI chip row
    for (const h of [140, 60, 90, 120, 45]) items.push({ rows: h });
    items.push({ rows: 6, wide: true });             // Show advanced settings
    for (const cols of [1, 2, 3]) {
      const at = SettingsUI.placeBlocks(items, cols);
      check(items, at, cols);
      const lead = at[1 + heights.length];
      const first = at[2 + heights.length];
      expect(lead.col).not.toBe(0);
      expect(first.col).toBe(lead.col);
      expect(first.row).toBe(lead.row + lead.rows);
    }
  });

  it('is one plain column when there is one', () => {
    const at = SettingsUI.placeBlocks([{ rows: 3, wide: true }, { rows: 4 }, { rows: 2, lead: true }, { rows: 5 }], 1);
    expect(at).toEqual([{ col: 1, row: 1, rows: 3 }, { col: 1, row: 4, rows: 4 }, { col: 1, row: 8, rows: 2 }, { col: 1, row: 10, rows: 5 }]);
  });
});

describe('SettingsUI._layout with a group\'s chip row', () => {
  it('ends the list with Show advanced settings in the column that ends first, not across all of them', () => {
    document.body.innerHTML = `
      <div class="panel" id="panel-settings"><div class="settings-content">
        <div class="setting-group" id="a"></div><div class="setting-group" id="b"></div>
        <button class="set-advanced-toggle" id="adv"></button>
      </div></div>`;
    const root = document.querySelector('.settings-content');
    const heights = { a: 800, b: 200, adv: 40 };
    for (const el of root.children) {
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => heights[el.id] });
      el.getClientRects = () => [{}];
    }
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 1868 });
    SettingsUI._layout(root);
    expect(document.getElementById('adv').style.gridColumn).toBe('2');
    expect(document.getElementById('adv').style.gridRow).toBe('51 / span 10');
  });

  it('places the chip row and its first section together in one column', () => {
    document.body.innerHTML = `
      <div class="panel" id="panel-settings"><div class="settings-content">
        <h2>Settings</h2>
        <div class="setting-group" id="a"></div>
        <div class="setting-group" id="b"></div>
        <div class="setting-group" id="c"></div>
        <div class="set-subnav" id="row"></div>
        <div class="setting-group" id="ai"></div>
        <div class="setting-group" id="d"></div>
      </div></div>`;
    const root = document.querySelector('.settings-content');
    const heights = { H2: 40, a: 800, b: 200, c: 300, row: 40, ai: 400, d: 100 };
    for (const el of root.children) {
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => heights[el.id || el.tagName] });
      el.getClientRects = () => [{}];
    }
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 1868 });
    SettingsUI._layout(root);
    const row = document.getElementById('row').style, ai = document.getElementById('ai').style;
    expect(row.gridColumn).not.toBe('1 / -1');           // not across every column
    expect(row.gridColumn).toBe(ai.gridColumn);
    // Column 2 holds b and c (500px = rows 11..136), so the row starts there.
    expect(row.gridColumn).toBe('2');
    expect(row.gridRow).toBe('136 / span 10');
    expect(ai.gridRow).toBe('146 / span 100');
  });
});

// The size observer places the blocks in the same frame: waiting for the next
// one painted 15-28 blocks over each other while Larger text restyled.
describe('SettingsUI._watchLayout', () => {
  let observers, frames, root, panel, heights;
  beforeEach(() => {
    observers = [];
    frames = [];
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = []; observers.push(this); } observe(el) { this.els.push(el); } unobserve() {} disconnect() {} };
    globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    SettingsUI._layoutWatched = null; SettingsUI._sizeObserver = null; SettingsUI._blockObserver = null; SettingsUI._observed = null;
    document.body.innerHTML = `
      <div class="panel" id="panel-settings"><div class="settings-content">
        <div class="setting-group" id="a"></div><div class="setting-group" id="b"></div><div class="setting-group" id="c"></div>
      </div></div>`;
    panel = document.getElementById('panel-settings');
    root = panel.querySelector('.settings-content');
    heights = { a: 400, b: 100, c: 100 };
    for (const el of root.children) {
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => heights[el.id] });
      el.getClientRects = () => [{}];
    }
  });
  const width = (w) => Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => w });

  const watchers = () => ({
    area: observers.find(o => o.els.includes(root)),
    blocks: observers.find(o => o.els.includes(document.getElementById('a'))),
  });

  it('watches the area and every block, and places blocks again inside the area\'s observer, before the frame is painted', () => {
    width(1868);
    SettingsUI._watchLayout(root);
    const { area: ro, blocks } = watchers();
    expect(ro).toBeTruthy();
    for (const el of root.children) expect(blocks.els).toContain(el);
    expect(document.getElementById('c').style.gridRow).toBe('26 / span 25');   // under b in column 2
    heights.b = 600;                                                          // b grows
    ro.cb([{ target: root }]);
    expect(frames.length).toBe(0);                                            // no waiting for a frame
    expect(document.getElementById('c').style.gridColumn).toBe('1');          // column 1 ends first now
    expect(document.getElementById('c').style.gridRow).toBe('101 / span 25');
  });

  it('measures a block for a new column count without its old place (column 3 of a grid now two wide)', () => {
    width(2508);
    SettingsUI._layout(root);
    expect(document.getElementById('c').style.gridColumn).toBe('3');
    // In Chromium a block left in column 3 of a two-column grid gets a column
    // of its own and its own height; here: 2000px while it is there.
    const c = document.getElementById('c');
    Object.defineProperty(c, 'offsetHeight', { configurable: true, get: () => (c.style.gridColumn === '3' ? 2000 : 100) });
    width(1868);
    SettingsUI._layout(root);
    expect(panel.dataset.setCols).toBe('2');
    expect(c.style.gridRow).toBe('26 / span 25');
  });

  it('a block\'s own change waits for the next frame: placed inside the observer that reports blocks, Chromium reports a ResizeObserver loop', () => {
    width(1868);
    SettingsUI._watchLayout(root);
    const { blocks } = watchers();
    heights.b = 600;
    blocks.cb([{ target: document.getElementById('b') }]);
    expect(frames.length).toBe(1);
    expect(document.getElementById('c').style.gridRow).toBe('26 / span 25');   // not yet
    frames.shift()();
    expect(document.getElementById('c').style.gridRow).toBe('101 / span 25');
  });

  it('watches a new block from outside the observer: started inside it, Chromium reports a ResizeObserver loop', () => {
    width(1868);
    SettingsUI._watchLayout(root);
    const { area: ro } = watchers();
    const blk = watchers().blocks;
    const row = document.createElement('div');
    row.className = 'set-subnav';
    row.getClientRects = () => [{}];
    Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => 40 });
    root.insertBefore(row, document.getElementById('c'));
    ro.cb([{ target: root }]);
    expect(blk.els).not.toContain(row);         // not inside the callback
    expect(frames.length).toBe(1);              // the next frame does it
    frames.shift()();
    expect(blk.els).toContain(row);
    // And while Settings is closed: watched at once, nothing measured.
    const row2 = row.cloneNode();
    root.appendChild(row2);
    width(0);
    SettingsUI._layout(root);
    expect(blk.els).toContain(row2);
  });

  it('counts rows as they are drawn under Larger text, so a very tall section is not cut short', () => {
    // Zoom 1.3: a 4px row is drawn 5.1875px (1/64ths, rounded down), not 5.2.
    width(1868 / 1.3);
    Object.defineProperty(root, 'offsetWidth', { configurable: true, get: () => 1000 });
    root.getBoundingClientRect = () => ({ width: 1300, height: 800, top: 0, left: 0, right: 1300, bottom: 800 });
    heights.a = 5139;                                   // AI Personas, 35 cards
    SettingsUI._layout(root);
    // 5139 / 4 = 1285 rows were 16 screen pixels short; at the drawn pitch it takes 1288.
    expect(document.getElementById('a').style.gridRow).toBe('1 / span 1288');
  });

  it('changes the column count in the next frame, and places the blocks for the count in use meanwhile', () => {
    width(1868);
    SettingsUI._watchLayout(root);
    const ro = watchers().area;
    width(2508);                                                             // full screen on a wider screen
    heights.a = 300;
    ro.cb([{ target: root }]);
    expect(panel.dataset.setCols).toBe('2');                                  // not inside the observer
    expect(document.getElementById('a').style.gridRow).toBe('1 / span 75');  // but placed at its new height
    expect(frames.length).toBe(1);
    frames.shift()();
    expect(panel.dataset.setCols).toBe('3');
    expect(document.getElementById('c').style.gridColumn).toBe('3');
  });
});

describe('a switch in a row', () => {
  it('never shrinks beside a long label (a squeezed switch was a circle with its knob outside it)', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/css/app.css'), 'utf8');
    expect(app).toMatch(/\n\.toggle \{[^}]*flex-shrink:\s*0/);
  });
});

describe('the column CSS', () => {
  it('is only on while _layout says so, and spans everything but a section across the columns', () => {
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content \{[^}]*display:\s*grid/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(var\(--set-cols/);
    expect(css).toMatch(/grid-auto-rows:\s*4px/);
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content > \* \{[^}]*grid-column:\s*1 \/ -1/);
    // Until placed, a block is one column wide, so it is measured at the width it gets.
    expect(css).toMatch(/#panel-settings\[data-set-cols\] \.settings-content > :is\(\.setting-group, \.set-subnav, \.set-advanced-toggle\) \{ grid-column: auto; \}/);
    expect(SettingsUI.ROW_UNIT).toBe(4);
  });
});
