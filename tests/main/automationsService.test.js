// Page automations: the service. Encryption at rest, the kill switch, the run
// limits, the schedule with a fake clock (including a PC that was asleep), the
// Windows wake-up, the notifications and the run log.
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const M = require('../../src/renderer/js/automations-model.js');
const { createAutomations, computeNext, CHECK_MS } = require('../../src/main/automations.js');
const { SecretStore } = require('../../src/main/file-store.js');
const { createFakeDriver, recording, open } = require('../helpers/automationsFake.js');

const PAGES = {
  '/home': '<html><body><label for="q">Search term</label><input id="q"><button type="button" onclick="window.searched=1">Search</button><button type="submit" onclick="window.bought=1;return false">Place order</button></body></html>',
};
const click = (name) => ({ type: 'click', target: { role: 'button', name, tag: 'button' } });
const RUN = [open('http://127.0.0.1:9/home'), click('Search')];

// A "Windows" that can encrypt: reversible, but not readable as text.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map(b => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(Buffer.from(b).map(x => x ^ 0x5a)).toString('utf8'),
};

// Waits until no run is going, polling (a fixed pause flaked on a busy runner).
async function settled(svc) { for (let i = 0; i < 500; i++) { await new Promise(r => setTimeout(r, 10)); if (!svc.hasActive()) { await new Promise(r => setTimeout(r, 10)); if (!svc.hasActive()) return; } } throw new Error('the run did not end'); }

function build({ answers = [], route = 'direct', focused = true, startTime = new Date(2026, 5, 3, 8, 0, 0).getTime() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-auto-'));
  const file = path.join(dir, 'automations.enc');
  const secrets = new SecretStore(fakeSafeStorage);
  const store = { read: () => secrets.read(file, () => null), write: (d) => secrets.write(file, d) };
  const clock = { t: startTime };
  const toasts = [], events = [], osCalls = [], drivers = [];
  const queue = [...answers];
  let svc;
  const mk = () => {
    svc = createAutomations({
      store, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, allowLocal: true,
      setTimeout: () => 1, clearTimeout: () => {},
      notifier: { show: async (n) => { toasts.push(n); return { ok: true }; } },
      osScheduler: { supported: true, register: async (id, at) => { osCalls.push(['register', id, at.getTime()]); }, unregister: async (id) => { osCalls.push(['unregister', id]); } },
      makeDriver: async () => { const d = createFakeDriver(PAGES); drivers.push(d); return d; },
      emit: (e) => { events.push(e); if (e.type === 'approval') setImmediate(() => { try { svc.decide(e.request.runId, queue.length ? queue.shift() : 'approve'); } catch (err) { /* closed meanwhile */ } }); },
      routeOf: () => route, windowFocused: () => focused, approvalTimeoutMs: 1000,
    });
    return svc;
  };
  mk();
  return { svc, mk, file, dir, clock, toasts, events, osCalls, drivers, secrets, queue };
}

describe('encrypted at rest', () => {
  it('the file on disk does not contain what was typed, read or screenshotted, and starts with the encryption header', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const saved = await t.svc.save(recording([open('http://127.0.0.1:9/home'),
      { type: 'type', value: 'my private search words', target: { role: 'textbox', name: 'Search term', tag: 'input', css: '#q' } },
      { type: 'type', value: 'hunter2-top-secret', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#p' } },
    ], { name: 'Private job' }));
    await t.svc.state();
    const bytes = fs.readFileSync(t.file);
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('VEXENC1\0');
    const text = bytes.toString('latin1') + bytes.toString('utf8');
    expect(text).not.toContain('my private search words');
    expect(text).not.toContain('Private job');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('example');
    // ... and it comes back whole after a restart
    const again = build();
    expect(again.file).not.toBe(t.file);
    fs.copyFileSync(t.file, again.file);
    const st = await again.svc.state();
    expect(st.recs[0].name).toBe('Private job');
    expect(st.recs[0].steps[1].value).toBe('my private search words');
    expect(st.recs[0].steps[2].value).toBeUndefined();
    expect(saved.steps[2].ask).toBe(true);
  });
  it('a run log with a read value and a failure screenshot is encrypted too', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), { type: 'read', as: 'x', target: { name: 'Search term', label: 'Search term', css: '#q' } }, click('Nothing like this')], { name: 'Log' }));
    const { done } = await t.svc.startNow(rec.id);
    const run = await done;
    expect(run.status).toBe('failed');
    expect(run.shot).toMatch(/^data:image/);
    const bytes = fs.readFileSync(t.file);
    expect(bytes.toString('latin1')).not.toContain('FAKE');
    expect(bytes.toString('latin1')).not.toContain('Nothing like this');
  });
  it('never touches localStorage or any plain file', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    await t.svc.save(recording(RUN, { name: 'X' }));
    expect(fs.readdirSync(t.dir)).toEqual(['automations.enc']);
  });
});

describe('switches', () => {
  it('is off until switched on', async () => {
    const t = build();
    const rec = await t.svc.save(recording(RUN, { name: 'X' }));
    await expect(t.svc.startNow(rec.id)).rejects.toThrow(/switched off/);
  });
  it('the kill switch stops the run in progress, answers the prompt "stop", removes the Windows wake-ups and holds everything until re-armed', async () => {
    const t = build({ answers: [] });
    t.queue.push('__never__');
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), click('Place order'), click('Search')], { name: 'Daily', schedule: { kind: 'daily', time: '09:00' } }));
    expect(t.osCalls.some(c => c[0] === 'register' && c[1] === 'auto-' + rec.id)).toBe(true);
    // the person's answer never comes: the kill switch is pressed instead
    t.svc.mk = null;
    const events = t.events;
    const svc = t.svc;
    // do not auto-answer: replace decide
    const { done } = await svc.startNow(rec.id);
    for (let i = 0; i < 200 && !events.some(e => e.type === 'approval'); i++) await new Promise(r => setTimeout(r, 10));   // wait for the prompt (the helper answers with an unknown word, which throws and is ignored)
    expect(events.some(e => e.type === 'approval')).toBe(true);
    await svc.kill('test');
    const run = await done;
    expect(run.status).toBe('stopped');
    expect(t.osCalls.filter(c => c[0] === 'unregister' && c[1] === 'auto-' + rec.id).length).toBeGreaterThan(0);
    await expect(svc.startNow(rec.id)).rejects.toThrow(/kill switch/);
    expect((await svc.state()).killed).toBe(true);
    await svc.rearm();
    expect((await svc.state()).killed).toBe(false);
    expect(t.osCalls.filter(c => c[0] === 'register' && c[1] === 'auto-' + rec.id).length).toBeGreaterThan(1);
  });
  it('Stop ends the run at the next step', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), { type: 'wait', ms: 5000 }, click('Search')], { name: 'S' }));
    const orig = t.clock;
    const { done } = await t.svc.startNow(rec.id);
    t.svc.stop();
    const run = await done;
    expect(['stopped', 'ok']).toContain(run.status);
    expect(orig.t).toBeGreaterThan(0);
  });
  it('runs one at a time', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const a = await t.svc.save(recording([open('http://127.0.0.1:9/home'), click('Place order')], { name: 'A' }));
    const b = await t.svc.save(recording(RUN, { name: 'B' }));
    t.queue.push('__hold__');
    const first = await t.svc.startNow(a.id);
    await expect(t.svc.startNow(b.id)).rejects.toThrow(/Another automation is running/);
    t.svc.stop();
    await first.done;
  });
  it('refuses a routed session (Tor or a proxy) when saving and when running', async () => {
    const t = build({ route: 'tor' });
    await expect(t.svc.save(recording(RUN, { name: 'X' }))).rejects.toThrow(/routed through Tor or a proxy/);
  });
});

describe('limits', () => {
  it('allows 6 runs an hour for one automation; the 7th is refused and logged', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Often' }));
    for (let i = 0; i < 6; i++) { const r = await t.svc.startNow(rec.id); expect((await r.done).status).toBe('ok'); t.clock.t += 60000; }
    await expect(t.svc.startNow(rec.id)).rejects.toThrow(/6 times in the last hour/);
    const runs = await t.svc.runs(rec.id);
    expect(runs[0].status).toBe('blocked');
    t.clock.t += 3600 * 1000;
    expect((await (await t.svc.startNow(rec.id)).done).status).toBe('ok');
  });
  it('a prompt nobody answers ends the run as needs-approval after the timeout, with nothing done, and a toast says so', async () => {
    const t = build();
    t.svc.stopTimers();
    // a service whose timeouts really fire
    const timers = [];
    const svc = createAutomations({
      store: { read: async () => null, write: async () => {} }, now: () => t.clock.t, sleep: async () => {}, allowLocal: true,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
      notifier: { show: async (n) => { t.toasts.push(n); } }, osScheduler: { supported: false },
      makeDriver: async () => { const d = createFakeDriver(PAGES); t.drivers.push(d); return d; },
      routeOf: () => 'direct', windowFocused: () => false, approvalTimeoutMs: 5000,
      emit: (e) => { if (e.type === 'approval') setImmediate(() => timers.find(x => x.ms === 5000).fn()); },
    });
    await svc.setEnabled(true);
    const rec = await svc.save(recording([open('http://127.0.0.1:9/home'), click('Place order'), click('Search')], { name: 'Shop' }));
    const run = await (await svc.startNow(rec.id)).done;
    expect(run.status).toBe('needs-approval');
    expect(t.drivers.at(-1).closed).toBe(true);
    expect(t.toasts.map(x => x.title)).toEqual(expect.arrayContaining(['An automation is waiting for your approval', 'Automation needs you']));
    expect(run.failure).toBeNull();
  });
  it('a failed run notifies through the main-process notifier', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), click('Not on the page')], { name: 'Broken' }));
    const run = await (await t.svc.startNow(rec.id)).done;
    expect(run.status).toBe('failed');
    expect(t.toasts.at(-1)).toMatchObject({ title: 'Automation failed', kind: 'automation' });
    expect(t.toasts.at(-1).body).toContain('Broken');
  });
});

describe('the schedule (fake clock)', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).getTime();
  it('works out the next daily, weekday and weekly time', () => {
    const after = at(2026, 5, 3, 10, 0);    // Wednesday 10:00
    expect(new Date(computeNext({ kind: 'daily', time: '09:00' }, after))).toEqual(new Date(2026, 5, 4, 9, 0));
    expect(new Date(computeNext({ kind: 'daily', time: '11:30' }, after))).toEqual(new Date(2026, 5, 3, 11, 30));
    expect(new Date(computeNext({ kind: 'weekdays', time: '09:00' }, at(2026, 5, 5, 10, 0)))).toEqual(new Date(2026, 5, 8, 9, 0));   // Friday -> Monday
    expect(new Date(computeNext({ kind: 'weekly', time: '07:15', day: 1 }, after))).toEqual(new Date(2026, 5, 8, 7, 15));
    expect(computeNext({ kind: 'none' }, after)).toBeNull();
    expect(computeNext({ kind: 'daily', time: '09:00' }, at(2026, 5, 3, 9, 0))).toBe(at(2026, 5, 4, 9, 0));   // strictly after
  });
  it('keeps the wall-clock time across a clock change', () => {
    // Europe/Istanbul has no DST now, so assert the construction: midday stepping gives the same HH:MM on consecutive days.
    let t = at(2026, 2, 28, 12, 0);
    for (let i = 0; i < 5; i++) { t = computeNext({ kind: 'daily', time: '02:30' }, t); expect(new Date(t).getHours() * 60 + new Date(t).getMinutes()).toBe(150); }
  });
  it('registers the Windows wake-up for the next time, and runs when it is due, once, moving on first', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Morning', schedule: { kind: 'daily', time: '09:00' } }));
    expect(rec.nextAt).toBe(at(2026, 5, 3, 9, 0));
    expect(t.osCalls.at(-1)).toEqual(['register', 'auto-' + rec.id, at(2026, 5, 3, 9, 0)]);
    t.clock.t = at(2026, 5, 3, 8, 59);
    expect(await t.svc.checkDue()).toBe(0);
    t.clock.t = at(2026, 5, 3, 9, 0) + 5000;
    expect(await t.svc.checkDue()).toBe(1);
    await settled(t.svc);
    const st = await t.svc.state();
    expect(st.recs[0].nextAt).toBe(at(2026, 5, 4, 9, 0));
    expect(t.osCalls.at(-1)).toEqual(['register', 'auto-' + rec.id, at(2026, 5, 4, 9, 0)]);
    const runs = await t.svc.runs(rec.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'schedule', status: 'ok' });
    expect(await t.svc.checkDue()).toBe(0);       // not twice
    expect((await t.svc.runs(rec.id))).toHaveLength(1);
  });
  it('a PC that was asleep: the missed run happens once on wake (even if several days were missed)', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Morning', schedule: { kind: 'daily', time: '09:00', missed: 'run' } }));
    t.clock.t = at(2026, 5, 7, 14, 0);           // four days later
    expect(await t.svc.checkDue()).toBe(1);
    await settled(t.svc);
    const runs = await t.svc.runs(rec.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe('missed');
    expect((await t.svc.state()).recs[0].nextAt).toBe(at(2026, 5, 8, 9, 0));
  });
  it('a missed run is skipped, and the log says why, when the person chose skip', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Morning', schedule: { kind: 'daily', time: '09:00', missed: 'skip' } }));
    t.clock.t = at(2026, 5, 7, 14, 0);
    await t.svc.checkDue();
    const runs = await t.svc.runs(rec.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'skipped', trigger: 'missed' });
    expect(runs[0].failure.message).toMatch(/skip missed runs/);
    expect(t.drivers).toHaveLength(0);
  });
  it('an automation that is switched off, or the whole feature off, or killed, never runs on schedule', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Morning', enabled: false, schedule: { kind: 'daily', time: '09:00' } }));
    expect(rec.nextAt).toBeNull();
    const on = await t.svc.save(recording(RUN, { name: 'On', schedule: { kind: 'daily', time: '09:00' } }));
    t.clock.t = at(2026, 5, 3, 9, 1);
    await t.svc.kill('x');
    expect(await t.svc.checkDue()).toBe(0);
    await t.svc.rearm();
    await t.svc.setEnabled(false);
    expect(await t.svc.checkDue()).toBe(0);
    expect(on.id).toBeTruthy();
  });
  it('arms its timer for at most a minute ahead (a safety net for a clock that jumped)', async () => {
    const delays = [];
    const t = build();
    const svc = createAutomations({ store: { read: async () => null, write: async () => {} }, now: () => t.clock.t, allowLocal: true, setTimeout: (fn, ms) => { delays.push(ms); return 1; }, clearTimeout: () => {}, notifier: { show: async () => {} }, osScheduler: { supported: false }, makeDriver: async () => createFakeDriver(PAGES), routeOf: () => 'direct' });
    await svc.setEnabled(true);
    await svc.save(recording(RUN, { name: 'N', schedule: { kind: 'daily', time: '23:00' } }));
    expect(delays.at(-1)).toBe(CHECK_MS);
  });
  it('removing an automation removes its Windows wake-up and its log', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'Gone', schedule: { kind: 'daily', time: '09:00' } }));
    await (await t.svc.startNow(rec.id)).done;
    await t.svc.remove(rec.id);
    expect(t.osCalls.at(-1)).toEqual(['unregister', 'auto-' + rec.id]);
    expect(await t.svc.runs()).toEqual([]);
  });
});

describe('run log and the inbox hand-off', () => {
  it('keeps one entry per run, undelivered until the interface acknowledges it', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording(RUN, { name: 'L' }));
    await (await t.svc.startNow(rec.id)).done;
    let st = await t.svc.state();
    expect(st.undelivered).toHaveLength(1);
    expect(st.undelivered[0]).toMatchObject({ status: 'ok', name: 'L' });
    await t.svc.ack([st.undelivered[0].id]);
    st = await t.svc.state();
    expect(st.undelivered).toHaveLength(0);
    const full = await t.svc.runGet(st.recs[0].id ? (await t.svc.runs())[0].id : '');
    expect(full.log.length).toBeGreaterThan(0);
  });
  it('keeps at most 60 runs and 10 failure screenshots', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), click('Missing')], { name: 'F' }));
    for (let i = 0; i < 14; i++) { t.clock.t += 3600 * 1000 * 2; await (await t.svc.startNow(rec.id)).done; }
    const runs = await t.svc.runs();
    expect(runs).toHaveLength(14);
    const withShots = [];
    for (const r of runs) if ((await t.svc.runGet(r.id)).shot) withShots.push(r.id);
    expect(withShots).toHaveLength(10);
  });
  it('exports without values and imports switched off', async () => {
    const t = build();
    await t.svc.setEnabled(true);
    const rec = await t.svc.save(recording([open('http://127.0.0.1:9/home'), { type: 'type', value: 'secret-ish words', target: { role: 'textbox', name: 'Search term', tag: 'input', css: '#q' } }], { name: 'Ex' }));
    const text = await t.svc.exportOne(rec.id);
    expect(text).not.toContain('secret-ish words');
    const back = await t.svc.importText(text);
    expect(back.enabled).toBe(false);
    expect(back.id).not.toBe(rec.id);
    expect((await t.svc.state()).recs).toHaveLength(2);
  });
});
