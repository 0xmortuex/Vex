// @vitest-environment jsdom
//
// T3-054, Wave 5: drag a tab onto the page to split, and the divider's double-click going on to fill
// the whole area.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexSplitKeys: K } = require('../../src/renderer/js/split-keys.js');

let restore, panes, updated;

function setup({ active = false, activeTab = 'a' } = {}) {
  document.body.innerHTML = '<div id="webviews-container"></div>';
  panes = ['a', 'b'];
  updated = vi.fn();
  restore = vi.fn(() => true);
  globalThis.TabManager = { activeTabId: activeTab, tabs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  globalThis.SplitScreen = {
    active, panes, splitRatio: 0.5, restore, updateMiniUrlBars: updated, _saveLayout: vi.fn(),
  };
}

const dt = (id, types = ['text/plain']) => ({ types, getData: () => id, dropEffect: '' });

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  setup();
});

describe('which tab is being dragged', () => {
  it('is a real tab other than the one in front', () => {
    expect(K.dragTabId(dt('c'))).toBe('c');
    expect(K.dragTabId(dt('a'))).toBeNull();
    expect(K.dragTabId(dt('nope'))).toBeNull();
    expect(K.dragTabId(dt('c', ['Files']))).toBeNull();
    expect(K.dragTabId(null)).toBeNull();
  });
});

describe('dropping on a side', () => {
  it('splits the page in front with the dragged tab on that side', () => {
    expect(K.dropOn('left', dt('c'))).toBe('c');
    expect(restore).toHaveBeenCalledWith(['c', 'a'], 0.5);
    K.dropOn('right', dt('c'));
    expect(restore).toHaveBeenLastCalledWith(['a', 'c'], 0.5);
  });
  it('says why when it cannot', () => {
    expect(() => K.dropOn('left', dt('a'))).toThrow(/different tab/);
    setup({ active: true });
    expect(() => K.dropOn('left', dt('c'))).toThrow(/already split/);
    setup();
    K.save({ dragSplit: false });
    expect(() => K.dropOn('left', dt('c'))).toThrow(/switched off/);
    K.save({ dragSplit: true, on: false });
    expect(() => K.dropOn('left', dt('c'))).toThrow(/switched off/);
  });
  it('raises when the split cannot be made', () => {
    restore.mockReturnValue(false);
    expect(() => K.dropOn('left', dt('c'))).toThrow(/could not be split/);
  });
});

describe('the drop targets', () => {
  const tabDrag = () => { document.body.insertAdjacentHTML('beforeend', '<div class="top-tab" id="tt"></div>'); return document.getElementById('tt'); };
  beforeEach(() => { K.wireDrag(); });
  it('appear when a tab starts to be dragged and go when the drag ends', () => {
    const tab = tabDrag();
    expect(document.getElementById('vex-split-drop')).toBeNull();
    tab.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const box = document.getElementById('vex-split-drop');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.vex-split-drop-zone')].map(z => z.dataset.side)).toEqual(['left', 'right']);
    document.dispatchEvent(new Event('dragend'));
    expect(box.hidden).toBe(true);
  });
  it('do not appear for something that is not a tab, when split already, or when switched off', () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="para"></p>');
    document.getElementById('para').dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(document.getElementById('vex-split-drop')).toBeNull();
    const tab = tabDrag();
    K.save({ dragSplit: false });
    tab.dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(document.getElementById('vex-split-drop')).toBeNull();
    K.save({ dragSplit: true });
    SplitScreen.active = true;
    tab.dispatchEvent(new Event('dragstart', { bubbles: true }));
    expect(document.getElementById('vex-split-drop')).toBeNull();
  });
  it('a drop on a target splits and hides the targets', () => {
    const tab = tabDrag();
    tab.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const right = document.querySelector('.vex-split-drop-zone[data-side="right"]');
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = dt('c');
    right.dispatchEvent(ev);
    expect(restore).toHaveBeenCalledWith(['a', 'c'], 0.5);
    expect(document.getElementById('vex-split-drop').hidden).toBe(true);
  });
  it('a refused drop says why in a toast', () => {
    const tab = tabDrag();
    tab.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const left = document.querySelector('.vex-split-drop-zone[data-side="left"]');
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = dt('a');
    left.dispatchEvent(ev);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/different tab/), 'error');
  });
});

describe('the divider fills the area', () => {
  const cols = () => document.getElementById('webviews-container').style.gridTemplateColumns;
  beforeEach(() => { setup({ active: true }); });
  it('goes half, 80 percent, whole area, half', () => {
    K.toggleFocused();
    expect(SplitScreen.splitRatio).toBe(0.8);
    K.toggleFocused();
    expect(cols()).toBe('1fr 0px 0fr');
    expect(K.isFilled()).toBe(true);
    K.toggleFocused();
    expect(SplitScreen.splitRatio).toBe(0.5);
    expect(K.isFilled()).toBe(false);
  });
  it('gives the area to the pane in front when it is the second one', () => {
    setup({ active: true, activeTab: 'b' });
    K.toggleFill();
    expect(cols()).toBe('0fr 0px 1fr');
    expect(K.toggleFill()).toBe(false);
    expect(SplitScreen.splitRatio).toBe(0.5);
  });
  it('keeps the saved ratio while the area is filled', () => {
    K.toggleFill();
    expect(SplitScreen.splitRatio).toBe(0.5);
    expect(SplitScreen._saveLayout).not.toHaveBeenCalled();
  });
  it('is for a split of two panes only', () => {
    SplitScreen.panes.push('c');
    expect(() => K.toggleFill()).toThrow(/two panes/);
  });
});
