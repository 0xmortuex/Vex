// @vitest-environment jsdom
//
// Asked for a 20 minute timer, the agent opened a timer WEBSITE and left it
// unstarted. It had no timer tool, and nothing told it Vex has a clock. Now:
//   start_timer / list_timers / cancel_timer — Vex's own Clock
//   vex_features — the Discover catalogue, searchable
//   vex_command  — what the user would type into Ctrl+K
//   the guide names all of it, with the catalogue in one paragraph
// And `screenshot` hands back a real image instead of "Screenshot captured".

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexClock } = require('../../src/renderer/js/clock-panel.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { AgentExecutor, SCHEDULED_TOOLS } = require('../../src/renderer/js/agent-executor.js');

let ran;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  ran = [];
  VexClock._timers = [];
  globalThis.VexClock = VexClock;
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexQuickCommands = VexQuickCommands;
  globalThis.AgentTools = AgentTools;
  globalThis.CommandBar = { commands: [
    { id: 'clock', label: 'Clock', hint: 'Alarms, timers, stopwatch and a world clock', action: () => ran.push('clock') },
    { id: 'split', label: 'Split View', hint: 'Two pages side by side', action: () => ran.push('split') },
  ] };
  globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map() };
  globalThis.TabManager = { tabs: [], activeTabId: null };
  delete window.VexTabPolicy;
  window.vex = {};
});

describe("Vex's own timer", () => {
  it('start_timer starts a real Clock timer and says when it rings', async () => {
    const r = await AgentExecutor.executeTool('start_timer', { duration: '20 min', label: 'Tea' });
    expect(r.ok).toBe(true);
    expect(r.result).toMatch(/^Started a 20:00 timer "Tea" in Vex — it rings at /);
    expect(VexClock._timers).toHaveLength(1);
    expect(VexClock._timers[0].total).toBe(20 * 60000);
    expect(JSON.parse(localStorage.getItem('vex.clock.timers'))).toHaveLength(1);   // survives a reload
  });

  it('needs no page, and a length it cannot read comes back as the error', async () => {
    const r = await AgentExecutor.executeTool('start_timer', { duration: 'a while' });
    expect(r).toEqual({ ok: false, error: 'Could not read "a while" as a length of time.' });
    expect(VexClock._timers).toHaveLength(0);
  });

  it('lists and cancels', async () => {
    await AgentExecutor.executeTool('start_timer', { duration: '5 min', label: 'Eggs' });
    const list = await AgentExecutor.executeTool('list_timers', {});
    expect(list.result).toEqual([{ id: VexClock._timers[0].id, label: 'Eggs', left: '5:00' }]);
    const gone = await AgentExecutor.executeTool('cancel_timer', { id: list.result[0].id });
    expect(gone).toEqual({ ok: true, result: 'Cancelled the timer "Eggs"' });
    expect(VexClock._timers).toHaveLength(0);
    expect((await AgentExecutor.executeTool('cancel_timer', { id: 'nope' })).error).toMatch(/list_timers gives the ids/);
  });
});

describe('what Vex can do by itself', () => {
  it('vex_features finds the Clock for "alarm stopwatch", with the command that opens it', async () => {
    const r = await AgentExecutor.executeTool('vex_features', { query: 'alarm stopwatch' });
    expect(r.ok).toBe(true);
    expect(r.result.length).toBeGreaterThan(0);
    expect(r.result.length).toBeLessThanOrEqual(8);
    expect(r.result[0]).toMatchObject({ command: 'clock' });
    expect(r.result[0].what).toMatch(/stopwatch/);
    expect((await AgentExecutor.executeTool('vex_features', { query: '' })).error).toMatch(/needs a query/);
  });

  it('the digest names every category and the features in it', () => {
    const d = AgentTools.featureDigest();
    for (const c of VexFeatures.CATS) expect(d).toContain(c.name + ': ');
    expect(d).toContain('Sleeping tabs');
    expect(d.length).toBeLessThan(6000);      // it rides in every request
  });

  it('vex_command runs a command-bar sentence', async () => {
    const r = await AgentExecutor.executeTool('vex_command', { command: 'timer 10 min pasta' });
    expect(r.ok).toBe(true);
    expect(r.result).toMatch(/^Ran in Vex: Timer: 10:00 — pasta/);
    expect(VexClock._timers.map(t => t.label)).toEqual(['pasta']);
  });

  it('vex_command runs a command by id or by its label, and says so when there is none', async () => {
    expect((await AgentExecutor.executeTool('vex_command', { command: 'split' })).result).toBe('Ran in Vex: Split View — Two pages side by side');
    expect((await AgentExecutor.executeTool('vex_command', { command: 'clock' })).ok).toBe(true);
    expect(ran).toEqual(['split', 'clock']);
    const none = await AgentExecutor.executeTool('vex_command', { command: 'make coffee' });
    expect(none).toEqual({ ok: false, error: 'Vex has no command "make coffee" — call vex_features to find the right command id' });
  });

  it('a tool name passed as a command is pointed back at the tool (seen live: vex_command "start_timer 45s Tea")', async () => {
    globalThis.AGENT_TOOLS = require('../../src/renderer/js/agent-loop.js').AGENT_TOOLS;
    try {
      const r = await AgentExecutor.executeTool('vex_command', { command: 'start_timer 45s Tea' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/^start_timer is one of your tools, not a Vex command — call it directly/);
      expect(VexClock._timers).toHaveLength(0);
    } finally { delete globalThis.AGENT_TOOLS; }
  });

  it('a sentence the command bar half-understands fails with its reason, and runs nothing', async () => {
    const r = await AgentExecutor.executeTool('vex_command', { command: 'timer soon' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Say how long/);
    expect(VexClock._timers).toHaveLength(0);
  });
});

describe('screenshot', () => {
  const native = (w, h) => ({ isEmpty: () => false, getSize: () => ({ width: w, height: h }), resize: vi.fn(({ width }) => native(width, Math.round(h * width / w))), toDataURL: () => 'data:image/png;base64,AAAA' });

  it('returns a downscaled JPEG beside the result, never inside it', async () => {
    AgentTools._toJpeg = vi.fn(async () => 'data:image/jpeg;base64,SMALL');
    const big = native(1920, 1080);
    const r = await AgentExecutor.executeTool('screenshot', {}, { webview: { capturePage: async () => big } });
    expect(big.resize).toHaveBeenCalledWith({ width: 1024 });
    expect(AgentTools._toJpeg).toHaveBeenCalledWith('data:image/png;base64,AAAA', 1024, 576);
    expect(r.image).toBe('data:image/jpeg;base64,SMALL');
    expect(r.result).toMatchObject({ hasScreenshot: true, width: 1024, height: 576 });
    expect(JSON.stringify(r.result)).not.toContain('base64');
  });

  it('a capture that fails is a failure, not "Screenshot captured"', async () => {
    const r = await AgentExecutor.executeTool('screenshot', {}, { webview: { capturePage: async () => ({ isEmpty: () => true }) } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not be captured/);
  });
});

describe('an unattended (scheduled) run', () => {
  it('may research and keep a note, and still may not click, type or run Vex commands', async () => {
    for (const t of ['web_search', 'read_url', 'save_note']) expect(SCHEDULED_TOOLS).toContain(t);
    const wv = { isConnected: true };
    for (const t of ['click', 'click_text', 'type_text', 'vex_command', 'start_timer', 'close_tab', 'create_reminder']) {
      expect(await AgentExecutor.executeTool(t, {}, { webview: wv, scheduled: true })).toEqual({ ok: false, error: 'This tool requires an interactive run: ' + t });
    }
    const saved = await AgentExecutor.executeTool('save_note', { title: 'Prices', content: 'GPU 499' }, { webview: wv, scheduled: true });
    expect(saved.ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.notes'))[0]).toMatchObject({ title: 'Prices', tags: ['agent'] });
  });
});
