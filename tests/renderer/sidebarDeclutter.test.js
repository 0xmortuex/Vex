// @vitest-environment jsdom
//
// The one-time declutter nudge: 14 days after install, offer (once) to hide
// app panels that were never opened. Time is injected so the clock is pinned.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.window.Onboarding = Onboarding;
  localStorage.setItem('vex.onboardingDone', 'true');
  globalThis.window.vexConfirm = vi.fn(async () => true);
  globalThis.window.showToast = vi.fn();
  vi.spyOn(SidebarManager, 'applyPanelOverrides').mockImplementation(() => {});
});

describe('maybeOfferDeclutter — eligibility gates', () => {
  it('first eligible call stamps installedAt and stays silent', async () => {
    expect(await SidebarManager.maybeOfferDeclutter({ now: T0 })).toBe(false);
    expect(localStorage.getItem('vex.installedAt')).toBe(String(T0));
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });

  it('stays silent inside the 14-day window', async () => {
    localStorage.setItem('vex.installedAt', String(T0));
    expect(await SidebarManager.maybeOfferDeclutter({ now: T0 + 13 * DAY })).toBe(false);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(localStorage.getItem('vex.declutterDone')).toBeNull(); // still armed
  });

  it('never fires while the onboarding wizard is open (and stays armed)', async () => {
    localStorage.setItem('vex.installedAt', String(T0));
    document.body.innerHTML = '<div id="vex-onboarding"></div>';
    expect(await SidebarManager.maybeOfferDeclutter({ now: T0 + 20 * DAY })).toBe(false);
    expect(localStorage.getItem('vex.declutterDone')).toBeNull();
  });

  it('fires exactly once — declutterDone disarms every later call', async () => {
    localStorage.setItem('vex.installedAt', String(T0));
    await SidebarManager.maybeOfferDeclutter({ now: T0 + 15 * DAY });
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('vex.declutterDone')).toBe('true');
    await SidebarManager.maybeOfferDeclutter({ now: T0 + 16 * DAY });
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('maybeOfferDeclutter — candidates and outcomes', () => {
  const arm = () => localStorage.setItem('vex.installedAt', String(T0));
  const NOW = T0 + 15 * DAY;

  it('recently-used and already-hidden panels are not candidates', async () => {
    arm();
    const usage = {};
    for (const p of Onboarding._APP_PANELS()) usage[p.id] = NOW - DAY; // all recently used…
    delete usage.netflix;                                             // …except two
    delete usage.roblox;
    localStorage.setItem('vex.panelUsage', JSON.stringify(usage));
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ roblox: { hidden: true } }));
    // netflix alone is < 2 candidates → no dialog, but the nudge is spent.
    expect(await SidebarManager.maybeOfferDeclutter({ now: NOW })).toBe(false);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(localStorage.getItem('vex.declutterDone')).toBe('true');
  });

  it('accepting hides exactly the idle panels', async () => {
    arm();
    const usage = {};
    for (const p of Onboarding._APP_PANELS()) usage[p.id] = NOW - DAY;
    delete usage.netflix;
    delete usage.spotify;
    localStorage.setItem('vex.panelUsage', JSON.stringify(usage));

    expect(await SidebarManager.maybeOfferDeclutter({ now: NOW })).toBe(true);
    const msg = window.vexConfirm.mock.calls[0][0];
    expect(msg.message).toContain('Netflix');
    expect(msg.message).toContain('Spotify');
    const ov = JSON.parse(localStorage.getItem('vex.panelOverrides'));
    expect(ov.netflix.hidden).toBe(true);
    expect(ov.spotify.hidden).toBe(true);
    expect(ov.discord).toBeUndefined();       // used panels untouched
    expect(SidebarManager.applyPanelOverrides).toHaveBeenCalled();
  });

  it('declining hides nothing but still disarms', async () => {
    arm();
    window.vexConfirm = vi.fn(async () => false);
    expect(await SidebarManager.maybeOfferDeclutter({ now: NOW })).toBe(false);
    expect(localStorage.getItem('vex.panelOverrides')).toBeNull();
    expect(localStorage.getItem('vex.declutterDone')).toBe('true');
  });
});

describe('showPanel usage tracking', () => {
  it('stamps vex.panelUsage on every open', () => {
    // showPanel touches a lot of DOM; give it the minimum and swallow the rest.
    document.body.innerHTML = '<div id="panels-container"></div><div id="webviews-container"></div>';
    try { SidebarManager.showPanel('notes'); } catch { /* DOM beyond the stamp is incomplete — fine */ }
    const usage = JSON.parse(localStorage.getItem('vex.panelUsage'));
    expect(typeof usage.notes).toBe('number');
  });
});
