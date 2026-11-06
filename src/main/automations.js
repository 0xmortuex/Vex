// === Page automations: the service ============================================
//
// Owns the recordings, the run logs, the schedule, the approval prompts and the
// kill switch. The page itself (the window a run uses) comes from makeDriver,
// the storage from `store`, toasts from `notifier`, and the Windows wake-up
// from `osScheduler` (the same Task Scheduler machinery as reminders), all
// injected, so this is tested with a fake clock and a fake page.
//
// Storage: ONE document (recordings, run logs, switches) written through
// SecretStore as automations.enc, so everything that could hold typed text, a
// read value or a screenshot is encrypted by Windows (DPAPI) at rest. It is
// never in localStorage, never in the synced settings, and never sent
// anywhere: the only way out is Export, which strips every typed value.
//
// Safety rules kept HERE (the step rules are in automations-run.js and
// renderer/js/automations-model.js):
//   * off until the person switches the feature on; a kill switch that stops the
//     run in progress, answers every open prompt "stop", and removes the
//     Windows wake-ups until the person re-arms it
//   * one run at a time; at most 6 runs an hour per automation and 20 overall
//   * never in a private, Tor or routed session (only the main session and the
//     person's own containers, and only when no proxy or Tor route is set)
//   * a prompt nobody answers ends the run as "needs approval" with nothing done
//   * a missed run (the PC was asleep) runs once on wake or is skipped, per the
//     recording's own setting
const Model = require('../renderer/js/automations-model.js');
const { createRunner } = require('./automations-run.js');

const CHECK_MS = 60 * 1000;
const FILE_VERSION = 1;

// The next local wall-clock occurrence of a schedule strictly after `after`.
function computeNext(schedule, after) {
  if (!schedule || schedule.kind === 'none') return null;
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  for (let offset = 0; offset < 9; offset++) {
    const d = new Date(after);
    d.setHours(12, 0, 0, 0);          // step by day from midday, so a clock change never skips a day
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= after) continue;
    const dow = d.getDay();
    if (schedule.kind === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (schedule.kind === 'weekly' && dow !== schedule.day) continue;
    return d.getTime();
  }
  throw new Error('Could not work out the next run of this schedule');
}

function createAutomations({ store, notifier, osScheduler, now = () => Date.now(), setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout,
  makeDriver, emit = () => {}, log, routeOf = () => 'direct', windowFocused = () => true, allowLocal = false, isPrivateHost, sleep, approvalTimeoutMs = Model.LIMITS.approvalTimeoutMs }) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new Error('createAutomations needs a store');
  if (typeof makeDriver !== 'function') throw new Error('createAutomations needs makeDriver');
  const note = typeof log === 'function' ? log : () => {};
  const send = (event) => { try { emit(event); } catch (err) { note('[Automations] listener threw: ' + err.message); } };
  const runner = createRunner({ now, sleep, allowLocal, isPrivateHost });

  let doc = null;
  let timer = null;
  let stopped = false;
  let active = null;               // { runId, recId, name, startedAt, step, total, stop: bool, done }
  const approvals = new Map();     // runId -> { req, resolve, timer }
  const queue = [];                // scheduled runs that came due while another was running

  async function load() {
    if (doc) return doc;
    const raw = await store.read();
    doc = raw && typeof raw === 'object' && raw.v === FILE_VERSION ? raw : { v: FILE_VERSION, enabled: false, killed: false, killedAt: null, recs: [], runs: [], runTimes: [] };
    doc.recs = Array.isArray(doc.recs) ? doc.recs : [];
    doc.runs = Array.isArray(doc.runs) ? doc.runs : [];
    doc.runTimes = Array.isArray(doc.runTimes) ? doc.runTimes : [];
    return doc;
  }
  const persist = () => store.write(doc);
  const findRec = (id) => { const r = doc.recs.find(x => x.id === id); if (!r) throw new Error('That automation no longer exists'); return r; };
  const osName = (id) => 'auto-' + id;

  async function checkRoute(partition) {
    const mode = await routeOf(partition);
    if (mode && mode !== 'direct') throw new Error('That session is routed through Tor or a proxy; automations only run in a direct session');
  }

  // ---- the Windows wake-up ------------------------------------------------------
  async function registerOs(rec) {
    if (!(osScheduler && osScheduler.supported) || rec.nextAt == null) { rec.os = { scheduled: false, error: osScheduler && osScheduler.supported ? null : 'Only Windows can wake Vex for a schedule; it runs while Vex is open' }; return; }
    try { await osScheduler.register(osName(rec.id), new Date(rec.nextAt)); rec.os = { scheduled: true, error: null }; }
    catch (err) { rec.os = { scheduled: false, error: err.message }; }
  }
  async function unregisterOs(id) {
    if (!(osScheduler && osScheduler.supported)) return null;
    try { await osScheduler.unregister(osName(id)); return null; }
    catch (err) { note('[Automations] could not remove the Windows task for ' + id + ': ' + err.message); return err.message; }
  }

  // ---- the timer ------------------------------------------------------------------
  function arm() {
    if (stopped) return;
    if (timer) { clearT(timer); timer = null; }
    if (!doc || !doc.enabled || doc.killed) return;
    const due = doc.recs.filter(r => r.enabled && r.nextAt != null).map(r => r.nextAt);
    if (!due.length) return;
    const delay = Math.max(0, Math.min(CHECK_MS, Math.min(...due) - now()));
    timer = setT(() => { timer = null; return fireDue().catch(err => note('[Automations] due-check failed: ' + err.message)); }, delay);
  }

  async function fireDue() {
    await load();
    if (!doc.enabled || doc.killed) return 0;
    const t = now();
    const due = doc.recs.filter(r => r.enabled && r.nextAt != null && r.nextAt <= t).sort((a, b) => a.nextAt - b.nextAt);
    for (const rec of due) {
      const late = t - rec.nextAt > CHECK_MS * 2;
      const wasDue = rec.nextAt;
      // Moved on and written BEFORE anything runs: a crash cannot run it twice.
      rec.nextAt = computeNext(rec.schedule, t);
      await registerOs(rec);
      await persist();
      if (late && rec.schedule.missed === 'skip') {
        addRun({ id: Model.newId('r'), recId: rec.id, name: rec.name, trigger: 'missed', startedAt: t, endedAt: t, status: 'skipped', stepsRun: 0, log: [], reads: [], failure: { reason: 'missed', message: 'Vex was closed or the PC was asleep at ' + new Date(wasDue).toLocaleString() + '; you chose to skip missed runs', index: -1 }, delivered: false });
        await persist(); send({ type: 'finished', runId: null }); continue;
      }
      if (active) { queue.push({ id: rec.id, trigger: late ? 'missed' : 'schedule' }); continue; }
      start(rec.id, { trigger: late ? 'missed' : 'schedule' }).done.catch(err => note('[Automations] scheduled run failed to start: ' + err.message));
    }
    arm();
    return due.length;
  }

  function addRun(run) {
    doc.runs.unshift(run);
    while (doc.runs.length > Model.LIMITS.maxRuns) doc.runs.pop();
    const withShot = doc.runs.filter(r => r.shot);
    for (const r of withShot.slice(Model.LIMITS.maxShots)) delete r.shot;
  }

  // ---- approval prompts -----------------------------------------------------------
  function approve(req) {
    return new Promise((resolve) => {
      const entry = { req: { ...req, askedAt: now() }, resolve: null, timer: null };
      entry.resolve = (d) => { if (entry.timer) clearT(entry.timer); approvals.delete(req.runId); send({ type: 'approval-closed', runId: req.runId }); resolve(d); };
      entry.timer = setT(() => entry.resolve('timeout'), approvalTimeoutMs);
      approvals.set(req.runId, entry);
      send({ type: 'approval', request: entry.req });
      // A run nobody is watching reaches the person as a toast, from the main process.
      if (!windowFocused() || (active && active.trigger !== 'manual')) {
        notifier.show({ title: req.kind === 'fill' ? 'An automation needs you' : 'An automation is waiting for your approval', body: (req.name || 'Automation') + ': ' + (req.label || '') + (req.why ? ' (' + req.why + ')' : ''), tag: 'automation-' + req.runId, kind: 'automation' })
          .catch(err => note('[Automations] the approval toast was refused: ' + err.message));
      }
    });
  }

  // ---- one run ----------------------------------------------------------------------
  function start(id, { trigger = 'manual' } = {}) {
    let resolveDone, rejectDone, resolveStarted, rejectStarted;
    const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
    // `started` settles when the run has been accepted (or refused, with the reason); `done` when it has ended.
    const started = new Promise((res, rej) => { resolveStarted = res; rejectStarted = rej; });
    done.catch(() => { /* vex-allow-empty-catch: the refusal is reported through started/done to whoever waits */ });      // a caller that only cares about `started` is not left with an unhandled rejection
    started.catch(() => { /* vex-allow-empty-catch: same refusal, seen by whoever waits on started */ });
    const fn = async () => {
      await load();
      const rec = findRec(id);
      if (!doc.enabled) throw new Error('Page automations are switched off (Settings > Page automations)');
      if (doc.killed) throw new Error('The automation kill switch is on; re-arm it in Settings first');
      if (active) throw new Error('Another automation is running; wait for it or press Stop');
      if (trigger !== 'manual' && !rec.enabled) throw new Error('This automation is switched off');
      await checkRoute(rec.partition);
      const t = now();
      doc.runTimes = doc.runTimes.filter(x => x.at > t - 3600 * 1000);
      const why = Model.rateRefusal({ now: t, recTimes: doc.runTimes.filter(x => x.id === id).map(x => x.at), allTimes: doc.runTimes.map(x => x.at) });
      if (why) {
        addRun({ id: Model.newId('r'), recId: id, name: rec.name, trigger, startedAt: t, endedAt: t, status: 'blocked', stepsRun: 0, log: [], reads: [], failure: { reason: 'rate', message: why, index: -1 }, delivered: false });
        await persist(); send({ type: 'finished', runId: null });
        throw new Error(why);
      }
      doc.runTimes.push({ id, at: t });
      const runId = Model.newId('r');
      active = { runId, recId: id, name: rec.name, startedAt: t, step: -1, total: rec.steps.length, stop: false, trigger, mode: rec.mode };
      await persist();
      send({ type: 'started', run: { runId, recId: id, name: rec.name, total: rec.steps.length, mode: rec.mode } });
      return { rec, runId };
    };
    const body = (async () => {
      let ctx;
      try { ctx = await fn(); } catch (err) { rejectStarted(err); rejectDone(err); throw err; }
      const { rec, runId } = ctx;
      resolveStarted(runId);
      let driver = null, result;
      try {
        driver = await makeDriver(rec.partition, { visible: rec.mode === 'visible', name: rec.name });
        result = await runner.run(rec, {
          driver, approve, trigger, runId,
          isStopped: () => !!(active && active.stop) || doc.killed,
          onStep: (e) => { if (active) active.step = e.i; send({ type: 'step', runId, entry: e, total: rec.steps.length }); },
        });
      } catch (err) {
        // Not a step failure: the page could not even be made.
        result = { runId, recId: rec.id, name: rec.name, trigger, startedAt: active ? active.startedAt : now(), endedAt: now(), status: 'failed', log: [], reads: [], stepsRun: 0, failure: { index: -1, reason: 'page-error', message: 'The automation window could not be made: ' + err.message }, summariseRequested: false };
      } finally {
        if (driver) { try { await driver.close(); } catch (err) { note('[Automations] could not close the run window: ' + err.message); } }
        const entry = approvals.get(runId); if (entry) entry.resolve('stop');
      }
      const shot = result.failure && result.failure.screenshot;
      const run = { id: runId, recId: rec.id, name: rec.name, trigger, startedAt: result.startedAt, endedAt: result.endedAt, status: result.status, stepsRun: result.stepsRun, log: result.log.slice(-80), reads: result.reads, summariseRequested: !!result.summariseRequested, finalUrl: result.finalUrl || null, delivered: false,
        failure: result.failure ? { ...result.failure, screenshot: undefined, hasShot: !!shot } : null, ...(shot ? { shot } : {}) };
      addRun(run);
      const live = doc.recs.find(x => x.id === rec.id);
      if (live) { live.lastRunAt = result.endedAt; live.lastStatus = result.status; }
      active = null;
      await persist();
      send({ type: 'finished', runId, run: summary(run) });
      if (result.status !== 'ok' && result.status !== 'stopped') {
        const body2 = result.status === 'needs-approval' ? 'Waiting for your approval; nothing was done for that step' : result.status === 'needs-you' ? 'A CAPTCHA appeared. Open the page and finish it yourself' : (result.failure && result.failure.message) || 'It stopped';
        notifier.show({ title: result.status === 'failed' || result.status === 'limit' ? 'Automation failed' : 'Automation needs you', body: rec.name + ': ' + body2, tag: 'automation-' + runId, kind: 'automation' })
          .catch(err => note('[Automations] the toast was refused: ' + err.message));
      }
      resolveDone(run);
      const next = queue.shift();
      if (next) start(next.id, { trigger: next.trigger }).done.catch(err => note('[Automations] queued run failed to start: ' + err.message));
      return run;
    })();
    body.catch(() => { /* vex-allow-empty-catch: the error went to started/done above */ });   // a refusal is reported through `started` and `done`
    return { started, done };
  }

  const summary = (r) => ({ id: r.id, recId: r.recId, name: r.name, trigger: r.trigger, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, stepsRun: r.stepsRun, failure: r.failure ? { index: r.failure.index, reason: r.failure.reason, message: r.failure.message, label: r.failure.label, hasShot: !!r.failure.hasShot } : null, reads: r.reads, summariseRequested: !!r.summariseRequested, delivered: !!r.delivered });

  // ---- the public surface ---------------------------------------------------------------
  const api = {
    CHECK_MS,
    computeNext,

    async init() {
      await load();
      if (doc.enabled && !doc.killed) for (const rec of doc.recs.filter(r => r.enabled && r.schedule.kind !== 'none')) {
        if (rec.nextAt == null) rec.nextAt = computeNext(rec.schedule, now());
        await registerOs(rec);
      }
      await persist();
      const fired = await fireDue();
      note('[Automations] ready: ' + doc.recs.length + ' recordings, ' + fired + ' due on startup');
      return doc.recs.length;
    },

    async state() {
      await load();
      return {
        enabled: doc.enabled, killed: doc.killed, killedAt: doc.killedAt,
        recs: doc.recs.map(r => JSON.parse(JSON.stringify(r))),
        running: active ? { runId: active.runId, recId: active.recId, name: active.name, startedAt: active.startedAt, step: active.step, total: active.total, mode: active.mode } : null,
        pending: [...approvals.values()].map(a => a.req),
        undelivered: doc.runs.filter(r => !r.delivered).map(summary),
        limits: Model.LIMITS, osSupported: !!(osScheduler && osScheduler.supported),
      };
    },

    async setEnabled(on) {
      await load();
      doc.enabled = !!on;
      if (!doc.enabled) { if (active) active.stop = true; for (const a of [...approvals.values()]) a.resolve('stop'); for (const r of doc.recs) await unregisterOs(r.id); }
      else for (const r of doc.recs.filter(x => x.enabled && x.schedule.kind !== 'none')) { if (r.nextAt == null) r.nextAt = computeNext(r.schedule, now()); await registerOs(r); }
      await persist(); arm(); send({ type: 'state' });
      return doc.enabled;
    },

    // The global kill switch: stop the run, answer every prompt "stop", drop the
    // Windows wake-ups and hold everything until the person re-arms.
    async kill(reason) {
      await load();
      doc.killed = true; doc.killedAt = now();
      if (timer) { clearT(timer); timer = null; }
      queue.length = 0;
      if (active) active.stop = true;
      for (const a of [...approvals.values()]) a.resolve('stop');
      for (const r of doc.recs) await unregisterOs(r.id);
      await persist();
      note('[Automations] kill switch: ' + String(reason || 'pressed'));
      send({ type: 'state' });
      return true;
    },
    async rearm() {
      await load();
      doc.killed = false; doc.killedAt = null;
      for (const r of doc.recs.filter(x => x.enabled && x.schedule.kind !== 'none')) { r.nextAt = computeNext(r.schedule, now()); await registerOs(r); }
      await persist(); arm(); send({ type: 'state' });
      return true;
    },

    async save(raw) {
      await load();
      const clean = Model.normalizeRecording(raw);
      await checkRoute(clean.partition);
      const old = doc.recs.find(r => r.id === clean.id);
      if (!old && doc.recs.length >= 40) throw new Error('There is room for 40 automations; delete one first');
      if (old) { clean.createdAt = old.createdAt; clean.lastRunAt = old.lastRunAt; clean.lastStatus = old.lastStatus; }
      clean.nextAt = clean.enabled && clean.schedule.kind !== 'none' ? computeNext(clean.schedule, now()) : null;
      if (old) doc.recs[doc.recs.indexOf(old)] = clean; else doc.recs.push(clean);
      if (doc.enabled && !doc.killed && clean.nextAt != null) await registerOs(clean);
      else { await unregisterOs(clean.id); clean.os = { scheduled: false, error: null }; }
      await persist(); arm(); send({ type: 'state' });
      return JSON.parse(JSON.stringify(clean));
    },

    async remove(id) {
      await load();
      const rec = findRec(id);
      if (active && active.recId === id) throw new Error('That automation is running; stop it first');
      doc.recs.splice(doc.recs.indexOf(rec), 1);
      doc.runs = doc.runs.filter(r => r.recId !== id);
      const osError = await unregisterOs(id);
      await persist(); arm(); send({ type: 'state' });
      return { ok: true, osError };
    },

    // Starts a run and returns at once; { done } settles when it ends.
    start,
    // Resolves { runId, done } once the run is accepted; rejects with the reason if it is refused.
    async startNow(id, opts) { const r = start(id, opts); const runId = await r.started; return { runId, done: r.done }; },

    stop() {
      if (!active) return false;
      active.stop = true;
      const entry = approvals.get(active.runId); if (entry) entry.resolve('stop');
      return true;
    },

    decide(runId, decision) {
      if (!['approve', 'skip', 'stop'].includes(decision)) throw new Error('The answer must be approve, skip or stop');
      const entry = approvals.get(runId);
      if (!entry) throw new Error('That prompt is no longer open');
      entry.resolve(decision);
      return true;
    },

    async runs(recId) {
      await load();
      return doc.runs.filter(r => !recId || r.recId === recId).map(summary);
    },
    async runGet(runId) {
      await load();
      const r = doc.runs.find(x => x.id === runId);
      if (!r) throw new Error('That run is no longer in the log');
      return JSON.parse(JSON.stringify(r));
    },
    async ack(ids) {
      await load();
      const set = new Set(ids);
      let n = 0;
      for (const r of doc.runs) if (set.has(r.id) && !r.delivered) { r.delivered = true; n++; }
      if (n) await persist();
      return n;
    },

    async exportOne(id) { await load(); return JSON.stringify(Model.exportRecording(findRec(id)), null, 2); },
    async importText(text) { await load(); return api.save(Model.importRecording(text)); },

    checkDue: () => fireDue(),
    hasActive: () => !!active,
    stopTimers() { stopped = true; if (timer) { clearT(timer); timer = null; } },
  };
  return api;
}

module.exports = { createAutomations, computeNext, CHECK_MS };
