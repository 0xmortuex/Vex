// @vitest-environment jsdom
//
// The window's half of "many of your logins look gone": one Attention Inbox item, pointing at the newest valid backup.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let added, handlers, signins, listeners;
const MOD = '../../src/renderer/js/mass-signout.js';
function fresh() { delete require.cache[require.resolve(MOD)]; delete window.VexMassSignout; return require(MOD).VexMassSignout; }
function load() {
  window.vex = { signins };
  return fresh();
}
beforeEach(() => {
  added = []; handlers = {}; listeners = [];
  globalThis.AttentionInbox = { add: (r) => { added.push(r); return true; }, handle: (f, fn) => { handlers[f] = fn; } };
  signins = { pending: vi.fn(async () => null), dismiss: vi.fn(async () => true), onMassDrop: (cb) => { listeners.push(cb); } };
  window.VexBackup = { open: vi.fn() };
  delete window.VexTabPolicy;
});
afterEach(() => { delete globalThis.AttentionInbox; delete window.vex; delete window.VexBackup; });

describe('the inbox item', () => {
  it('names the numbers and the newest valid backup, and opens the backups', () => {
    const m = load();
    expect(m.note({ before: 14, now: 3, backup: { name: 'auto-daily-x.json', at: Date.UTC(2026, 10, 6, 10) } })).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ feature: 'mass-signout', id: 'drop', title: 'Many of your sign-ins look gone', action: { label: 'Open backups', key: 'open' } });
    expect(added[0].body).toMatch(/14 → 3/);
    expect(added[0].body).toMatch(/newest backup that checks out is from/);
    expect(added[0].body).toMatch(/not the sites’ sign-in cookies/);      // does not pretend a backup brings the sign-ins back
    handlers['mass-signout']('open');
    expect(window.VexBackup.open).toHaveBeenCalled();
  });
  it('says so when there is no valid backup yet', () => {
    const m = load();
    m.note({ before: 9, now: 1, backup: null });
    expect(added[0].body).toMatch(/no backup that checks out yet/);
  });
  it('ignores a notice that is not two numbers', () => {
    const m = load();
    expect(m.note({ before: 'a', now: 1 })).toBe(false);
    expect(m.note(null)).toBe(false);
    expect(added).toEqual([]);
  });
});

describe('how it hears', () => {
  it('from main’s push, and from a notice sent before the module loaded', async () => {
    signins.pending = vi.fn(async () => ({ before: 10, now: 2, backup: null }));
    load();
    await new Promise(r => setTimeout(r, 0));
    expect(added).toHaveLength(1);
    expect(signins.dismiss).toHaveBeenCalledTimes(1);          // filed, so main lets go of it
    listeners[0]({ before: 20, now: 4, backup: null });
    expect(added).toHaveLength(2);
    expect(signins.dismiss).toHaveBeenCalledTimes(2);
  });
  it('does nothing in a private window or without the bridge', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    load();
    expect(signins.pending).not.toHaveBeenCalled();
    delete window.VexTabPolicy;
    delete window.vex;
    fresh();
    expect(signins.pending).not.toHaveBeenCalled();
  });
});
