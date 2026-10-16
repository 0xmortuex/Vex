// @vitest-environment jsdom
//
// js/net-courtesy.js (T3-035): pause Vex's own downloads during a game, resume exactly those, count the bytes.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexNetCourtesy } = require('../../src/renderer/js/net-courtesy.js');

let started, progress, complete, control, paused, tabBytes;

beforeEach(() => {
  localStorage.clear();
  VexNetCourtesy.live = new Map();
  VexNetCourtesy.run = null;
  VexNetCourtesy._wired = false;
  VexNetCourtesy.setEnabled(true);
  paused = new Set();
  tabBytes = 1000;
  window.vex = {
    onDownloadStarted: (cb) => { started = cb; },
    onDownloadProgress: (cb) => { progress = cb; },
    onDownloadComplete: (cb) => { complete = cb; },
    downloadsControl: (control = vi.fn(async (id, action) => {
      if (id === 'gone') return { ok: false, error: 'That download has already finished' };
      if (action === 'pause') paused.add(id); else paused.delete(id);
      return { ok: true, paused: action === 'pause' };
    })),
    egressSummary: vi.fn(async () => ({ bytesOut: 1048576, bytesIn: 2097152 })),
  };
  globalThis.TabCost = { sample: vi.fn(async () => {}), snapshot: () => ({ totals: { netBytes: tabBytes } }) };
  delete globalThis.VexAttention; delete globalThis.VexLedger;
  window.showToast = vi.fn();
  VexNetCourtesy._track();
});

describe('during a game', () => {
  it('pauses the downloads that are running and a new one, and resumes exactly those', async () => {
    started({ id: 'a' });
    started({ id: 'b' });
    progress({ id: 'b', paused: true });          // the person paused b themselves
    await VexNetCourtesy.begin('Marvel.exe');
    expect([...paused]).toEqual(['a']);
    started({ id: 'c' });
    await new Promise(r => setTimeout(r, 0));
    expect([...paused].sort()).toEqual(['a', 'c']);
    tabBytes = 6 * 1048576 + 1000;
    const text = await VexNetCourtesy.end();
    expect([...paused]).toEqual([]);
    expect(control).toHaveBeenCalledWith('a', 'resume');
    expect(control).not.toHaveBeenCalledWith('b', 'resume');
    expect(text).toMatch(/Vex used 9\.0 MB/);
    expect(text).toMatch(/2 downloads were paused and resumed/);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });
  it('does nothing when switched off', async () => {
    VexNetCourtesy.setEnabled(false);
    started({ id: 'a' });
    expect(await VexNetCourtesy.begin('x')).toBeNull();
    expect(paused.size).toBe(0);
    expect(await VexNetCourtesy.end()).toBeNull();
  });
  it('does not count a download that finished meanwhile as a failure', async () => {
    started({ id: 'gone' });
    await VexNetCourtesy.begin('x');
    complete({ id: 'gone' });
    const text = await VexNetCourtesy.end();
    expect(text).not.toMatch(/could not be resumed/);
  });
  it('says when one could not be resumed', async () => {
    started({ id: 'a' });
    await VexNetCourtesy.begin('x');
    control.mockImplementation(async () => ({ ok: false, error: 'This download cannot be resumed' }));
    expect(await VexNetCourtesy.end()).toMatch(/1 could not be resumed/);
  });
  it('writes the sizes in megabytes', () => {
    expect(VexNetCourtesy.mb(0)).toBe('0.1 MB');
    expect(VexNetCourtesy.mb(5 * 1048576)).toBe('5.0 MB');
  });
});
