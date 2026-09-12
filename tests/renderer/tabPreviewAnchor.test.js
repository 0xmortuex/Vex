// @vitest-environment jsdom
//
// Tab-preview regression: the popup used to get stuck on screen.
//
// mouseleave never fires for an element that was removed from the document, so
// a preview shown over a tab that then re-rendered (a title arriving, a tab
// closing, a workspace switch) stayed pinned over the page until the next
// hover happened to dismiss it. TabPreview now remembers its anchor and drops
// the popup on vex-tabs-changed once that anchor is detached.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TabPreview, HOVER_DELAY_MS } from '../../src/renderer/js/tab-preview.js';

function tabRow(id) {
  const el = document.createElement('div');
  el.className = 'tab-item';
  el.dataset.tabId = id;
  document.getElementById('tabs-list').appendChild(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="tabs-sidebar"><div id="tabs-list"></div></div>
    <div id="top-tabs-list"></div>
  `;
  globalThis.TabManager = { tabs: [{ id: 't1', title: 'One', url: 'https://one.example/' }] };
  globalThis.WebviewManager = { webviews: new Map() };
  TabPreview._previewEl = null;
  TabPreview._anchor = null;
  TabPreview._hoverTimer = null;
  TabPreview.init();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById('tab-preview')?.remove();
});

const visible = () => document.getElementById('tab-preview').classList.contains('visible');

describe('TabPreview anchoring', () => {
  it('shows the popup and remembers its anchor', () => {
    const row = tabRow('t1');
    TabPreview._startHover(row);
    vi.advanceTimersByTime(HOVER_DELAY_MS);

    expect(visible()).toBe(true);
    expect(TabPreview._getAnchorForTest()).toBe(row);
  });

  it('dismisses the popup when a re-render removes the anchor', () => {
    const row = tabRow('t1');
    TabPreview._startHover(row);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(visible()).toBe(true);

    document.getElementById('tabs-list').innerHTML = ''; // what rebuildAllTabs does
    window.dispatchEvent(new CustomEvent('vex-tabs-changed'));

    expect(visible()).toBe(false);
    expect(TabPreview._getAnchorForTest()).toBeNull();
  });

  it('keeps the popup when the anchor is still in the document', () => {
    const row = tabRow('t1');
    TabPreview._startHover(row);
    vi.advanceTimersByTime(HOVER_DELAY_MS);

    window.dispatchEvent(new CustomEvent('vex-tabs-changed'));

    expect(visible()).toBe(true);
  });

  it('never shows a popup anchored to a detached element', () => {
    const row = tabRow('t1');
    TabPreview._startHover(row);
    row.remove();                      // render happened during the hover delay
    vi.advanceTimersByTime(HOVER_DELAY_MS);

    expect(visible()).toBe(false);
    expect(TabPreview._getAnchorForTest()).toBeNull();
  });

  it('clears the anchor on an ordinary cancel', () => {
    const row = tabRow('t1');
    TabPreview._startHover(row);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    TabPreview._cancelHover();

    expect(visible()).toBe(false);
    expect(TabPreview._getAnchorForTest()).toBeNull();
  });
});
