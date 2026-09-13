// Reminders across machines. Vex Sync carries the list; the engine imports
// what arrives. The rules: a foreign reminder fires here while Vex is open but
// never asks Windows to wake this machine; a known one only learns that it
// fired or was dismissed elsewhere; nothing is ever deleted by an import.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
async function tmpdir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-sync-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

function fakeTime(start) {
  let t = start; const timers = new Map(); let seq = 0;
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]);
        await due[1].fn();
        await new Promise(r => setImmediate(r));
      }
      t = target;
    },
  };
}
const T0 = new Date(2026, 8, 13, 14, 30).getTime();
async function machine(dir) {
  dir = dir || await tmpdir();
  const time = fakeTime(T0); const shown = []; const calls = { register: [], unregister: [] };
  const r = createReminders({ store: new JsonStore(dir), notifier: { show: async (o) => { shown.push(o); return { ok: true }; } },
    osScheduler: { supported: true, register: async (id) => { calls.register.push(id); return 'ok'; }, unregister: async (id) => { calls.unregister.push(id); return 'removed'; } },
    now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
  await r.init();
  return { r, time, shown, calls, dir };
}

describe('two machines', () => {
  it('each has a stable installation id, and stamps its reminders with it', async () => {
    const a = await machine();
    const id1 = a.r.installId();
    expect(id1).toMatch(/^i[a-z0-9]+$/);
    const again = await machine(a.dir);
    expect(again.r.installId()).toBe(id1);
    const made = await a.r.create({ message: 'x', at: T0 + 3600000 });
    expect(made.owner).toBe(id1);
  });

  it('a reminder set on the laptop fires on the desktop, but only the laptop wakes Windows', async () => {
    const laptop = await machine();
    const desktop = await machine();
    const made = await laptop.r.create({ message: 'Call Dana', at: T0 + 10 * 60000, url: 'https://x.com/' });
    expect(laptop.calls.register).toEqual([made.id]);

    const res = await desktop.r.importList(await laptop.r.list());
    expect(res).toEqual({ added: 1, updated: 0 });
    const [got] = await desktop.r.list();
    expect(got).toMatchObject({ id: made.id, message: 'Call Dana', owner: laptop.r.installId(), url: 'https://x.com/', os: { scheduled: false, error: null, kind: 'foreign' } });
    expect(desktop.calls.register).toEqual([]);                    // the desktop does not wake for it

    await desktop.time.advance(11 * 60000);
    expect(desktop.shown).toHaveLength(1);                         // but it does fire there while open
  });

  it('learns that it fired or was dismissed elsewhere, so it never fires twice', async () => {
    const laptop = await machine();
    const desktop = await machine();
    const made = await laptop.r.create({ message: 'x', at: T0 + 5 * 60000 });
    await desktop.r.importList(await laptop.r.list());
    await laptop.time.advance(6 * 60000);                          // fired on the laptop
    await laptop.r.ack(made.id);
    const res = await desktop.r.importList(await laptop.r.list());
    expect(res).toEqual({ added: 0, updated: 1 });
    const [got] = await desktop.r.list();
    expect(got.firedAt).toBeTruthy();
    expect(got.delivered).toBe('elsewhere');
    expect(got.ackedAt).toBeTruthy();
    await desktop.time.advance(10 * 60000);
    expect(desktop.shown).toHaveLength(0);
  });

  it('never deletes, skips each machine\'s own weekly review, and drops stale or malformed items', async () => {
    const m = await machine();
    const mine = await m.r.create({ message: 'mine', at: T0 + 3600000 });
    const res = await m.r.importList([
      { id: 'rv1', message: 'Weekly review', kind: 'review', at: T0 + 86400000 },
      { id: 'old1', message: 'old', at: T0 - 10 * 86400000 },
      { id: 'done1', message: 'done', at: T0 + 60000, firedAt: T0 - 1000 },
      { id: 'bad id!', message: 'x', at: T0 + 60000 },
      { message: 'no id', at: T0 + 60000 },
      'garbage',
    ]);
    expect(res).toEqual({ added: 0, updated: 0 });
    expect((await m.r.list()).map(r => r.id)).toEqual([mine.id]);
  });

  it('a repeating one moved on by its owner moves on here too', async () => {
    const laptop = await machine();
    const desktop = await machine();
    const made = await laptop.r.create({ message: 'Stand up', at: T0 + 5 * 60000, repeat: 'daily' });
    await desktop.r.importList(await laptop.r.list());
    await laptop.time.advance(6 * 60000);                          // laptop fires; at moves to tomorrow
    const res = await desktop.r.importList(await laptop.r.list());
    expect(res.updated).toBe(1);
    const [got] = await desktop.r.list();
    expect(got.at).toBe((await laptop.r.list())[0].at);
    expect(got.firedAt).toBe(null);
    void made;
  });
});
