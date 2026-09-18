// @vitest-environment jsdom
//
// "Remove emojis and rename all group tabs" — the agent had no way to do it:
// every tool it had worked on the page in front (click, type, navigate…) and
// tab groups are Vex's own. list_tab_groups and rename_tab_group give it the
// means; the group menu's Rename and the agent share TabManager.renameGroup.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function installGlobals() {
  globalThis.VexStorage = {
    loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true),
    loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true),
    loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true),
  };
  globalThis.WebviewManager = { destroyWebview: vi.fn(), createWebview: vi.fn(), showWebview: vi.fn(), webviews: new Map(), getActiveWebview: () => null };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  globalThis.HorizontalTabs = undefined;
  globalThis.TabGrouper = undefined;
  globalThis.window.vex = { getStartPageUrl: () => new Promise(() => {}) };
}
async function loadTabManager() { vi.resetModules(); await import('../../src/renderer/js/vex-utils.js'); return (await import('../../src/renderer/js/tabs.js')).TabManager; }
function fakeTab(id, over = {}) { return { id, url: `https://${id}.example/`, title: `Tab ${id}`, favicon: null, loading: false, pinned: false, groupId: null, stackId: null, ...over }; }

beforeEach(() => {
  document.body.innerHTML = `<input id="url-input"><div id="tabs-list"></div><div id="tab-groups-container"></div><button id="btn-new-tab"></button>`;
});

describe('TabManager.renameGroup', () => {
  it('renames, saves and redraws; says what is wrong otherwise', async () => {
    installGlobals();
    const TM = await loadTabManager();
    TM.groups = [{ id: 'grp_a', name: '🎮 GAMING PLATFORM', color: '#5b8def', collapsed: false }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' })];
    TM.rebuildAllTabs = vi.fn();
    expect(TM.renameGroup('grp_a', '  Gaming Platform ').name).toBe('Gaming Platform');
    expect(VexStorage.saveGroups).toHaveBeenCalledWith(TM.groups);
    expect(TM.rebuildAllTabs).toHaveBeenCalled();
    expect(() => TM.renameGroup('grp_zzz', 'x')).toThrow(/No tab group with id "grp_zzz"/);
    expect(() => TM.renameGroup('grp_a', '   ')).toThrow(/needs a name/);
    expect(TM.groups[0].name).toBe('Gaming Platform');
  });
});

describe('the agent tools', () => {
  it('are offered to the model, and listing is a safe (no-approval) tool', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/js/agent-loop.js'), 'utf8');
    expect(src).toMatch(/name: 'list_tab_groups'/);
    expect(src).toMatch(/name: 'rename_tab_group'.*groupId: 'string', name: 'string'/);
    const safe = src.match(/const SAFE_TOOLS = \[([^\]]*)\]/)[1];
    expect(safe).toContain("'list_tab_groups'");
    expect(safe).not.toContain("'rename_tab_group'");   // a change: asks first, like click or type
  });

  it('list the groups with their tab counts, rename one, and report a bad id as a tool failure', async () => {
    installGlobals();
    const TM = await loadTabManager();
    globalThis.TabManager = TM;
    TM.groups = [{ id: 'grp_a', name: '🎮 GAMING PLATFORM', color: 'indigo' }, { id: 'grp_b', name: '🤖 CLAUDE AI TOOLS', color: 'cyan' }];
    TM.tabs = [fakeTab('t1', { groupId: 'grp_a' }), fakeTab('t2', { groupId: 'grp_a' }), fakeTab('t3', { groupId: 'grp_b' }), fakeTab('t4')];
    TM.rebuildAllTabs = vi.fn();
    // agent-executor.js is a plain script: evaluate it the way the page does.
    const code = readFileSync(join(__dirname, '../../src/renderer/js/agent-executor.js'), 'utf8');
    const AgentExecutor = new Function('TabManager', 'WebviewManager', 'window', code + '\n;return AgentExecutor;')(TM, globalThis.WebviewManager, window);

    expect(await AgentExecutor.executeTool('list_tab_groups', {})).toEqual({ ok: true, result: [
      { id: 'grp_a', name: '🎮 GAMING PLATFORM', color: 'indigo', tabs: 2 },
      { id: 'grp_b', name: '🤖 CLAUDE AI TOOLS', color: 'cyan', tabs: 1 },
    ] });
    expect(await AgentExecutor.executeTool('rename_tab_group', { groupId: 'grp_a', name: 'Gaming Platform' })).toEqual({ ok: true, result: 'Renamed group to "Gaming Platform"' });
    expect(TM.groups[0].name).toBe('Gaming Platform');
    const bad = await AgentExecutor.executeTool('rename_tab_group', { groupId: 'nope', name: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/No tab group with id "nope"/);
  });
});
