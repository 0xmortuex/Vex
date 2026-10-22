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

describe('the placement of the blocks is held while the sections draw', () => {
  it('holds it after the first layout, and lets go once the last section is drawn', async () => {
    const order = [];
    const release = vi.fn(() => { order.push('release'); });
    globalThis.SettingsUI = { enhance: vi.fn(() => { order.push('enhance'); }), holdLayout: vi.fn(() => { order.push('hold'); return release; }) };
    await SidebarManager._drawSettingsSections();
    expect(order).toEqual(['enhance', 'hold', 'enhance', 'release']);
  });

  it('lets go when the draw is stopped, and when a section throws', async () => {
    const release = vi.fn();
    globalThis.SettingsUI = { enhance: vi.fn(), holdLayout: vi.fn(() => release) };
    const stopped = SidebarManager._drawSettingsSections();
    SidebarManager.activePanel = null;
    expect(await stopped).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    SidebarManager.activePanel = 'settings';
    globalThis.VexProblems = { note: vi.fn() };
    globalThis.PersonasSettings = { renderPanel: () => { throw new Error('boom'); } };
    expect(await SidebarManager._drawSettingsSections()).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('a newer draw lets go of an older one that never finished', async () => {
    const releases = [];
    globalThis.SettingsUI = { enhance: vi.fn(), holdLayout: vi.fn(() => { const r = vi.fn(); releases.push(r); return r; }) };
    const first = SidebarManager._drawSettingsSections();
    const second = SidebarManager._drawSettingsSections();
    expect(releases[0]).toHaveBeenCalled();          // let go by the second run, before its own frame
    await first; await second;
    expect(releases[1]).toHaveBeenCalledTimes(1);
  });
});

describe('the first enhance is for the first open only', () => {
  it('builds the toolbar before the first paint when there is none, and not again on a later open', async () => {
    const order = [];
    globalThis.SettingsUI = { enhance: vi.fn(() => { order.push('enhance'); }), holdLayout: vi.fn(() => { order.push('hold'); return () => order.push('release'); }) };
    await SidebarManager._drawSettingsSections();
    expect(order).toEqual(['enhance', 'hold', 'enhance', 'release']);            // first open
    order.length = 0;
    document.getElementById('panel-settings').insertAdjacentHTML('afterbegin', '<div class="set-toolbar"></div>');
    await SidebarManager._drawSettingsSections();
    expect(order).toEqual(['hold', 'enhance', 'release']);                       // later: the toolbar is there, only the final one
  });
});
