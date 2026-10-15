// @vitest-environment jsdom
//
// Focus OS window: shows the day's one line and the ring, proposes only on
// request, books nothing until Confirm, and a goal's title is never markup.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

window.__FOCUS_OS_NO_AUTOINIT__ = true;
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
require('../../src/renderer/js/focus-os-planner.js');
const { FocusOS } = require('../../src/renderer/js/focus-os.js');
const { FocusOSUI } = require('../../src/renderer/js/focus-os-ui.js');

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(19, 8, 30));
  localStorage.clear(); FocusOS._reload(); document.body.innerHTML = '';
  window.showToast = vi.fn();
  for (const k of ['IcsCalendar', 'Calendar', 'ThemeAuto', 'DistractionBudget', 'FocusFlows', 'GameMode']) delete globalThis[k];
  delete window.vex;
});
afterEach(() => { FocusOSUI.close(); vi.useRealTimers(); });

describe('the window', () => {
  it('opens with an empty-day line and an invitation, not a nag', () => {
    FocusOSUI.open();
    const t = document.getElementById('vex-focusos').textContent;
    expect(t).toContain('No blocks today');
    expect(t).toContain('nothing starts until you say so');
    expect(document.querySelector('#vex-focusos svg circle.fo-ring-fill')).not.toBeNull();
  });

  it('shows a proposal and books nothing until Confirm', async () => {
    const g = FocusOS.addGoal({ title: 'Ship <b>it</b>', deadline: at(23, 18), estimateMin: 100 });
    FocusOSUI.open();
    const plan = [...document.querySelectorAll('#vex-focusos button')].find(b => b.textContent.includes('Plan blocks'));
    plan.click(); await flush(); await flush();
    const text = document.getElementById('vex-focusos').textContent;
    expect(text).toContain('Proposed');
    expect(text).toContain('nothing is booked until you confirm');
    expect(document.querySelector('#vex-focusos b')).toBeNull();                      // the title is text, never markup
    expect(FocusOS.blocks(g.id).every(b => b.state === 'proposed')).toBe(true);
    const ok = [...document.querySelectorAll('#vex-focusos button')].find(b => b.textContent.startsWith('Confirm'));
    ok.click(); await flush(); await flush();
    expect(FocusOS.blocks(g.id).every(b => b.state === 'planned')).toBe(true);
    expect(document.getElementById('vex-focusos').textContent).toContain('0 of 2 blocks done');
  });

  it('starts a block only from its button', async () => {
    const g = FocusOS.addGoal({ title: 'Write', deadline: at(23, 18), estimateMin: 50 });
    await FocusOS.propose(g.id, at(19, 8, 30)); await FocusOS.confirmGoal(g.id);
    FocusOSUI.open();
    expect(FocusOS.active()).toBeNull();
    [...document.querySelectorAll('#vex-focusos button')].find(b => b.textContent.includes('Start')).click();
    await flush(); await flush();
    expect(FocusOS.active()).not.toBeNull();
    expect(document.getElementById('vex-focusos').textContent).toContain('Running until');
  });

  it('removing a goal asks first', async () => {
    FocusOS.addGoal({ title: 'Write', deadline: at(23, 18), estimateMin: 50 });
    window.vexConfirm = vi.fn(async () => false);
    FocusOSUI.open();
    document.querySelector('#vex-focusos button[aria-label="Remove goal"]').click();
    await flush();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(FocusOS.goals().length).toBe(1);
  });

  it('Escape closes it', () => {
    FocusOSUI.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-focusos')).toBeNull();
  });
});

describe('the settings group', () => {
  it('is injected into the settings panel at run time and saves changes', () => {
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"><div class="setting-group"><div id="settings-version"></div></div></div></div>';
    const body = FocusOSUI.mountSettings();
    expect(body).not.toBeNull();
    expect(document.getElementById('settings-focus-os').querySelector('.setting-label').textContent).toMatch(/Focus OS/);
    const len = body.querySelector('input[aria-label="Block length in minutes"]');
    len.value = '35'; len.dispatchEvent(new Event('change'));
    expect(FocusOS.settings().blockMin).toBe(35);
    len.value = '5'; len.dispatchEvent(new Event('change'));
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Block length/), 'error');
    expect(len.value).toBe('35');                                                    // snaps back to what is saved
    expect(FocusOSUI.mountSettings()).toBe(body);                                   // mounted once
  });

  it('does nothing when there is no settings panel', () => {
    expect(FocusOSUI.mountSettings()).toBeNull();
  });
});
