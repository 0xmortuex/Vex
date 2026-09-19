// === One place for Vex's periodic work ======================================
//
// Every panel and helper used to start its own setInterval, and every one of
// them kept firing while Vex was minimised and while a game had the screen:
// refreshing counters nobody could see, sweeping badges on hidden panels.
//
// A job registered here runs on one shared tick, and is HELD — not dropped —
// when running it would be wasted:
//   'ui'          only matters on screen: held while Vex's window is hidden or
//                 a game is running.
//   'background'  does its work whether you look or not (a page watch, tabs
//                 sent from your phone): held only while a game is running.
// A held job is owed one run, and gets it as soon as the reason goes away.
//
// Essential timers (reminders, the clock, timers you started, sync, sleeping
// tabs for memory) stay on their own and are not registered here.
const VexJobs = {
  TICK_MS: 1000,
  _jobs: new Map(),
  _tick: null,

  every(name, ms, fn, { when = 'ui' } = {}) {
    if (typeof fn !== 'function') throw new Error('VexJobs.every: ' + name + ' has no function');
    if (!(ms > 0)) throw new Error('VexJobs.every: ' + name + ' needs an interval');
    if (when !== 'ui' && when !== 'background') throw new Error('VexJobs.every: unknown kind ' + when);
    const job = { name, ms, fn, when, next: Date.now() + ms, owed: false, running: false, runs: 0, held: 0 };
    this._jobs.set(name, job);
    this._start();
    return { stop: () => this.stop(name) };
  },

  stop(name) { this._jobs.delete(name); },

  // Why a job of this kind should wait right now, or '' to run it.
  heldBecause(when) {
    const gaming = typeof GameMode !== 'undefined' && GameMode.gaming;
    if (gaming) return 'a game is running';
    if (when === 'ui' && typeof document !== 'undefined' && document.hidden) return 'Vex is hidden';
    return '';
  },

  tick(now = Date.now()) {
    for (const job of this._jobs.values()) {
      if (now < job.next) continue;
      job.next = now + job.ms;
      if (this.heldBecause(job.when)) { job.owed = true; job.held++; continue; }
      this._run(job);
    }
  },

  // The reason went away: every owed job runs once, now.
  resume() {
    for (const job of this._jobs.values()) {
      if (!job.owed || this.heldBecause(job.when)) continue;
      job.next = Date.now() + job.ms;
      this._run(job);
    }
  },

  _run(job) {
    job.owed = false;
    if (job.running) return;            // the last run is still going
    job.running = true;
    job.runs++;
    const done = () => { job.running = false; };
    const failed = (err) => { job.running = false; window.VexProblems?.note('Background job', job.name + ' failed', err); };
    try {
      const r = job.fn();
      if (r && typeof r.then === 'function') r.then(done, failed);
      else done();
    } catch (err) { failed(err); }
  },

  _start() {
    if (this._tick) return;
    this._tick = setInterval(() => this.tick(), this.TICK_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume(); });
  },

  // For Memory › Health.
  lines() {
    const jobs = [...this._jobs.values()];
    if (!jobs.length) return [];
    const owed = jobs.filter(j => j.owed);
    const held = jobs.reduce((n, j) => n + j.held, 0);
    return [`Background jobs: ${jobs.length} on one timer${held ? ` — ${held} run${held === 1 ? '' : 's'} held back while Vex was hidden or you were gaming` : ''}${owed.length ? `, ${owed.length} waiting to catch up` : ''}`];
  },
};

if (typeof window !== 'undefined') window.VexJobs = VexJobs;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexJobs };
