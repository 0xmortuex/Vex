// @vitest-environment jsdom
//
// When Vex tells Game Control Center which tab was busy (js/tab-cost.js,
// TabCostLink). The decision is pure: at most a line a minute, nothing without
// a measurement, every minute while gaming, otherwise only for a site that
// averages at least the "notable" bar; and the timer is silent when the
// switch is off.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TabCostLink, tabCostLinkDecision, tabCostLinkPayload, TAB_COST_LINK_GAP_MS } = require('../../src/renderer/js/tab-cost.js');

const ev = (over = {}) => ({
  cpuMeasured: true, spanMs: 120000, windowMs: 300000, totalCpuSec: 10, verdict: 'ok',
  top: [{ kind: 'site', name: 'a.example.com', cpuPct: 3, cpuShare: 0.5, memMB: 100, tabs: 1 }],
  ...over,
});

describe('tabCostLinkDecision', () => {
  const now = 1_000_000;
  it('is silent on a quiet day', () => {
    expect(tabCostLinkDecision({ event: ev(), gaming: false, now, lastWrittenAt: 0 })).toEqual({ write: false, reason: 'quiet' });
  });
  it('writes while gaming, even when quiet', () => {
    expect(tabCostLinkDecision({ event: ev(), gaming: true, now, lastWrittenAt: 0 })).toEqual({ write: true, reason: 'gaming' });
  });
  it('writes when a site averages at least the notable bar, and not just under it', () => {
    const at = (p) => tabCostLinkDecision({ event: ev({ top: [{ kind: 'site', name: 'a.example.com', cpuPct: p, cpuShare: 0.5, memMB: 1, tabs: 1 }] }), gaming: false, now, lastWrittenAt: 0 });
    expect(at(8).write).toBe(true);
    expect(at(7.9).write).toBe(false);
  });
  it('a busy panel or Vex itself is not a browser tab', () => {
    const top = [{ kind: 'system', name: 'Vex itself', cpuPct: 60, cpuShare: 0.9, memMB: 1, tabs: 0 }, { kind: 'private', cpuPct: 40, cpuShare: 0.5, memMB: 1, tabs: 0 }];
    expect(tabCostLinkDecision({ event: ev({ top }), gaming: false, now, lastWrittenAt: 0 }).write).toBe(false);
  });
  it('never more than one a minute, not even while gaming', () => {
    expect(tabCostLinkDecision({ event: ev(), gaming: true, now, lastWrittenAt: now - 30000 })).toEqual({ write: false, reason: 'too-soon' });
    expect(tabCostLinkDecision({ event: ev(), gaming: true, now, lastWrittenAt: now - TAB_COST_LINK_GAP_MS }).write).toBe(true);
  });
  it('writes nothing without a measurement', () => {
    expect(tabCostLinkDecision({ event: ev({ cpuMeasured: false }), gaming: true, now, lastWrittenAt: 0 }).reason).toBe('no-measurement');
    expect(tabCostLinkDecision({ event: ev({ spanMs: 4000 }), gaming: true, now, lastWrittenAt: 0 }).reason).toBe('no-measurement');
  });
});

describe('tabCostLinkPayload', () => {
  it('keeps five rows and drops names and tab counts from anonymous rows', () => {
    const top = Array.from({ length: 8 }, (_, i) => ({ kind: 'site', name: 's' + i + '.test', cpuPct: 10 - i, cpuShare: 0.1, memMB: 1, tabs: 1, cpuSec: 1, netBytes: 5 }));
    top[0] = { kind: 'private', name: 'leak.test', cpuPct: 50, cpuShare: 0.5, memMB: 1, tabs: 4 };
    top[1] = { kind: 'site', name: '', cpuPct: 20, cpuShare: 0.2, memMB: 1, tabs: 1 };   // a title-only tab
    const p = tabCostLinkPayload({ windowMs: 1, spanMs: 2, totalCpuSec: 3, cpuMeasured: true, verdict: 'ok', top });
    expect(p.top).toHaveLength(5);
    expect(p.top[0]).toEqual({ kind: 'private', cpuPct: 50, cpuShare: 0.5, memMB: 1, tabs: 0 });
    expect(p.top[1].kind).toBe('unknown');
    expect(p.top[1].name).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('leak.test');
    expect(p.top[2]).not.toHaveProperty('netBytes');
  });
});

describe('the timer is off unless switched on', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  it('does not arm anything and asks main for nothing while off', async () => {
    window.vex = { pcbbLinkSet: vi.fn(), pcbbTabCost: vi.fn() };
    await TabCostLink.start();
    TabCostLink._arm();
    expect(TabCostLink._timer).toBeNull();
    expect(window.vex.pcbbLinkSet).not.toHaveBeenCalled();
    expect(window.vex.pcbbTabCost).not.toHaveBeenCalled();
    expect(TabCostLink.enabled()).toBe(false);
  });
  it('tells main the person said yes at start, and arms', async () => {
    localStorage.setItem(TabCostLink.KEY, 'on');
    window.vex = { pcbbLinkSet: vi.fn().mockResolvedValue({ enabled: true }), pcbbTabCost: vi.fn() };
    await TabCostLink.start();
    expect(window.vex.pcbbLinkSet).toHaveBeenCalledWith(true);
    expect(TabCostLink._timer).not.toBeNull();
    clearTimeout(TabCostLink._timer);
    TabCostLink._timer = null;
  });
});
