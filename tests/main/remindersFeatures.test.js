// Repeating, page-linked, site-triggered and held reminders — the second wave
// on top of src/main/reminders.js. Same injected clock and fakes as
// reminders.test.js, kept self-contained so either file reads on its own.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createReminders, nextRepeat, siteKey } = req('../../src/main/reminders.js');
const { JsonStore } = req('../../src/main/file-store.js');

const dirs = [];
async function tmpdir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-remf-')); dirs.push(d); return d; }
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
function fakeNotifier() { const shown = []; return { shown, show: async (o) => { shown.push(o); return { ok: true }; } }; }
function fakeOs() {
  const calls = { register: [], unregister: [] };
  return { calls, supported: true, register: async (id, at) => { calls.register.push([id, at]); return 'next'; }, unregister: async (id) => { calls.unregister.push(id); return 'removed'; } };
}

const T0 = new Date(2026, 8, 13, 14, 30).getTime();   // Sunday

async function make() {
  const dir = await tmpdir(); const time = fakeTime(T0); const notifier = fakeNotifier(); const osS = fakeOs(); const fired = [];
  const r = createReminders({ store: new JsonStore(dir), notifier, osScheduler: osS, now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, onFired: (p) => fired.push(p) });
  await r.init();
  return { r, time, notifier, os: osS, fired };
}

describe('nextRepeat', () => {
  const at = new Date(2026, 8, 11, 9, 0).getTime();   // Friday 09:00
  it('keeps the wall-clock time', () => {
    for (const rep of ['daily', 'weekdays', 'weekly']) expect(new Date(nextRepeat(at, rep, at)).getHours()).toBe(9);
  });
  it('daily is tomorrow, weekly is next week, weekdays skip the weekend', () => {
    expect(new Date(nextRepeat(at, 'daily', at)).getDate()).toBe(12);
    expect(new Date(nextRepeat(at, 'weekly', at)).getDate()).toBe(18);
    expect(new Date(nextRepeat(at, 'weekdays', at)).getDay()).toBe(1);   // Monday
    expect(new Date(nextRepeat(at, 'weekdays', at)).getDate()).toBe(14);
  });
  it('is always after the moment it is asked from', () => {
    const later = new Date(2026, 8, 20, 12, 0).getTime();
    expect(nextRepeat(at, 'daily', later)).toBeGreaterThan(later);
  });
});

describe('siteKey', () => {
  it('reduces a URL or host to a bare host', () => {
    expect(siteKey('https://www.GitHub.com/org/repo')).toBe('github.com');
    expect(siteKey('WWW.reddit.com/r/x')).toBe('reddit.com');
    expect(siteKey('discord.com')).toBe('discord.com');
  });
});

describe('repeating', () => {
  it('moves to the next occurrence instead of staying fired, and re-registers the OS task', async () => {
    const { r, time, notifier, os } = await make();
    const at = new Date(2026, 8, 13, 15, 0).getTime();      // Sunday 15:00
    const made = await r.create({ message: 'Stand up', at, repeat: 'weekdays' });
    expect(made.repeat).toBe('weekdays');
    await time.advance(31 * 60000);
    expect(notifier.shown).toHaveLength(1);
    const [item] = await r.list();
    expect(item.firedAt).toBe(null);
    expect(item.lastFiredAt).toBe(at);
    expect(new Date(item.at).getDay()).toBe(1);                 // Monday: weekends skipped
    expect(new Date(item.at).getHours()).toBe(15);
    expect(os.calls.register).toHaveLength(2);                 // at create, and for the next one
    expect(os.calls.unregister).toEqual([made.id]);
    await time.advance(24 * 3600000);
    expect(notifier.shown).toHaveLength(2);
  });

  it('refuses an unknown repeat', async () => {
    const { r } = await make();
    await expect(r.create({ message: 'x', at: T0 + 3600000, repeat: 'fortnightly' })).rejects.toThrow(/daily, weekdays or weekly/);
  });
});

describe('about a page', () => {
  it('keeps the page link and passes it on when it fires', async () => {
    const { r, time, fired } = await make();
    await r.create({ message: 'Reply to this', at: T0 + 2 * 60000, url: 'https://discord.com/channels/1/2/3' });
    await time.advance(3 * 60000);
    expect(fired[0].url).toBe('https://discord.com/channels/1/2/3');
  });
  it('refuses a link that is not a web address', async () => {
    const { r } = await make();
    await expect(r.create({ message: 'x', at: T0 + 3600000, url: 'file:///C:/secret' })).rejects.toThrow(/http or https/);
  });
});

describe('next time I open a site', () => {
  it('has no time and no OS task, and fires when the site is visited', async () => {
    const { r, time, notifier, os, fired } = await make();
    const made = await r.create({ message: 'Check the PR', site: 'https://www.GitHub.com/org/repo' });
    expect(made.site).toBe('github.com');
    expect(made.at).toBe(null);
    expect(made.os).toEqual({ scheduled: false, error: null, kind: 'site' });
    expect(os.calls.register).toHaveLength(0);
    await time.advance(3 * 3600000);
    expect(notifier.shown).toHaveLength(0);                    // time alone never fires it
    expect(await r.visited('gist.github.com')).toBe(1);        // a subdomain counts
    expect(notifier.shown[0].body).toBe('Check the PR');
    expect(fired[0].site).toBe('github.com');
    expect(await r.visited('github.com')).toBe(0);             // once only
  });
  it('refuses a repeat on a site reminder, and a site that is not one', async () => {
    const { r } = await make();
    await expect(r.create({ message: 'x', site: 'github.com', repeat: 'daily' })).rejects.toThrow(/cannot also repeat/);
    await expect(r.create({ message: 'x', site: '   ' })).rejects.toThrow(/which site/);
  });
  it('deleting one does not try to remove an OS task it never had', async () => {
    const { r, os } = await make();
    const made = await r.create({ message: 'x', site: 'github.com' });
    await r.delete(made.id);
    expect(os.calls.unregister).toEqual([]);
  });
});

describe('held during focus', () => {
  it('waits for the hold to end, then fires as a batch — unless urgent', async () => {
    const { r, time, notifier } = await make();
    await r.create({ message: 'can wait', at: T0 + 5 * 60000 });
    await r.create({ message: 'cannot wait', at: T0 + 5 * 60000, urgent: true });
    r.hold(T0 + 20 * 60000);
    await time.advance(10 * 60000);
    expect(notifier.shown.map(s => s.body)).toEqual(['cannot wait']);
    expect(notifier.shown[0].title).toBe('Reminder — urgent');
    await time.advance(11 * 60000);
    // Released late, so it carries the time it was actually due.
    expect(notifier.shown).toHaveLength(2);
    expect(notifier.shown[1].body).toBe('Due 14:35 — can wait');
  });
  it('clearing the hold early releases what fell due', async () => {
    const { r, time, notifier } = await make();
    await r.create({ message: 'x', at: T0 + 2 * 60000 });
    r.hold(T0 + 60 * 60000);
    await time.advance(5 * 60000);
    expect(notifier.shown).toHaveLength(0);
    r.hold(0);
    await r.flush();
    expect(notifier.shown).toHaveLength(1);
  });
});
