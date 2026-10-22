// @vitest-environment jsdom
// Settings draws its sections in short slices after the panel is shown, instead of all of them before it can paint.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SidebarManager } from '../../src/renderer/js/sidebar.js';

const calls = [];
beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = '<div id="panel-settings"><div id="personas-panel-content"></div><div id="mcp-panel-content"></div></div>';
  SidebarManager.activePanel = 'settings';
  SidebarManager.sidePanel = null;
  globalThis.AISettings = { renderAISettings: () => { calls.push('ai'); } };
  globalThis.PersonasSettings = { renderPanel: (el) => { calls.push('personas:' + el.id); } };
  globalThis.McpClient = { renderSettings: (el) => { calls.push('mcp:' + el.id); } };
  globalThis.SettingsUI = { enhance: vi.fn(() => { calls.push('enhance'); }) };
});
afterEach(() => {
  for (const n of ['AISettings', 'PersonasSettings', 'McpClient', 'SettingsUI', 'VexProblems', 'GameMode']) delete globalThis[n];
  SidebarManager.activePanel = null;
});

describe('SidebarManager._drawSettingsSections', () => {
  it('lays Settings out at once and draws the sections afterwards, not before', async () => {
    const done = SidebarManager._drawSettingsSections();
    expect(calls).toEqual(['enhance']);                 // nothing else has been drawn when the call returns
    expect(await done).toBe(true);
    expect(calls).toEqual(['enhance', 'ai', 'personas:personas-panel-content', 'mcp:mcp-panel-content', 'enhance']);
  });

  it('draws a section only once the others in front of it have had their slice (one section a slice at most when the budget is spent)', async () => {
    SidebarManager.SETTINGS_SLICE_MS = 0;
    try {
      const done = SidebarManager._drawSettingsSections();
      await new Promise(r => setTimeout(r, 0));
      expect(calls.filter(c => c !== 'enhance').length).toBeLessThan(3);
      await done;
      expect(calls.filter(c => c !== 'enhance')).toEqual(['ai', 'personas:personas-panel-content', 'mcp:mcp-panel-content']);
    } finally { SidebarManager.SETTINGS_SLICE_MS = 8; }
  });

  it('puts the sections in the order they sit on the page', async () => {
    document.getElementById('panel-settings').appendChild(document.getElementById('personas-panel-content'));   // now after mcp
    await SidebarManager._drawSettingsSections();
    expect(calls.filter(c => /:/.test(c))).toEqual(['mcp:mcp-panel-content', 'personas:personas-panel-content']);
  });

  it('reports a section that throws, or rejects, and still draws the others', async () => {
    const note = vi.fn();
    globalThis.VexProblems = { note };
    globalThis.PersonasSettings = { renderPanel: () => { throw new Error('boom'); } };
    globalThis.GameMode = { renderSettings: () => Promise.reject(new Error('later')) };
    await SidebarManager._drawSettingsSections();
    await new Promise(r => setTimeout(r, 0));
    expect(note).toHaveBeenCalledTimes(2);
    expect(note.mock.calls.every(c => c[0] === 'Settings')).toBe(true);
    expect(calls).toContain('mcp:mcp-panel-content');
  });

  it('stops when Settings is closed, and an older run stops when a newer one starts', async () => {
    const first = SidebarManager._drawSettingsSections();
    const second = SidebarManager._drawSettingsSections();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    const third = SidebarManager._drawSettingsSections();
    SidebarManager.activePanel = null;
    expect(await third).toBe(false);
  });
});
