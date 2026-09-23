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
  it('asks unless told otherwise', () => {
    expect(SleepConsent.mode()).toBe('ask');
    expect(SleepConsent.auto()).toBe(false);
    localStorage.setItem('vex.sleepConsent', 'nonsense');
    expect(SleepConsent.mode()).toBe('ask');
    expect(SleepConsent.set('auto')).toBe('auto');
    expect(SleepConsent.auto()).toBe(true);
    expect(() => SleepConsent.set('sideways')).toThrow(/ask, do it automatically, or never/);
  });
});

describe('asking', () => {
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

  it('"Always" does it and stops asking', () => {
    const run = vi.fn();
    ask(run);
    press('Always');
    expect(SleepConsent.mode()).toBe('auto');
    expect(run).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    expect(ask(later)).toBe(true);
    expect(later).toHaveBeenCalled();          // no question, just done
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
  it('offers once, and only while Vex is set to ask', () => {
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(true);
    expect(document.getElementById('vex-sleep-ask').textContent).toMatch(/Helldivers/);
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(false);   // once
    SleepConsent._offered = false;
    document.getElementById('vex-sleep-ask').remove();
    SleepConsent.set('auto');
    expect(SleepConsent.offerAfterGame('Helldivers')).toBe(false);   // nothing to offer
  });

  it('changes nothing on its own — only "Always" does', () => {
    SleepConsent.offerAfterGame('a game');
    press('Do that next time');
    expect(SleepConsent.mode()).toBe('ask');
    SleepConsent._offered = false;
    SleepConsent.offerAfterGame('a game');
    press('Always');
    expect(SleepConsent.mode()).toBe('auto');
  });
});
