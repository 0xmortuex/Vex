// @vitest-environment jsdom
//
// Discord's block bypass keeps what the user chose and replays it at start.
// Auto-configure used to save only the word 'auto', so every launch swept
// every method again (a minute of Discord going nowhere), even after a sweep
// that had found nothing; and the preset that worked was never kept. The IPC
// contract did not even allow 'auto', so the sweep was refused before it ran.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { DiscordBypass } = require('../../src/renderer/js/discord-bypass.js');

let calls, answers;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  answers = {};
  window.vex = {
    setDiscordBypassMode: vi.fn(async (mode, opts) => {
      calls.push([mode, opts]);
      return answers[mode] || { ok: true, mode };
    }),
  };
});

describe('a sweep saves what it found', () => {
  it('saves the preset that got through, as Strong', async () => {
    answers.auto = { ok: true, mode: 'auto', via: 'byedpi', preset: 3 };
    const { choice } = await DiscordBypass.sweep();
    expect(choice).toEqual({ mode: 'strong', preset: 3 });
    expect(localStorage.getItem('vex.discordBypassMode')).toBe('strong');
    expect(localStorage.getItem('vex.discordBypassPreset')).toBe('3');
  });

  it('saves light when nothing got through, and puts light back on', async () => {
    answers.auto = { ok: false, mode: 'auto', error: 'no mode got through' };
    const { choice } = await DiscordBypass.sweep();
    expect(choice).toEqual({ mode: 'light' });
    expect(calls.map(c => c[0])).toEqual(['auto', 'light']);
  });

  it('saves light when built-in light was what got through', async () => {
    answers.auto = { ok: true, mode: 'auto', via: 'light' };
    expect((await DiscordBypass.sweep()).choice).toEqual({ mode: 'light' });
  });
});

describe('at start the saved choice is replayed, never swept again', () => {
  it('replays a saved preset as a forced Strong preset', async () => {
    DiscordBypass.save({ mode: 'strong', preset: 5 });
    await DiscordBypass.replay();
    expect(calls).toEqual([['strong', { preset: 5 }]]);
  });

  it('replays custom flags', async () => {
    DiscordBypass.save({ mode: 'strong', custom: '--split 2' });
    await DiscordBypass.replay();
    expect(calls).toEqual([['strong', { custom: '--split 2' }]]);
  });

  it('replays off', async () => {
    DiscordBypass.save({ mode: 'off' });
    await DiscordBypass.replay();
    expect(calls).toEqual([['off', {}]]);
  });

  it('sends nothing for light: main starts on it', async () => {
    expect(await DiscordBypass.replay()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a failed sweep is not run again at the next launch', async () => {
    answers.auto = { ok: false };
    await DiscordBypass.sweep();
    calls.length = 0;
    await DiscordBypass.replay();            // the next launch
    expect(calls.map(c => c[0])).not.toContain('auto');
  });

  it("an 'auto' saved by an older Vex is swept once, then its result is kept", async () => {
    localStorage.setItem('vex.discordBypassMode', 'auto');
    answers.auto = { ok: true, via: 'byedpi', preset: 0 };
    await DiscordBypass.replay();
    expect(calls[0][0]).toBe('auto');
    expect(DiscordBypass.choice()).toEqual({ mode: 'strong', preset: 0 });
    calls.length = 0;
    await DiscordBypass.replay();
    expect(calls).toEqual([['strong', { preset: 0 }]]);
  });
});

describe('the wiring', () => {
  const root = path.join(__dirname, '../..');
  it("main's IPC contract lets Auto-configure through", () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('discord:set-bypass-mode', ['auto', {}])).not.toThrow();
    expect(() => validate('discord:set-bypass-mode', ['strong', { preset: 2 }])).not.toThrow();
  });

  it('knows as many presets as ByeDPI has', () => {
    expect(DiscordBypass.PRESETS).toBe(require('../../src/byedpi.js').PRESETS.length);
  });

  it('the sidebar replays the saved choice instead of re-running the sweep', () => {
    const src = fs.readFileSync(path.join(root, 'src/renderer/js/sidebar.js'), 'utf8');
    expect(src).toMatch(/DiscordBypass\.replay\(\)/);
    expect(src).not.toMatch(/setDiscordBypassMode\(m, \{\}\)/);
    expect(src).not.toMatch(/localStorage\.setItem\('vex\.discordBypassMode', 'auto'\)/);
  });

  it("main does not put light over a choice the window already replayed", () => {
    const src = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
    expect(src).toMatch(/if \(!_discordModeAsked \|\| _discordModeAsked === 'light'\) _applyDiscordBypass\('light'\);/);
  });

  it('the feature list points at a bypass section that exists', () => {
    const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
    const cat = fs.readFileSync(path.join(root, 'src/renderer/js/feature-catalog.js'), 'utf8');
    expect(cat).toMatch(/id: 'dpi'[^\n]*section: 'discord-bypass-setting'/);
    expect(html).toMatch(/id="discord-bypass-setting"/);
    expect(html).toMatch(/<script src="js\/discord-bypass\.js"><\/script>/);
  });
});

describe('the settings section', () => {
  it('shows the saved choice and switches to a preset', async () => {
    window.SidebarManager = globalThis.SidebarManager = { reloadDiscordForBypass: vi.fn(), _enableBypassAuto: vi.fn(async () => {}) };
    window.showToast = vi.fn();
    DiscordBypass.save({ mode: 'strong', preset: 1 });
    const host = document.createElement('div');
    DiscordBypass.renderSetting(host);
    const sel = host.querySelector('[data-bypass-mode]');
    expect(sel.value).toBe('1');
    sel.value = '4';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(SidebarManager.reloadDiscordForBypass).toHaveBeenCalled());
    expect(calls).toEqual([['strong', { preset: 4 }]]);
    expect(DiscordBypass.choice()).toEqual({ mode: 'strong', preset: 4 });
  });

  it('keeps the old choice when main refuses the new one', async () => {
    window.SidebarManager = globalThis.SidebarManager = { reloadDiscordForBypass: vi.fn() };
    window.showToast = vi.fn();
    answers.strong = { ok: false, error: 'ByeDPI exited immediately' };
    const host = document.createElement('div');
    DiscordBypass.renderSetting(host);
    const sel = host.querySelector('[data-bypass-mode]');
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalled());
    expect(DiscordBypass.choice()).toEqual({ mode: 'light' });
    expect(window.showToast.mock.calls[0][0]).toMatch(/exited immediately/);
    expect(sel.value).toBe('light');
  });
});
