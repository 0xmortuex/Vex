// @vitest-environment jsdom
//
// "Why am I here": a tab's one-line reason in its tooltip, asked about again
// after a week, and never kept for a private or Tor tab.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { VexTabReason } = require('../../src/renderer/js/tab-reason.js');

const DAY = 86400000;
const tab = (over = {}) => ({ id: 'tab-1', url: 'https://shop.test/', title: 'Kettle', partition: 'persist:main', note: 'compare with the other one', ...over });

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  delete window.VexTabPolicy;
  delete globalThis.TabManager;
});

describe('which tabs may keep a reason', () => {
  it('an ordinary tab and a container tab do; private, off-the-record and Tor tabs do not', () => {
    expect(VexTabReason.capturable(tab())).toBe(true);
    expect(VexTabReason.capturable(tab({ partition: null }))).toBe(true);
    expect(VexTabReason.capturable(tab({ partition: 'otr-123' }))).toBe(false);
    expect(VexTabReason.capturable(tab({ partition: 'tor-abc' }))).toBe(false);
    expect(VexTabReason.capturable(null)).toBe(false);
  });

  it('a routed tab and a private window do not either', () => {
    window.VexTabPolicy = { isPrivateWindow: false, isRouted: (p) => p === 'persist:route-1' };
    expect(VexTabReason.capturable(tab({ partition: 'persist:route-1' }))).toBe(false);
    expect(VexTabReason.capturable(tab())).toBe(true);
    window.VexTabPolicy = { isPrivateWindow: true, isRouted: () => false };
    expect(VexTabReason.capturable(tab())).toBe(false);
  });
});

describe('the tooltip', () => {
  it('adds the reason, and nothing for a tab that may not keep one', () => {
    expect(VexTabReason.tooltip(tab())).toBe('Why: compare with the other one');
    expect(VexTabReason.tooltip(tab({ note: '' }))).toBe('');
    expect(VexTabReason.tooltip(tab({ partition: 'tor-1' }))).toBe('');
  });

  it('is the tab strip’s own tooltip', async () => {
    window.VexDataContracts = require('../../src/renderer/js/data-contracts.js');
    require('../../src/renderer/js/tab-policy.js');
    globalThis.VexStorage = { loadTabs: vi.fn(async () => []), saveTabs: vi.fn(async () => true), loadGroups: vi.fn(async () => []), saveGroups: vi.fn(async () => true), loadStacks: vi.fn(async () => []), saveStacks: vi.fn(async () => true) };
    globalThis.WebviewManager = { webviews: new Map() };
    globalThis.VexIcons = { svg: () => '<svg></svg>' };
    window.vex = { getStartPageUrl: () => new Promise(() => {}) };
    document.body.innerHTML = '<div id="tabs-list"></div>';
    vi.resetModules();
    await import('../../src/renderer/js/vex-utils.js');
    const { TabManager } = await import('../../src/renderer/js/tabs.js');
    globalThis.VexTabReason = VexTabReason;
    const el = document.createElement('div');
    TabManager._markSession(el, tab());
    expect(el.title).toBe('Kettle — Why: compare with the other one');
    TabManager._markSession(el, tab({ note: '' }));
    expect(el.title).toBe('Kettle');
    delete globalThis.VexTabReason;
  });
});

describe('coming back after a week', () => {
  const t0 = Date.UTC(2026, 9, 1);

  it('the first time a reason is seen it only starts the clock', () => {
    expect(VexTabReason.touch(tab(), t0)).toBeNull();
    expect(VexTabReason.all()['tab-1']).toMatchObject({ text: 'compare with the other one', at: t0, seen: t0 });
  });

  it('asks after 7 days away, with the reason and how long', () => {
    VexTabReason.touch(tab(), t0);
    expect(VexTabReason.touch(tab(), t0 + 6 * DAY)).toBeNull();           // 6 days: not yet; seen moves on
    const due = VexTabReason.touch(tab(), t0 + 6 * DAY + 7 * DAY);
    expect(due).toMatchObject({ text: 'compare with the other one', days: 7 });
  });

  it('measures from the last time the tab was in front, not from when the reason was written', () => {
    VexTabReason.touch(tab(), t0);
    for (let d = 1; d <= 20; d++) expect(VexTabReason.touch(tab(), t0 + d * DAY)).toBeNull();
  });

  it('a new reason starts counting again', () => {
    VexTabReason.touch(tab(), t0);
    expect(VexTabReason.touch(tab({ note: 'waiting on the quote' }), t0 + 30 * DAY)).toBeNull();
  });

  it('the number of days is the user’s, 3 to 30, and it can be switched off', () => {
    VexTabReason.savePrefs({ days: 3 });
    VexTabReason.touch(tab(), t0);
    expect(VexTabReason.touch(tab(), t0 + 3 * DAY)).toMatchObject({ days: 3 });
    VexTabReason.savePrefs({ days: 99 });
    expect(VexTabReason.prefs().days).toBe(30);
    VexTabReason.savePrefs({ revisit: false });
    expect(VexTabReason.touch(tab(), t0 + 90 * DAY)).toBeNull();
  });

  it('keeps nothing for a private tab, and drops the record when the reason is cleared', () => {
    expect(VexTabReason.touch(tab({ partition: 'tor-1' }), t0)).toBeNull();
    expect(VexTabReason.all()).toEqual({});
    VexTabReason.touch(tab(), t0);
    VexTabReason.touch(tab({ note: '' }), t0 + DAY);
    expect(VexTabReason.all()).toEqual({});
  });

  it('forgets a closed tab and says when the record cannot be read', () => {
    VexTabReason.touch(tab(), t0);
    expect(VexTabReason.forget('tab-1')).toBe(true);
    expect(VexTabReason.forget('tab-1')).toBe(false);
    localStorage.setItem('vex.tabReasons', '{nope');
    expect(() => VexTabReason.all()).toThrow(/could not be read/);
  });

  it('the question has three answers: still needed, change it, close the tab', () => {
    const close = vi.fn();
    globalThis.TabManager = { tabs: [tab()], closeTab: close, editTabNote: vi.fn(async () => 'new') };
    VexTabReason.ask({ tab: tab(), text: 'compare with the other one', days: 9 });
    const [msg, , , opts] = window.showToast.mock.calls.at(-1);
    expect(msg).toMatch(/9 days ago for: compare with the other one/);
    expect(opts.actions.map(a => a.label)).toEqual(['Still needed', 'Change the reason', 'Close the tab']);
    opts.actions[2].run();
    expect(close).toHaveBeenCalledWith('tab-1');
  });
});
