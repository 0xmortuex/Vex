// @vitest-environment jsdom
//
// Vex had four things that would put a tab or a panel to sleep on their own:
// the idle panel timer, the idle tab timer, Discord's memory watch, and gaming
// mode — which sleeps every background tab and every hidden panel the moment a
// game starts, and is on unless you turn it off. Alt-tab into a game, come
// back, and the page you were reading has reloaded.
//
// One setting governs all of them now, and its default is to ask.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SleepConsent } = require('../../src/renderer/js/sleep-consent.js');
globalThis.SleepConsent = SleepConsent;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  SleepConsent._quiet = {};
  SleepConsent._offered = false;
  window.showToast = vi.fn();
});

const press = (label) => {
  const bar = document.getElementById('vex-sleep-ask');
  const b = [...bar.querySelectorAll('button')].find(x => x.textContent === label);
  if (!b) throw new Error('no button "' + label + '" — has: ' + [...bar.querySelectorAll('button')].map(x => x.textContent));
  b.click();
};

describe('the setting', () => {
  // Asking was not enough: six unattended sleepers, and the last two found
  // were the ones doing the damage. Nothing sleeps by itself now unless the
  // user turns it back on.
  it('never sleeps anything unless it is told to', () => {
    expect(SleepConsent.mode()).toBe('never');
    expect(SleepConsent.auto()).toBe(false);
    expect(SleepConsent.never()).toBe(true);
    localStorage.setItem('vex.sleepConsent', 'nonsense');
    expect(SleepConsent.mode()).toBe('never');
    expect(SleepConsent.set('auto')).toBe('auto');
    expect(SleepConsent.auto()).toBe(true);
    expect(() => SleepConsent.set('sideways')).toThrow(/ask, do it automatically, or never/);
  });
});

describe('asking', () => {
  beforeEach(() => SleepConsent.set('ask'));
  const ask = (run, over = {}) => SleepConsent.ask({ id: 'panels', title: 'Two panels have been idle. Let them sleep?', run, ...over });

  it('does nothing until it is answered', () => {
    const run = vi.fn();
    expect(ask(run)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(document.getElementById('vex-sleep-ask')).not.toBeNull();
  });

  it('yes does it', () => {
    const run = vi.fn();
    ask(run);
    press('Let them sleep');
    expect(run).toHaveBeenCalled();
    expect(document.getElementById('vex-sleep-ask')).toBe(null);
  });

  // The complaint in one line: asked, and done anyway.
  it('"Not now" does nothing, and is not asked again for hours', () => {
    const run = vi.fn();
    ask(run);
    press('Not now');
    expect(run).not.toHaveBeenCalled();
    expect(ask(run)).toBe(false);
    SleepConsent._quiet.panels = Date.now() - 1;
    expect(ask(run)).toBe(true);
  });

  it('ignoring it is a no', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    ask(run);
    vi.advanceTimersByTime(SleepConsent.GONE_MS + 100);
    expect(document.getElementById('vex-sleep-ask')).toBe(null);
    expect(run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('one question at a time', () => {
    ask(vi.fn());
    expect(ask(vi.fn())).toBe(false);
    expect(document.querySelectorAll('#vex-sleep-ask')).toHaveLength(1);
  });

  // One click on a tabs notice used to switch every sleeper to automatic.
  it('"Always" does it and stops asking — about that kind only', () => {
    const run = vi.fn();
    ask(run);
    press('Always');
    expect(SleepConsent.mode()).toBe('ask');
    expect(SleepConsent.always()).toEqual(['panels']);
    expect(run).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    expect(ask(later)).toBe(true);
    expect(later).toHaveBeenCalled();          // no question, just done
    expect(document.getElementById('vex-sleep-ask')).toBe(null);
    const tabs = vi.fn();
    expect(SleepConsent.gate({ id: 'tabs', title: 'Tabs?', run: tabs })).toBe(true);
    expect(tabs).not.toHaveBeenCalled();       // tabs still ask
  });

  it('"never" beats an earlier "Always"', () => {
    SleepConsent.allowKind('tabs');
    SleepConsent.set('never');
    const run = vi.fn();
    expect(SleepConsent.gate({ id: 'tabs', title: 'Tabs?', run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('a sleeper that cannot ask does nothing under "ask"', () => {
    const run = vi.fn();
    expect(SleepConsent.gate({ id: 'discard', title: 'x', canAsk: false, run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(document.getElementById('vex-sleep-ask')).toBe(null);
  });

  it('"never" means never, with no question either', () => {
    SleepConsent.set('never');
    const run = vi.fn();
    expect(ask(run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(document.getElementById('vex-sleep-ask')).toBe(null);
  });

  it('refuses to ask about nothing', () => {
    expect(() => SleepConsent.ask({ id: 'x', title: 'hm' })).toThrow(/nothing to do/);
  });
});

// A game is the one moment a question cannot be answered: the screen is not
// Vex's. So it is asked afterwards, when somebody is there.
describe('after a game', () => {
  beforeEach(() => SleepConsent.set('ask'));

  it('offers once, and only while Vex is set to ask', () => {
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(true);
    expect(document.getElementById('vex-sleep-ask').textContent).toMatch(/Helldivers/);
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(false);   // once
    SleepConsent._offered = false;
    document.getElementById('vex-sleep-ask').remove();
    SleepConsent.set('auto');
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(false);   // nothing to offer
  });

  // "Do that next time" used to run a no-op: a yes that did nothing.
  it('"Do that next time" makes gaming mode sleep by itself — and nothing else', () => {
    SleepConsent.offerAfterGame('a game');
    const labels = [...document.querySelectorAll('#vex-sleep-ask button')].map(b => b.textContent);
    expect(labels).toEqual(['Do that next time', 'Not now']);
    press('Do that next time');
    expect(SleepConsent.mode()).toBe('ask');
    expect(SleepConsent.modeFor('gaming')).toBe('auto');
    expect(SleepConsent.modeFor('tabs')).toBe('ask');
    SleepConsent._offered = false;
    expect(SleepConsent.offerAfterGame('a game')).toBe(false);   // nothing left to offer
  });
});

// The two found last, and the reason the default changed: the memory ceiling
// sweep, and the one that fired three minutes after the Vex window went
// behind another app — which is what "apps like discord and claude keep
// closing when I switch" actually was.
describe('the ones that fired while you were elsewhere', () => {
  const { TabManager } = require('../../src/renderer/js/tabs.js');

  beforeEach(() => {
    TabManager.tabs = [
      { id: 'a', title: 'Claude', url: 'https://claude.ai/', lastViewedAt: 0 },
      { id: 'b', title: 'Discord', url: 'https://discord.com/', lastViewedAt: 0 },
    ];
    TabManager.activeTabId = 'a';
    TabManager.sleepTab = vi.fn();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });

  it('idle discard sleeps nothing while Vex is set to never', () => {
    TabManager._discardIdleTabs();
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
  });

  it('and does its old job once the user asks for it back', () => {
    SleepConsent.set('auto');
    TabManager._discardIdleTabs();
    expect(TabManager.sleepTab).toHaveBeenCalledWith('b');
  });

  it('the memory ceiling sweep is the same: it says something, it does not close things', async () => {
    TabManager._memCeiling = 100;
    TabManager._guardNoteAt = 0;
    globalThis.WebviewManager = { webviews: new Map() };
    window.vex = { tabMemory: vi.fn(async () => ({ totalKB: 900 * 1024, byId: {} })) };
    const notes = [];
    const hear = (e) => notes.push(e.detail.note);
    document.addEventListener('vex:memory-event', hear);
    await TabManager._memorySweep();
    document.removeEventListener('vex:memory-event', hear);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
    expect(notes.join(' ')).toMatch(/nothing slept: Vex is set never to sleep anything by itself/);
  });

  it('auto-sleep, the one idle timer for tabs, sleeps nothing under "never" and does under "just do it"', () => {
    vi.useFakeTimers();
    TabManager._inSplitPane = () => false;
    TabManager.tabs[1].lastViewedAt = Date.now() - 60 * 60000;
    TabManager.startAutoSleep(10, true);
    vi.advanceTimersByTime(30000);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
    SleepConsent.set('auto');
    vi.advanceTimersByTime(30000);
    expect(TabManager.sleepTab).toHaveBeenCalledWith('b');
    TabManager.stopAutoSleep();
    vi.useRealTimers();
  });
});

describe('a choice saved before "never" became the default', () => {
  it('"auto" from an old notice goes back to never, once', () => {
    localStorage.setItem('vex.sleepConsent', 'auto');
    expect(SleepConsent.resetOnce()).toBe(true);
    expect(SleepConsent.mode()).toBe('never');
    expect(SleepConsent.auto()).toBe(false);
  });

  it('"ask" goes back to never too: a notice about closing things is still the feature', () => {
    localStorage.setItem('vex.sleepConsent', 'ask');
    SleepConsent.resetOnce();
    expect(SleepConsent.mode()).toBe('never');
  });

  it("Discord's own saved \"auto\" goes too", () => {
    localStorage.setItem('vex.discordMemoryConsent', 'auto');
    expect(SleepConsent.resetOnce()).toBe(true);
    expect(localStorage.getItem('vex.discordMemoryConsent')).toBe(null);
  });

  it('runs once: turning it back on afterwards is kept', () => {
    localStorage.setItem('vex.sleepConsent', 'auto');
    SleepConsent.resetOnce();
    SleepConsent.set('auto');
    expect(SleepConsent.resetOnce()).toBe(false);
    expect(SleepConsent.mode()).toBe('auto');
  });

  it('says nothing when there was nothing to change', () => {
    expect(SleepConsent.resetOnce()).toBe(false);
    expect(SleepConsent.mode()).toBe('never');
  });
});

// The owner's bug (2026-10-07): "never do it", and tabs still went blank —
// a hidden 30-minute hibernation in webview.js never asked, and Discord had a
// consent key of its own that beat this one. Both go, once.
describe('one sleep model', () => {
  it('removes the old Discord answer and the hibernation minutes, once', () => {
    localStorage.setItem('vex.discordMemoryConsent', 'ask');
    localStorage.setItem('vex.tabHibernateMinutes', '30');
    expect(SleepConsent.migrateOnce()).toBe(true);
    expect(localStorage.getItem('vex.discordMemoryConsent')).toBe(null);
    expect(localStorage.getItem('vex.tabHibernateMinutes')).toBe(null);
    localStorage.setItem('vex.tabHibernateMinutes', '5');
    expect(SleepConsent.migrateOnce()).toBe(false);          // once
  });

  it('the hidden tab hibernation is gone from webview.js', () => {
    const { WebviewManager } = require('../../src/renderer/js/webview.js');
    expect(WebviewManager._hibernateSweep).toBeUndefined();
    expect(WebviewManager._hibernateMinutes).toBeUndefined();
    // Waking a tab blanked before the update, and the system-resume recovery, stay.
    expect(typeof WebviewManager._wake).toBe('function');
    expect(typeof WebviewManager._recoverBlankWebviews).toBe('function');
  });

  it('under "never" the rows that wait for it are greyed out, with a line why', () => {
    document.body.innerHTML = '<div id="sleep-consent-note"></div><div data-sleep-dependent><input type="checkbox" id="a"><select id="b"></select></div><input id="c" disabled>';
    SleepConsent.renderSettingsState();
    expect(document.getElementById('a').disabled).toBe(true);
    expect(document.getElementById('b').disabled).toBe(true);
    expect(document.getElementById('sleep-consent-note').textContent).toMatch(/never sleeps, blanks or refreshes/);
    SleepConsent.set('ask');                                    // redraws through the event
    expect(document.getElementById('a').disabled).toBe(false);
    expect(document.getElementById('c').disabled).toBe(true);   // not ours to enable
    SleepConsent.allowKind('discord');
    expect(document.getElementById('sleep-consent-note').textContent).toMatch(/Without asking.*Discord/);
    document.querySelector('#sleep-consent-note button').click();
    expect(SleepConsent.always()).toEqual([]);
  });
});
