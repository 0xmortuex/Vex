// @vitest-environment jsdom
//
// T2-015: a link to a site that has a panel opens in the panel, never from a
// pop-up, a Ctrl+click, another container or the site itself, and the person's
// rules win.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { LinkRouting } = require('../../src/renderer/js/link-routing.js');

let loaded, shown, created;

beforeEach(() => {
  localStorage.clear();
  loaded = []; shown = []; created = [];
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  const wv = { getURL: () => 'https://claude.ai/', loadURL: vi.fn(async (u) => { loaded.push(u); }) };
  globalThis.SidebarManager = {
    panelConfigs: {
      claude: { url: 'https://claude.ai/' }, discord: { url: 'https://discord.com/app' }, settings: { url: null },
      gh: { url: 'https://github.com/' },
    },
    panelWebviews: { claude: wv, discord: wv, gh: wv },
    isWebPanel: (n) => n !== 'settings',
    panelLabel: (n) => ({ claude: 'Claude', discord: 'Discord', gh: 'GitHub' }[n] || n),
    showPanel: (n) => shown.push(n),
  };
  globalThis.TabManager = { createTab: (u) => { created.push(u); } };
  delete globalThis.VexAttention;
  delete globalThis.VexLedger;
  LinkRouting._wired = false;
});

const flush = () => new Promise(r => setTimeout(r, 10));

describe('deciding', () => {
  it('is off until turned on', () => {
    expect(LinkRouting.intercept('https://claude.ai/chat/1', null)).toBe(false);
  });
  it('routes a link to the panel whose address has that host (www. ignored)', async () => {
    LinkRouting.setEnabled(true);
    expect(LinkRouting.intercept('https://www.claude.ai/chat/1', { url: 'https://news.com/', partition: 'persist:main' })).toBe(true);
    await flush();
    expect(shown).toEqual(['claude']);
    expect(loaded).toEqual(['https://www.claude.ai/chat/1']);
    expect(created).toEqual([]);
  });
  it('does not route a subdomain by itself, or a site with no panel', () => {
    LinkRouting.setEnabled(true);
    expect(LinkRouting.intercept('https://support.discord.com/x', null)).toBe(false);
    expect(LinkRouting.intercept('https://example.com/', null)).toBe(false);
  });
  it('leaves pop-ups, Ctrl+click, other containers and the same site alone', () => {
    LinkRouting.setEnabled(true);
    expect(LinkRouting.intercept('https://claude.ai/', null, { disposition: 'new-window' })).toBe(false);
    expect(LinkRouting.intercept('https://claude.ai/', null, { disposition: 'background-tab' })).toBe(false);
    expect(LinkRouting.intercept('https://claude.ai/', { url: 'https://x.com', partition: 'persist:container-work' })).toBe(false);
    expect(LinkRouting.intercept('https://claude.ai/b', { url: 'https://claude.ai/a', partition: 'persist:main' })).toBe(false);
    expect(LinkRouting.intercept('https://claude.ai/', null, { disposition: 'foreground-tab' })).toBe(true);
  });
});

describe('rules', () => {
  beforeEach(() => LinkRouting.setEnabled(true));
  it('a rule sends a site to a panel, including its subdomains', () => {
    LinkRouting.setRule('https://www.github.com/x', { mode: 'panel', panel: 'gh' });
    expect(LinkRouting.decide('https://gist.github.com/a')).toMatchObject({ panel: 'gh' });
  });
  it('"always a tab" beats the panel that would match', () => {
    LinkRouting.setRule('claude.ai', { mode: 'tab' });
    expect(LinkRouting.intercept('https://claude.ai/', null)).toBe(false);
  });
  it('the most specific rule wins', () => {
    LinkRouting.setRule('github.com', { mode: 'panel', panel: 'gh' });
    LinkRouting.setRule('gist.github.com', { mode: 'tab' });
    expect(LinkRouting.decide('https://gist.github.com/a')).toBe(null);
    expect(LinkRouting.decide('https://github.com/a')).toMatchObject({ panel: 'gh' });
  });
  it('refuses nonsense and unknown panels, and removes a rule', () => {
    expect(() => LinkRouting.setRule('not a site', { mode: 'tab' })).toThrow(/site/);
    expect(() => LinkRouting.setRule('a.com', { mode: 'panel', panel: 'nope' })).toThrow(/not there/);
    expect(() => LinkRouting.setRule('a.com', { mode: 'x' })).toThrow(/panel or as a tab/);
    LinkRouting.setRule('a.com', { mode: 'tab' });
    expect(LinkRouting.removeRule('a.com')).toBe(true);
    expect(LinkRouting.removeRule('a.com')).toBe(false);
  });
  it('raises a damaged rule list', () => {
    localStorage.setItem('vex.linkRouting.rules', '{x');
    expect(() => LinkRouting.rules()).toThrow(/could not be read/);
  });
});

describe('when the panel cannot take it', () => {
  it('says so and opens a tab instead of dropping the link', async () => {
    LinkRouting.setEnabled(true);
    SidebarManager.panelWebviews.claude = null;
    LinkRouting.WAIT_PANEL_MS = 30;
    expect(LinkRouting.intercept('https://claude.ai/x', null)).toBe(true);
    await new Promise(r => setTimeout(r, 200));
    expect(created).toEqual(['https://claude.ai/x']);
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(window.showToast.mock.calls[0][1]).toBe('error');
  });
});

describe('telling the person why', () => {
  it('toasts with two ways out for the first 10 routes only', async () => {
    LinkRouting.setEnabled(true);
    for (let i = 0; i < 12; i++) { LinkRouting.intercept('https://claude.ai/' + i, null); await flush(); }
    expect(window.showToast).toHaveBeenCalledTimes(10);
    const opts = window.showToast.mock.calls[0][3];
    expect(opts.actions.map(a => a.label)).toEqual(['Open as a tab instead', 'Always a tab for claude.ai']);
    opts.actions[1].run();
    expect(LinkRouting.decide('https://claude.ai/')).toBe(null);
    expect(created).toHaveLength(1);
  });
  it('records each route in the ledger with an undo', async () => {
    const record = vi.fn();
    globalThis.VexLedger = { record };
    LinkRouting.setEnabled(true);
    LinkRouting.intercept('https://claude.ai/x', null);
    await flush();
    expect(record.mock.calls[0][0]).toMatchObject({ feature: 'link-routing', undo: { kind: 'link-routing-tab', url: 'https://claude.ai/x' } });
  });
});
