// @vitest-environment node
// Quiet hours: hold, group, release at set times, VIP and reminders pass.
import { describe, it, expect, vi } from 'vitest';

const { createQuietHours, validateConfig } = require('../../src/main/quiet-hours.js');

const memStore = () => {
  const m = new Map();
  return { read: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), write: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; }, m };
};
// A local-time clock: tests set hh:mm.
const clock = (h, m = 0) => { const c = { t: new Date(2026, 9, 16, h, m, 0).getTime() }; c.now = () => c.t; c.set = (hh, mm = 0) => { c.t = new Date(2026, 9, 16, hh, mm, 0).getTime(); }; return c; };

async function make(cfg, c = clock(23)) {
  const shown = [];
  const show = vi.fn(async (o) => { shown.push(o); return { ok: true }; });
  const q = createQuietHours({ store: memStore(), show, now: c.now, setIntervalFn: () => null });
  await q.init();
  await q.setConfig({ enabled: true, start: '22:00', end: '07:00', ...cfg });
  return { q, show, shown, c };
}

describe('quiet hours', () => {
  it('does nothing while off', async () => {
    const show = vi.fn(async () => ({ ok: true }));
    const q = createQuietHours({ store: memStore(), show, now: clock(23).now });
    await q.gated({ title: 'Hi' });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('holds inside the window and shows outside it', async () => {
    const { q, show, c } = await make({});
    const r = await q.gated({ title: 'News', body: 'b', kind: 'news' });
    expect(r).toMatchObject({ ok: true, held: true });
    expect(show).not.toHaveBeenCalled();
    c.set(12);
    await q.gated({ title: 'Noon' });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('lets reminders, urgent toasts and VIP sites through', async () => {
    const { q, show } = await make({ vip: ['*.Mail.Example.com', 'Calendar'] });
    await q.gated({ title: 'Alarm', kind: 'reminder', tag: 'r1' });
    await q.gated({ title: 'Disk', urgent: true });
    await q.gated({ title: 'New mail', site: 'inbox.mail.example.com' });
    await q.gated({ title: 'Event', site: 'calendar' });
    expect(show).toHaveBeenCalledTimes(4);
    await q.gated({ title: 'Other', site: 'evilmail.example.com' });
    expect(show).toHaveBeenCalledTimes(4);
  });

  it('releases everything held as ONE digest when the window ends', async () => {
    const { q, show, shown, c } = await make({});
    for (const t of ['A', 'B', 'C']) await q.gated({ title: t });
    expect(await q.tick()).toEqual({ released: 0 });
    c.set(7, 1);
    expect(await q.tick()).toEqual({ released: 3 });
    expect(show).toHaveBeenCalledTimes(1);
    expect(shown[0].title).toContain('3 notifications');
    expect(shown[0].body).toContain('A');
    expect((await q.getConfig()).held).toBe(0);
  });

  it('releases at a set time inside the window, once', async () => {
    const { q, show, c } = await make({ digestTimes: ['23:30'] });
    await q.gated({ title: 'A' });
    c.set(23, 29);
    expect((await q.tick()).released).toBe(0);
    c.set(23, 31);
    expect((await q.tick()).released).toBe(1);
    await q.gated({ title: 'B' });
    c.set(23, 40);
    expect((await q.tick()).released).toBe(0);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('a single held toast comes back as itself', async () => {
    const { q, shown, c } = await make({});
    await q.gated({ title: 'Only', body: 'one', tag: 'news-1', kind: 'news', actions: true });
    c.set(8);
    await q.tick();
    expect(shown[0]).toMatchObject({ title: 'Only', body: 'one', tag: 'news-1', kind: 'news', actions: true });
  });

  it('keeps held toasts if showing the digest fails', async () => {
    const { q, c } = await make({});
    await q.gated({ title: 'A' });
    const failing = createQuietHours({ store: memStore(), show: async () => { throw new Error('refused'); }, now: c.now });
    await failing.init();
    await failing.setConfig({ enabled: true, start: '22:00', end: '07:00' });
    await failing.gated({ title: 'X' });
    c.set(8);
    await expect(failing.release()).rejects.toThrow('refused');
    expect((await failing.heldList())).toHaveLength(1);
  });

  it('survives a restart: held toasts are read back', async () => {
    const store = memStore();
    const c = clock(23);
    const a = createQuietHours({ store, show: async () => ({}), now: c.now });
    await a.init(); await a.setConfig({ enabled: true });
    await a.gated({ title: 'Kept' });
    const b = createQuietHours({ store, show: async () => ({}), now: c.now });
    expect((await b.heldList())[0].title).toBe('Kept');
  });

  it('turning it off shows what was held', async () => {
    const { q, show } = await make({});
    await q.gated({ title: 'A' });
    await q.setConfig({ enabled: false });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('rejects bad settings', () => {
    expect(() => validateConfig({ start: '25:00' })).toThrow(/time/);
    expect(() => validateConfig({ enabled: 'yes' })).toThrow();
    expect(() => validateConfig({ vip: ['not a site!!'] })).toThrow(/site name/);
    expect(() => validateConfig({ digestTimes: new Array(7).fill('10:00') })).toThrow();
  });
});
