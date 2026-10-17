// @vitest-environment jsdom
// T0-012: the volatile split has a Settings switch (it used to be the vex.volatileSplit preference or an env var only).
import { describe, it, expect, beforeEach } from 'vitest';
const { StorageCeilings } = require('../../src/renderer/js/storage-ceilings.js');

beforeEach(() => { localStorage.clear(); });

describe('volatile split switch', () => {
  it('is off until switched on, and off again removes the preference', () => {
    expect(StorageCeilings.splitOn()).toBe(false);
    expect(StorageCeilings.setSplit(true)).toBe(true);
    expect(localStorage.getItem('vex.volatileSplit')).toBe('1');
    expect(StorageCeilings.setSplit(false)).toBe(false);
    expect(localStorage.getItem('vex.volatileSplit')).toBeNull();
  });
  it('the Storage group shows a labelled checkbox that writes the preference', async () => {
    window.vex = { recallStats: async () => ({ pages: 0, bytes: 0 }), recallLimits: async () => ({}) };
    window.VexRegistry = undefined;
    const el = document.createElement('div');
    StorageCeilings.group(el);
    const box = el.querySelector('input[aria-label="Keep history-like data in a second file"]');
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.volatileSplit')).toBe('1');
  });
});
