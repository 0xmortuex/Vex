// T0-016, the part you see: one line after the next sign-in, once per loss.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VexSignoutWhy } from '../../src/renderer/js/signout-why-ui.js';

describe('VexSignoutWhy.announce', () => {
  let store, toast, report;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    toast = vi.fn();
    report = { domain: 'amazon.com.tr', watching: 3, windowDays: 30, lines: [{ t: Date.now() - 3600000, domain: 'amazon.com.tr', line: 'amazon.com.tr\'s sign-in cookie "session-id" had no expiry date.' }] };
    globalThis.window = { showToast: toast, vex: { signoutWhy: vi.fn(async () => report) }, vexAlert: vi.fn(async () => {}) };
    globalThis.VexAttention = { gate: vi.fn(() => true) };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; delete globalThis.VexAttention; });

  it('says why once, with a Details button, and not again for the same loss', async () => {
    expect(await VexSignoutWhy.announce('amazon.com.tr')).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatch(/no expiry date/);
    expect(toast.mock.calls[0][3].action.label).toBe('Details');
    expect(await VexSignoutWhy.announce('amazon.com.tr')).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });
  it('says nothing for a loss older than three days, or when switched off', async () => {
    report.lines[0].t = Date.now() - 4 * 24 * 3600 * 1000;
    expect(await VexSignoutWhy.announce('amazon.com.tr')).toBe(false);
    report.lines[0].t = Date.now() - 1000;
    VexSignoutWhy.setEnabled(false);
    expect(await VexSignoutWhy.announce('amazon.com.tr')).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
  it('stays quiet when the attention gate refuses (Game mode, quiet, too many toasts)', async () => {
    globalThis.VexAttention.gate = vi.fn(() => false);
    expect(await VexSignoutWhy.announce('amazon.com.tr')).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
  it('describes an empty record honestly', () => {
    const text = VexSignoutWhy.describe({ domain: 'discord.com', lines: [], watching: 5, windowDays: 30 });
    expect(text).toMatch(/Nothing was recorded about discord\.com/);
    expect(text).toMatch(/after the next start/);
  });
});
