// @vitest-environment jsdom
//
// Memory rows show measured numbers only (MemoryPanel.describe): a live tab's
// process memory, 0 MB for a sleeping tab (it has no process) with what it used
// just before it slept, and never the old fixed 80/150 MB guesses.

import { describe, it, expect } from 'vitest';

globalThis.window.escapeHtml = (s) => String(s);
const { MemoryPanel } = require('../../src/renderer/js/memory-panel.js');

describe('MemoryPanel.describe', () => {
  it('a live tab shows its measured process memory', () => {
    expect(MemoryPanel.describe({}, { memKB: 312 * 1024, pid: 7 }, 1)).toEqual({ mb: 312, sleeping: false, label: '312 MB' });
  });

  it('says when a process is shared by several tabs', () => {
    expect(MemoryPanel.describe({}, { memKB: 200 * 1024, pid: 7 }, 3).label).toBe('200 MB · shared by 3 tabs');
  });

  it('a sleeping tab uses 0 MB and shows what it used before sleeping', () => {
    const tab = { sleeping: true, memBeforeSleep: { mb: 219, shared: false } };
    expect(MemoryPanel.describe(tab, null, 0)).toEqual({ mb: 0, sleeping: true, label: '0 MB · asleep (was 219 MB)' });
    expect(MemoryPanel.describe({ sleeping: true, memBeforeSleep: { mb: 90, shared: true } }, null, 0).label).toBe('0 MB · asleep (was 90 MB, shared)');
  });

  it('a sleeping tab that was never measured still gives its real number', () => {
    expect(MemoryPanel.describe({ sleeping: true }, null, 0).label).toBe('0 MB · asleep');
  });

  it('a restored tab never opened uses nothing', () => {
    expect(MemoryPanel.describe({ _lazy: true }, null, 0)).toEqual({ mb: 0, sleeping: true, label: '0 MB · not loaded yet' });
  });

  it('a live tab without a measurement says so instead of guessing', () => {
    expect(MemoryPanel.describe({}, null, 0)).toEqual({ mb: null, sleeping: false, label: 'starting…' });
  });
});

describe('MemoryPanel.shareCounts', () => {
  it('counts the tabs on each process', () => {
    expect(MemoryPanel.shareCounts({ 1: { pid: 10 }, 2: { pid: 10 }, 3: { pid: 11 } })).toEqual({ 10: 2, 11: 1 });
  });
});
