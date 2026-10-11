// @vitest-environment jsdom
// A link or a file dropped on the tab strip opens as a new tab where it was
// dropped (Chrome, Firefox); it used to do nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { TabStripDrop } = require('../../src/renderer/js/tab-strip-drop.js');

// jsdom has no layout: each tab gets a box along the strip.
function strip(ids) {
  document.body.innerHTML = '<div id="top-tab-bar"><div id="top-tabs-list"></div></div><div id="tabs-sidebar"><div id="tab-groups-container"></div><div id="tabs-list"></div></div>';
  const list = document.getElementById('top-tabs-list');
  ids.forEach((id, i) => {
    const el = document.createElement('div');
    el.className = 'top-tab'; el.dataset.tabId = id;
    el.getBoundingClientRect = () => ({ left: i * 100, width: 100, top: 0, height: 30 });
    list.appendChild(el);
  });
}
function dt({ uris = null, files = null } = {}) {
  const types = [];
  if (files) types.push('Files');
  if (uris != null) types.push('text/uri-list', 'text/plain');
  return { types, files: files || [], getData: (t) => (t === 'text/uri-list' ? uris : ''), dropEffect: '' };
}
function drop(transfer, x) {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(ev, { dataTransfer: transfer, clientX: x, clientY: 10 });
  document.querySelector('.top-tab').dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  strip(['t1', 't2', 't3']);
  TabStripDrop._installed = false;
  TabStripDrop.install();
  globalThis.TabManager = {
    tabs: [{ id: 't1', groupId: null }, { id: 't2', groupId: 'g1' }, { id: 't3', groupId: null }],
    createTab: vi.fn((url, activate, groupId, opts) => ({ url, activate, groupId, opts })),
  };
  window.showToast = vi.fn();
  window.vex = { pathForFile: vi.fn(f => 'C:\\Users\\me\\' + f.name) };
});

describe('dropping on the tab strip', () => {
  it('a link opens as a new tab at the drop position, in that tab\'s group, and comes to the front', () => {
    const ev = drop(dt({ uris: 'https://example.com/a\r\n' }), 160);   // past t2's middle
    expect(ev.defaultPrevented).toBe(true);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://example.com/a', true, 'g1', { atIndex: 2, allowDuplicate: true });
  });

  it('several links keep their order; javascript: and data: are refused', () => {
    drop(dt({ uris: '# comment\nhttps://a.test/\njavascript:alert(1)\nhttps://b.test/\ndata:text/html,x' }), 20);
    expect(TabManager.createTab.mock.calls.map(c => [c[0], c[1], c[3].atIndex])).toEqual([['https://a.test/', true, 0], ['https://b.test/', false, 1]]);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('javascript:alert(1)'), 'error');
  });

  it('a PDF or picture from Explorer opens through file://; a program is named and not opened', () => {
    drop(dt({ files: [{ name: 'report #1.pdf' }, { name: 'setup.exe' }] }), 260);
    expect(TabManager.createTab).toHaveBeenCalledTimes(1);
    expect(TabManager.createTab.mock.calls[0][0]).toBe('file:///C:/Users/me/report%20%231.pdf');
    expect(TabManager.createTab.mock.calls[0][3].atIndex).toBe(3);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('setup.exe'), 'error');
  });

  it('a tab being dragged within the strip is left to the strip', () => {
    const ev = drop({ types: ['text/plain'], files: [], getData: () => 't1' }, 20);
    expect(ev.defaultPrevented).toBe(false);
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('shows where it will land while dragging over', () => {
    const ev = new Event('dragover', { bubbles: true, cancelable: true });
    const transfer = dt({ uris: 'https://a.test/' });
    Object.assign(ev, { dataTransfer: transfer, clientX: 30, clientY: 10 });
    document.querySelector('.top-tab').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('copy');
    expect(document.querySelector('.top-tab[data-tab-id="t1"]').classList.contains('drop-before')).toBe(true);
  });
});
