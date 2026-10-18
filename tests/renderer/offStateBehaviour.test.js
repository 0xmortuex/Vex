// @vitest-environment jsdom
//
// Behaviour fixes from the feature audit: a switched-off feature stays off (no learning, no reading, no false
// all-clear), a button never switches a feature on behind the person's back, and a switch shows the person's own choice.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const read = (rel) => fs.readFileSync(path.join(JS, rel), 'utf8');

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
});

describe('Command shortcut words', () => {
  it('learn nothing while the feature is off', () => {
    const { VexAliases } = fresh('command-aliases.js');
    const cmds = [{ id: 'bookmark', label: 'Bookmark This Page' }, { id: 'bookmarks', label: 'Bookmarks' }];
    const item = cmds[0];
    VexAliases.savePrefs({ enabled: false });
    for (let i = 0; i < 6; i++) expect(VexAliases.learn('bm', item, cmds, 2)).toBeNull();
    expect(VexAliases.all().aliases).toEqual({});
    expect(VexAliases.all().typed).toEqual({});
  });
  it('still learn when it is on', () => {
    const { VexAliases } = fresh('command-aliases.js');
    VexAliases.savePrefs({ enabled: true, learn: true });
    const cmds = [{ id: 'bookmark', label: 'Bookmark This Page' }, { id: 'bookmarks', label: 'Bookmarks' }];
    for (let i = 0; i < 6; i++) VexAliases.learn('bm', cmds[0], cmds, 2);
    expect(Object.keys(VexAliases.all().typed)).toContain('bm');
  });
});

describe('Reopen closed window', () => {
  it('says the switch is off instead of "no closed window to bring back"', async () => {
    const { VexWindowSet } = fresh('links-windows.js');
    window.vex = { windowsReopenClosed: vi.fn(async () => ({ ok: false, reason: 'No closed window to bring back' })) };
    VexWindowSet.setEnabled(false);
    await expect(VexWindowSet.reopenClosed()).rejects.toThrow(/Remember my windows.*Settings > Links and windows/);
    expect(window.vex.windowsReopenClosed).not.toHaveBeenCalled();
    VexWindowSet.setEnabled(true);
    await expect(VexWindowSet.reopenClosed()).rejects.toThrow(/No closed window/);
  });
});

describe('Form assistant', () => {
  it('never reads a private, Tor or routed tab', async () => {
    const { VexFormAssist } = fresh('form-assist.js');
    const wv = { getURL: () => 'https://example.com/signup', executeJavaScript: vi.fn() };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map() };
    globalThis.TabManager = { activeTabId: 't1' };
    globalThis.VexTabPolicy = { canReadWebview: vi.fn(() => false) };
    localStorage.setItem(VexFormAssist.ENABLED_KEY, 'true');
    await expect(VexFormAssist.open()).rejects.toThrow(/private, Tor or routed tab is never read/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    delete globalThis.VexTabPolicy;
  });
});

describe('Developer loop buttons', () => {
  it('Check now and Scan now refuse, naming the switch, while GitHub access is off', () => {
    const ui = read('dev-loop-ui.js');
    const guard = "if (typeof GitHubVault !== 'undefined' && !GitHubVault.enabled()) throw new Error('GitHub access is switched off. Turn it on in Settings > GitHub access first.');";
    expect(ui.split(guard).length - 1).toBe(2);
    expect(ui).toMatch(/this\._btn\('Check now', async \(\) => \{ if \(typeof GitHubVault/);
    expect(ui).toMatch(/this\._btn\('Scan now', async \(\) => \{ if \(typeof GitHubVault/);
  });
});

describe('Play room: More mini games', () => {
  it('asks before it switches Offline mini games on, and only then sets the flag', () => {
    const src = read('play-room.js');
    const at = src.indexOf("VexFun.setFlag('games', true)");
    expect(at).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, at - 520), at);
    expect(before).toMatch(/await vexConfirm\(/);
    expect(before).toMatch(/if \(!ok\) return;/);
  });
});

describe('Weekly safety check switch', () => {
  it('shows the person’s own choice, even while Vault hygiene itself is off', () => {
    const { VexVaultHygiene: V } = fresh('vault-hygiene.js');
    localStorage.setItem(V.KEY, 'off');
    expect(V.enabled()).toBe(false);
    expect(V.rollupPreference()).toBe(true);        // the switch row ticks as the person left it
    expect(V.rollupEnabled()).toBe(false);          // but nothing runs while the master is off
    V.setRollupEnabled(false);
    expect(V.rollupPreference()).toBe(false);
    V.setRollupEnabled(true);
    expect(V.rollupPreference()).toBe(true);
    expect(read('security-helpers.js')).toContain('VexVaultHygiene.rollupPreference()');
  });
});

describe('Knowledge base search and related', () => {
  it('say the index is off rather than "nothing matches"', () => {
    const src = read('knowledge.js');
    expect(src.split('The knowledge base index is switched off').length - 1).toBe(2);
  });
});

describe('Keep Vex on top', () => {
  it('refuses, naming the master switch, instead of saying Vex stays on top while the master is off', () => {
    const src = read('tabs-nav.js');
    const at = src.indexOf("setPref('keepOnTop', !!value);");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, at - 420), at)).toMatch(/if \(value && !enabled\(\)\) throw new Error\('Turn on "Tabs and navigation extras"/);
  });
});

describe('Holidays and phrases from packs', () => {
  it('names the master switch when that, not the pack, is what is off', () => {
    const src = read('pack-content.js');
    const msg = 'Holidays and phrases from packs are switched off. Turn on';
    expect(src.split(msg).length - 1).toBe(2);
    // The master-switch check comes before the "no pack is switched on" message in both screens.
    expect(src.indexOf(msg)).toBeLessThan(src.indexOf('No phrase pack is switched on'));
    expect(src.lastIndexOf(msg)).toBeLessThan(src.indexOf('No holiday pack is switched on'));
  });
});
