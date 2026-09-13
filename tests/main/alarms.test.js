// Alarms on the reminder engine: a set of weekdays as the repeat, a sound, and
// an acknowledgement so a Vex started later does not ring for something
// already dismissed.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders, nextRepeat, firstAlarmAt } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
async function tmpdir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-alarm-')); dirs.push(d); return d; }
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
const T0 = new Date(2026, 8, 13, 14, 30).getTime();   // Sunday
async function make() {
  const dir = await tmpdir(); const time = fakeTime(T0); const shown = []; const fired = [];
  const r = createReminders({ store: new JsonStore(dir), notifier: { show: async (o) => { shown.push(o); return { ok: true }; } },
    osScheduler: { supported: true, register: async () => 'ok', unregister: async () => 'removed' },
    now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, onFired: (p) => fired.push(p) });
  await r.init();
  return { r, time, shown, fired };
}

describe('weekday sets', () => {
  it('nextRepeat skips to the next allowed weekday', () => {
    const fri = new Date(2026, 8, 11, 7, 0).getTime();
    expect(new Date(nextRepeat(fri, [1, 3, 5], fri)).getDay()).toBe(1);      // Mon
    expect(new Date(nextRepeat(fri, [5], fri)).getDate()).toBe(18);          // next Friday
    expect(new Date(nextRepeat(fri, [0, 6], fri)).getDay()).toBe(6);         // Saturday
    expect(() => nextRepeat(fri, [], fri)).toThrow(/at least one day/);
  });
  it('firstAlarmAt is today if still ahead on an allowed day, else the next allowed day', () => {
    // T0 is Sunday 14:30
    expect(new Date(firstAlarmAt(15, 0, [0], T0)).getDate()).toBe(13);      // today, 15:00
    expect(new Date(firstAlarmAt(7, 0, [0], T0)).getDate()).toBe(20);       // next Sunday
    expect(new Date(firstAlarmAt(7, 0, [1, 2, 3, 4, 5], T0)).getDay()).toBe(1);
    expect(new Date(firstAlarmAt(7, 0, null, T0)).getDate()).toBe(14);      // every day: tomorrow
  });
});

describe('an alarm', () => {
  it('is a reminder with a sound that rings again on each allowed day', async () => {
    const { r, time, shown, fired } = await make();
    const first = new Date(2026, 8, 14, 7, 0).getTime();   // Monday 07:00
    const a = await r.create({ message: 'Wake up', at: first, kind: 'alarm', sound: true, repeat: [1, 3] });
    expect(a).toMatchObject({ kind: 'alarm', sound: true, repeat: [1, 3], ackedAt: null });
    await time.advance(first - T0 + 60000);
    expect(shown).toHaveLength(1);
    expect(fired[0]).toMatchObject({ kind: 'alarm', sound: true });
    const [item] = await r.list();
    expect(new Date(item.at).getDay()).toBe(3);                                  // Wednesday next
    await r.ack(a.id);
    expect((await r.list())[0].ackedAt).toBe(time.now());
    await time.advance(2 * 24 * 3600000);
    expect(shown).toHaveLength(2);
    expect((await r.list())[0].ackedAt).toBe(null);                              // rings again until dismissed again
  });

  it('rejects an empty day set, an unknown kind, and days outside the week', async () => {
    const { r } = await make();
    await expect(r.create({ message: 'x', at: T0 + 3600000, repeat: [] })).rejects.toThrow(/at least one day/);
    await expect(r.create({ message: 'x', at: T0 + 3600000, kind: 'siren' })).rejects.toThrow(/reminder, alarm or timer/);
    await expect(r.create({ message: 'x', at: T0 + 3600000, repeat: [7, 9] })).rejects.toThrow(/at least one day/);
  });

  it('ack of an unknown id says so', async () => {
    const { r } = await make();
    await expect(r.ack('nope')).rejects.toThrow(/no longer exists/);
  });

  it('snooze acknowledges it and sets a copy nine minutes out, keeping kind, sound and page', async () => {
    const { r, time, shown } = await make();
    const a = await r.create({ message: 'Wake up', at: T0 + 2 * 60000, kind: 'alarm', sound: true, url: 'https://x.com/', job: 'dev' });
    await time.advance(3 * 60000);
    expect(shown).toHaveLength(1);
    const copy = await r.snooze(a.id, 9 * 60000);
    expect(copy).toMatchObject({ message: 'Wake up', kind: 'alarm', sound: true, url: 'https://x.com/', job: 'dev', urgent: true });
    expect(copy.at).toBe(time.now() + 9 * 60000);
    expect((await r.list()).find(x => x.id === a.id).ackedAt).toBe(time.now());
    await time.advance(10 * 60000);
    expect(shown).toHaveLength(2);
  });
});
