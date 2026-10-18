// @vitest-environment jsdom
//
// A button in the Morning Brief on the New Tab page sends its command through console.log('VEX_CMD:...'); the
// host (webview.js) forwards it to VexBrief.onStartCommand. "Open Autopilot" (type autopilot-open) and three
// "run a Ctrl+K command" buttons (type command) were dropped by that forwarding because it only passed types
// starting with "brief-": the click did nothing at all. These tests cover the whole path, not just the handler.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let VexBrief;
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  for (const k of ['VexAutopilot', 'CommandBar', 'VexRegistry', 'VexActivation']) delete globalThis[k];
  window.showToast = vi.fn();
  VexBrief = fresh('brief.js').VexBrief;
});

describe('which types the host forwards', () => {
  it('forwards brief-*, autopilot-open and command, and nothing else', () => {
    for (const t of ['brief-refresh', 'brief-resume', 'brief-open-url', 'autopilot-open', 'command']) expect(VexBrief.isStartCommand(t), t).toBe(true);
    for (const t of ['navigate', 'typed', 'open-panel', 'pet-action', '', undefined, 42]) expect(VexBrief.isStartCommand(t), String(t)).toBe(false);
  });

  it('webview.js asks VexBrief, so a new button type cannot be dropped silently again', () => {
    const src = fs.readFileSync(path.join(JS, 'webview.js'), 'utf8');
    expect(src).toMatch(/VexBrief\.isStartCommand\(cmd\.type\)/);
    expect(src).not.toMatch(/cmd\.type\.startsWith\('brief-'\)/);
  });

  it('every command type any Brief section emits is one the host forwards', () => {
    const types = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.js')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bcmd:\s*\{\s*type:\s*'([a-z-]+)'/g)) types.add(m[1]);
      }
    };
    walk(JS);
    expect(types.size).toBeGreaterThan(3);
    for (const t of types) expect(VexBrief.isStartCommand(t), 'a Brief button of type "' + t + '" would do nothing').toBe(true);
  });
});

describe('Open Autopilot', () => {
  const offered = { sections: [{ items: [], action: { label: 'Open Autopilot', cmd: { type: 'autopilot-open' } } }] };

  it('opens the Autopilot panel', async () => {
    const showPanel = vi.fn(async () => {});
    globalThis.VexAutopilot = { showPanel };
    VexBrief._last = offered;
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(showPanel).toHaveBeenCalledTimes(1);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('says so when Autopilot is not loaded, and when its panel fails', async () => {
    VexBrief._last = offered;
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(window.showToast).toHaveBeenLastCalledWith('Autopilot is not loaded', 'error');
    globalThis.VexAutopilot = { showPanel: vi.fn(async () => { throw new Error('the panel could not draw'); }) };
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(window.showToast).toHaveBeenLastCalledWith('the panel could not draw', 'error');
  });

  it('refuses it when the last build did not offer it', async () => {
    const showPanel = vi.fn();
    globalThis.VexAutopilot = { showPanel };
    VexBrief._last = { sections: [] };
    await VexBrief.onStartCommand({ type: 'autopilot-open' });
    expect(showPanel).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Autopilot is not on offer', 'error');
  });
});

describe('a Brief button that runs a Ctrl+K command', () => {
  const offered = (id) => ({ sections: [{ items: [{ text: 'I have 10 minutes', cmd: { type: 'command', id } }] }] });

  it('runs the live command through the shared dispatcher', async () => {
    const live = { id: 'read-minutes', label: 'I Have Some Minutes to Read', action: vi.fn() };
    globalThis.CommandBar = { commands: [live], _execute: vi.fn() };
    VexBrief._last = offered('read-minutes');
    await VexBrief.onStartCommand({ type: 'command', id: 'read-minutes' });
    expect(CommandBar._execute).toHaveBeenCalledWith(live);
  });

  it('refuses a command the last build did not offer', async () => {
    globalThis.CommandBar = { commands: [{ id: 'something-else' }], _execute: vi.fn() };
    VexBrief._last = offered('read-minutes');
    await VexBrief.onStartCommand({ type: 'command', id: 'something-else' });
    expect(CommandBar._execute).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('That command is not on offer', 'error');
  });

  it('introduces the feature when the command is missing because the feature is off, then runs it once', async () => {
    const appeared = { id: 'release-radar', label: 'x', action: vi.fn() };
    globalThis.CommandBar = { commands: [], _execute: vi.fn() };
    globalThis.VexRegistry = { forCommand: (id) => (id === 'release-radar' ? 'workflow-release-radar' : null) };
    globalThis.VexActivation = { offer: vi.fn(async ({ run }) => { CommandBar.commands.push(appeared); await run(); return 'ran'; }) };
    VexBrief._last = offered('release-radar');
    await VexBrief.onStartCommand({ type: 'command', id: 'release-radar' });
    expect(VexActivation.offer).toHaveBeenCalledWith(expect.objectContaining({ featureId: 'workflow-release-radar' }));
    expect(CommandBar._execute).toHaveBeenCalledTimes(1);
    expect(CommandBar._execute).toHaveBeenCalledWith(appeared, { activated: true });
  });

  it('says it is not available when there is no live command and no feature to turn on', async () => {
    globalThis.CommandBar = { commands: [], _execute: vi.fn() };
    VexBrief._last = offered('ghost');
    await VexBrief.onStartCommand({ type: 'command', id: 'ghost' });
    expect(window.showToast).toHaveBeenCalledWith('That command is not available in this window', 'error');
  });
});
