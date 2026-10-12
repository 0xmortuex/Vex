// @vitest-environment jsdom
// Undo Last Grouping takes back only what that grouping did (AI audit
// 2026-10-10): it deleted every group made since, including ones made by hand,
// and put back tabs that had been moved by hand since.
import { beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.VexUndo = { offer: vi.fn() };
  globalThis.TabManager = {
    activeTabId: 'a', groups: [],
    tabs: [
      { id: 'a', url: 'https://alpha.example/docs', title: 'Alpha docs' },
      { id: 'b', url: 'https://alpha.example/api', title: 'Alpha api' },
      { id: 'c', url: 'https://beta.example/news', title: 'Beta news' },
      { id: 'd', url: 'https://beta.example/blog', title: 'Beta blog' },
    ],
    _setTabGroup(tabId, groupId) { const t = this.tabs.find(x => x.id === tabId); if (!t) return null; t.groupId = groupId || null; return t; },
    rebuildAllTabs: vi.fn(), persistTabs: vi.fn(), mayAskSiteForIcon: () => true,
  };
  globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify({ groups: [{ name: 'Alpha', color: 'indigo', tabIds: ['t1', 't2'] }], ungrouped: ['t3', 't4'], reasoning: 'x' }) })) };
});

describe('Undo Last Grouping', () => {
  it('removes only the groups it made, and leaves tabs moved by hand since where they are', async () => {
    const { TabGrouper } = require('../../src/renderer/js/tab-grouper.js');
    await TabGrouper.analyzeAndPropose();
    document.getElementById('preview-apply').click();
    await new Promise(r => setTimeout(r, 0));
    const alpha = TabManager.groups.find(g => g.name === 'Alpha');
    expect(TabManager.tabs.filter(t => t.groupId === alpha.id).map(t => t.id)).toEqual(['a', 'b']);

    // By hand, afterwards: a new group with the Beta tabs, and tab b moved into it.
    TabManager.groups.push({ id: 'manual', name: 'My manual group', color: '#fff' });
    for (const id of ['b', 'c', 'd']) TabManager._setTabGroup(id, 'manual');

    TabGrouper.undoLastGrouping();
    expect(TabManager.groups.map(g => g.name)).toEqual(['My manual group']);
    expect(TabManager.tabs.map(t => [t.id, t.groupId])).toEqual([['a', null], ['b', 'manual'], ['c', 'manual'], ['d', 'manual']]);
  });
});
