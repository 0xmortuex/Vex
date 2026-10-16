// @vitest-environment jsdom
//
// "Why is Discord big?": a report built only when asked for, from what Vex
// already knows. It must read, never write, and say what it could not read.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');

let sb, page;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  DiscordMemory._quietUntil = 0;
  DiscordMemory._toldMB = 0;
  DiscordMemory._raisedTo = 0;
  const wv = document.createElement('webview');
  wv.getWebContentsId = () => 11;
  wv.isCurrentlyAudible = () => false;
  sb = {
    panelWebviews: { discord: wv }, activePanel: 'claude', sidePanel: null,
    isPanelCapturing: () => false, _discordInCall: async () => false,
    keepAwakeFor: () => ({ mode: 'always' }), keptAwakeNow: () => true, _discordThrottled: false,
  };
  globalThis.SidebarManager = sb;
  page = { heap: { used: 300 * 1048576, total: 400 * 1048576, limit: 4096 * 1048576 }, nodes: 52000, vencord: true, heavy: ['MessageLoggerEnhanced'], enabledPlugins: 40, spoofed: true };
  window.vex = {
    processes: vi.fn(async () => ({ processes: [{ pid: 99, memKB: 1638 * 1024, privKB: 1500 * 1024, cpu: 3, contents: [{ id: 11, kind: 'webview' }] }] })),
    extensionsList: vi.fn(async () => [
      { name: 'uBlock', folder: 'ub', enabled: true, where: ['persist:main', 'persist:discord'] },
      { name: 'Off one', folder: 'off', enabled: false, where: ['persist:discord'] },
      { name: 'Elsewhere', folder: 'el', enabled: true, where: ['persist:main'] },
    ]),
  };
  window.vexGuestEval = vi.fn(async () => page);
  globalThis.WebviewManager = { scriptsOffIn: () => false };
  window.showToast = vi.fn();
});

describe('collect', () => {
  it('reads the process, the page, the extensions and the choices, and writes nothing', async () => {
    const d = await DiscordMemory.collect();
    expect(d.problems).toEqual([]);
    expect(d).toMatchObject({ pid: 99, wsMB: 1638, privMB: 1500, spoofed: true, throttled: false, domNodes: 52000 });
    expect(d.heap).toEqual({ usedMB: 300, totalMB: 400, limitMB: 4096 });
    expect(d.plugins).toEqual({ heavy: ['MessageLoggerEnhanced'], enabled: 40 });
    expect(d.extensions).toEqual(['uBlock']);
    expect(d.keepAwake).toEqual({ mode: 'always', now: true });
    expect(d.limit.savedMB).toBe(1000);
    expect(localStorage.length).toBe(0);
  });

  it('does not ask a page whose JavaScript is off, and says so', async () => {
    globalThis.WebviewManager = { scriptsOffIn: () => true };
    const d = await DiscordMemory.collect();
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(d.heap).toBeNull();
    expect(d.problems.join(' ')).toMatch(/JavaScript is off/);
    expect(d.wsMB).toBe(1638);
  });

  it('keeps going and names each part it could not read', async () => {
    window.vexGuestEval = vi.fn(async () => { throw new Error('timed out'); });
    window.vex.extensionsList = vi.fn(async () => { throw new Error('no list'); });
    const d = await DiscordMemory.collect();
    expect(d.problems.join('|')).toMatch(/page could not be asked: timed out/);
    expect(d.problems.join('|')).toMatch(/extension list could not be read: no list/);
    expect(d.wsMB).toBe(1638);
  });

  it('says so when Discord is not loaded', async () => {
    sb.panelWebviews = {};
    const d = await DiscordMemory.collect();
    expect(d.wsMB).toBeNull();
    expect(DiscordMemory.buildReport(d)).toMatch(/Could not measure: Discord is not loaded/);
  });
});

describe('buildReport', () => {
  it('lists the biggest measured part first and the choices after', async () => {
    const text = DiscordMemory.buildReport(await DiscordMemory.collect());
    const lines = text.split('\n');
    const parts = lines.filter(l => /^ {2}[\d.]+ (MB|GB) - /.test(l));
    expect(parts[0]).toMatch(/Everything else in the process/);     // 1500 - 400 = 1100 MB
    expect(parts[1]).toMatch(/300 MB - JavaScript objects in use/);
    expect(text).toMatch(/Heavy Vencord plugins are on: MessageLoggerEnhanced/);
    expect(text).toMatch(/Kept awake: yes \(always\)/);
    expect(text).toMatch(/Background throttling is off/);
    expect(text).toMatch(/always visible/);
    expect(text).toMatch(/Lighter Discord is on/);
    expect(text).toMatch(/uBlock/);
    expect(text).toMatch(/52,000 elements \(a lot/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('explains why no notice came', async () => {
    sb.activePanel = 'discord';
    DiscordMemory._quietUntil = Date.now() + 3600000;
    DiscordMemory._toldMB = 1100;
    localStorage.setItem('vex.discordMemoryLimitMB', '2000');
    const text = DiscordMemory.buildReport(await DiscordMemory.collect());
    expect(text).toMatch(/Limit 2 GB|Limit 1\.95 GB/);
    expect(text).toMatch(/would wait because: Discord is open/);
    expect(text).toMatch(/Later \/ Not now/);
    expect(text).toMatch(/asks again only after another 512 MB/);
  });
});

describe('showWhyBig', () => {
  it('shows the text with a Copy button and nothing else changes', async () => {
    document.body.innerHTML = '';
    globalThis.VexSettingsGroups = require('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
    const text = await DiscordMemory.showWhyBig();
    const card = document.getElementById('vex-discord-why-big');
    expect(card.textContent).toContain('Why is Discord big?');
    expect(card.querySelector('pre').textContent).toBe(text);
    expect([...card.querySelectorAll('button')].some(b => b.textContent === 'Copy')).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});
