// @vitest-environment node
// The extension audit's "last update / last use / unused" half.
import { describe, it, expect } from 'vitest';

const { createExtensionUsage, isPassive } = require('../../src/main/extension-usage.js');

const DAY = 24 * 3600 * 1000;
const memStore = () => {
  const m = new Map();
  return { read: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), write: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; } };
};

describe('extension usage', () => {
  it('records a use at most once an hour and refuses odd names', async () => {
    let t = 1_000_000_000_000;
    const u = createExtensionUsage({ store: memStore(), now: () => t });
    expect(await u.record('tool-1')).toBe(true);
    t += 60 * 1000;
    expect(await u.record('tool-1')).toBe(false);
    t += 2 * 3600 * 1000;
    expect(await u.record('tool-1')).toBe(true);
    expect(await u.record('../evil')).toBe(false);
    expect(await u.record(5)).toBe(false);
  });

  it('calls a button extension unused after 30 days, and a recently used one not', async () => {
    const t = 1_800_000_000_000;
    const store = memStore();
    await store.write('extension-usage', { used: t - 2 * DAY });
    const u = createExtensionUsage({ store, now: () => t });
    const ui = { action: { default_popup: 'p.html' } };
    const out = await u.audit([
      { folder: 'used', path: '/e/used', manifest: ui },
      { folder: 'old', path: '/e/old', manifest: ui },
      { folder: 'fresh', path: '/e/fresh', manifest: ui },
    ], { statMtime: (p) => (p === '/e/old' ? t - 90 * DAY : t - 3 * DAY) });
    const by = Object.fromEntries(out.map(o => [o.folder, o]));
    expect(by.used.unused).toBe(false);
    expect(by.old.unused).toBe(true);
    expect(by.old.lastUsed).toBe(null);
    expect(by.fresh.unused).toBe(false);
  });

  it('never calls a background extension unused, since Vex cannot see its use', async () => {
    const t = 1_800_000_000_000;
    const u = createExtensionUsage({ store: memStore(), now: () => t });
    const blocker = { action: {}, content_scripts: [{ matches: ['*://*/*'] }] };
    const [r] = await u.audit([{ folder: 'b', path: '/e/b', manifest: blocker }], { statMtime: () => t - 400 * DAY });
    expect(r.passive).toBe(true);
    expect(r.unused).toBe(null);
    expect(r.usageKnown).toBe(false);
    expect(isPassive({ permissions: ['declarativeNetRequest'] })).toBe(true);
    expect(isPassive({ permissions: ['storage'] })).toBe(false);
  });

  it('takes the later of Vex\'s own update record and the files\' date', async () => {
    const t = 1_800_000_000_000;
    const u = createExtensionUsage({ store: memStore(), now: () => t });
    const [r] = await u.audit([{ folder: 'x', path: '/e/x', manifest: {} }], { statMtime: () => t - 50 * DAY, updates: { x: t - 5 * DAY } });
    expect(r.lastUpdated).toBe(t - 5 * DAY);
  });

  it('reports a date it cannot read instead of failing the whole audit', async () => {
    const logs = [];
    const u = createExtensionUsage({ store: memStore(), now: () => 5, log: (m) => logs.push(m) });
    const [r] = await u.audit([{ folder: 'x', path: '/e/x', manifest: {} }], { statMtime: () => { throw new Error('denied'); } });
    expect(r.lastUpdated).toBe(null);
    expect(logs.join()).toContain('denied');
  });
});
