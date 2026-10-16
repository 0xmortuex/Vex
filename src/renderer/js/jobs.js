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

  // deferOnBattery: true marks a job that may wait while battery-aware mode
  // is saving power (js/battery-mode.js). Nothing else is ever held for it:
  // the lock-when-idle check, the Discord call badge and the workspace
  // snapshot are not marked.
  // feature: the id of the feature that owns the job (its manifest in
  // js/feature-registry.js names its jobs too). Failures and time are counted
  // against it; when it is switched off for repeated failures or an overrun
  // (js/vex-breaker.js) its jobs wait out the cool-down.
  every(name, ms, fn, { when = 'ui', deferOnBattery = false, feature = '' } = {}) {
    if (typeof fn !== 'function') throw new Error('VexJobs.every: ' + name + ' has no function');
    if (!(ms > 0)) throw new Error('VexJobs.every: ' + name + ' needs an interval');
    if (when !== 'ui' && when !== 'background') throw new Error('VexJobs.every: unknown kind ' + when);
    const owner = feature || (typeof VexRegistry !== 'undefined' ? VexRegistry.forJob(name) : null) || '';
    const job = { name, ms, fn, when, feature: owner, deferOnBattery: !!deferOnBattery, next: Date.now() + ms, owed: false, running: false, runs: 0, held: 0 };
    this._jobs.set(name, job);
    job.since = Date.now();
    this._start();
    return { stop: () => this.stop(name) };
  },

  stop(name) { this._jobs.delete(name); this._arm(); },

  // Why a job of this kind should wait right now, or '' to run it.
  heldBecause(when, job) {
    const gaming = typeof GameMode !== 'undefined' && GameMode.gaming;
    if (gaming) return 'a game is running';
    if (typeof CommitGuard !== 'undefined' && CommitGuard.holding()) return 'Windows is short of memory';
    if (job && job.deferOnBattery && typeof BatteryMode !== 'undefined' && BatteryMode.holdingJobs()) return 'saving battery';
    if (when === 'ui' && typeof document !== 'undefined' && document.hidden) return 'Vex is hidden';
    return '';
  },

  // What the job is counted under: its feature, else the job itself.
  _key(job) { return job.feature || 'job:' + job.name; },
  // Switched off by the breaker (repeated failures or a budget overrun): not run
  // and not owed — it gets a fresh start when the cool-down ends.
  _tripped(job) { return typeof VexBreaker !== 'undefined' && VexBreaker.isTripped(this._key(job)); },

  tick(now = Date.now()) {
    if (typeof VexBreaker !== 'undefined') VexBreaker.sweep();
    if (typeof VexCost !== 'undefined') VexCost.tick();
    for (const job of this._jobs.values()) {
      if (now < job.next) continue;
      job.next = now + job.ms;
      if (this._tripped(job)) continue;
      if (this.heldBecause(job.when, job)) { job.owed = true; job.held++; continue; }
      this._run(job);
    }
    this._pumpHeavy();
  },

  // The reason went away: every owed job runs once, now — and so does one
  // that fell due while held (_arm sets no timer for those, so tick() never
  // got to mark it owed).
  resume() {
    const now = Date.now();
    for (const job of this._jobs.values()) {
      if (this.heldBecause(job.when, job)) continue;
      if (this._tripped(job)) continue;
      if (!job.owed && job.next > now) continue;
      if (!job.owed) job.held++;
      job.next = now + job.ms;
      this._run(job);
    }
    this._arm();
    this._pumpHeavy();
  },

  _run(job) {
    job.owed = false;
    if (job.running) return;            // the last run is still going
    job.running = true;
    job.runs++;
    const key = this._key(job);
    const done = () => { job.running = false; if (typeof VexBreaker !== 'undefined') VexBreaker.ok(key); };
    const failed = (err) => {
      job.running = false;
      window.VexProblems?.note('Background job', job.name + ' failed', err);
      if (typeof VexBreaker !== 'undefined') VexBreaker.fail(key, err);
    };
    // The time the job held the interface thread: the synchronous part only.
    // What an async job awaits (a network reply) costs the thread nothing, so
    // it is not counted. Read by timings() for the tuning advisor.
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const took = () => {
      const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      job.totalMs = (job.totalMs || 0) + ms;
      if (ms > (job.maxMs || 0)) job.maxMs = ms;
      if (typeof VexCost !== 'undefined') VexCost.job(job.feature, ms);
    };
    try {
      const r = typeof VexCost !== 'undefined' ? VexCost.run(job.feature, job.fn) : job.fn();
      took();
      if (r && typeof r.then === 'function') r.then(done, failed);
      else done();
    } catch (err) { took(); failed(err); }
  },

  // Per-job cost since the first job was registered. → [{ name, runs, held,
  // totalMs, maxMs, spanMs }]
  timings(now = Date.now()) {
    return [...this._jobs.values()].map(j => ({ name: j.name, feature: j.feature || '', runs: j.runs, held: j.held, totalMs: j.totalMs || 0, maxMs: j.maxMs || 0, spanMs: Math.max(0, now - (j.since || now)) }));
  },

  _start() {
    if (!this._wired && typeof document !== 'undefined') {
      this._wired = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume(); });
      // Heavy work waits for a quiet moment: any key, click or scroll is "not idle".
      const seen = () => { this._lastInput = Date.now(); };
      for (const ev of ['keydown', 'pointerdown', 'wheel']) document.addEventListener(ev, seen, { capture: true, passive: true });
    }
    this._arm();
  },

  // One timer, set for the next job that is due — not a tick every second.
  // The jobs run every half-minute or more, so a 1 s tick woke Vex sixty
  // times a minute to find nothing due. TICK_MS stays the shortest wait, so
  // jobs due together still run together.
  // A held job does not count: it cannot run until the game ends or the
  // window shows again, and both call resume(). Counting it woke Vex every
  // second through a whole game just to hold the zoom indicator again.
  _arm() {
    if (this._tick) { clearTimeout(this._tick); this._tick = null; }
    if (!this._jobs.size) return;
    let next = Infinity;
    for (const job of this._jobs.values()) {
      if (this._tripped(job)) {
        const until = VexBreaker.untilOf(this._key(job));
        if (until && until < next) next = until;
        continue;
      }
      if (this.heldBecause(job.when, job)) continue;
      if (job.next < next) next = job.next;
    }
    if (next === Infinity) return;
    const wait = Math.min(Math.max(this.TICK_MS, next - Date.now()), 2147483647);
    this._tick = setTimeout(() => { this._tick = null; this.tick(); this._arm(); }, wait);
  },

  // === Heavy work: indexing, OCR, local AI, summaries, audio digests =========
  //
  // VexJobs.every runs small repeating jobs on one timer. Work that can load a
  // processor core or a graphics card for seconds goes through heavy() instead:
  //
  //   const r = await VexJobs.heavy('Knowledge base index', () => this.tick(), { kind: 'index', feature: 'knowledge-base' });
  //   // r = { ran: true, value } or { ran: false, reason }
  //
  // It runs ONE at a time, and only when all of these hold:
  //   - no game is running (Game mode);
  //   - committed memory is not low (setMemoryPressure(), filled in by the
  //     memory guard; until something sets it, memory is never the reason);
  //   - Vex is not saving battery, and nobody has pressed a key, clicked or
  //     scrolled in the last HEAVY_IDLE_MS;
  //   - the feature is not switched off by the breaker.
  // When it may not run now:
  //   kinds 'index' | 'ocr' | 'local-ai' | 'summary' | 'audio'   → refused when
  //       a game is running or memory is low: the promise resolves
  //       { ran: false, reason } and the caller's own schedule asks again later
  //       (waiting would pile work up behind a game). Merely "you are busy"
  //       only delays it a few seconds.
  //   kind 'ai-ask' (an AI question you asked)                   → queued until
  //       the game ends / memory recovers, then run;
  //   { backlog: true }                                          → waits for
  //       the overnight window (BACKLOG_FROM..BACKLOG_TO local hours) with the
  //       machine on mains power, however long that takes.
  HEAVY_IDLE_MS: 4000,
  HEAVY_POLL_MS: 3000,
  BACKLOG_FROM: 1,
  BACKLOG_TO: 6,
  HEAVY_KINDS: ['index', 'ocr', 'local-ai', 'summary', 'audio', 'ai-ask'],
  _heavy: [],
  _heavyRunning: false,
  _heavyTimer: null,
  _memoryPressure: null,
  _lastInput: 0,

  // Another module fills this: fn() → falsy, or a reason string / { low: true,
  // reason } when committed memory is low. Called each time heavy work is
  // considered; one that throws is reported and counted as "not low" for that
  // call, never silently dropped.
  setMemoryPressure(fn) {
    if (fn != null && typeof fn !== 'function') throw new Error('setMemoryPressure needs a function');
    this._memoryPressure = fn || null;
  },

  memoryLow() {
    if (!this._memoryPressure) return '';
    let v;
    try { v = this._memoryPressure(); }
    catch (err) { console.error('[VexJobs] the memory pressure check failed:', err); window.VexProblems?.note('Background job', 'The memory check failed', err); return ''; }
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (v && v.low) return String(v.reason || 'memory is low');
    return '';
  },

  _pluggedIn() {
    if (typeof BatteryMode === 'undefined' || !BatteryMode.hw) return true;     // no battery information: a desktop
    return BatteryMode.hw.hasBattery === false || BatteryMode.hw.onBattery === false;
  },
  _overnight(now = new Date()) { const h = now.getHours(); return h >= this.BACKLOG_FROM && h < this.BACKLOG_TO; },

  // Why this item may not run right now ('' = go).
  _heavyBlock(item, now = Date.now()) {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return 'a game is running';
    const mem = this.memoryLow();
    if (mem) return mem;
    if (item.feature && typeof VexBreaker !== 'undefined' && VexBreaker.isTripped(item.feature)) return 'it was switched off after repeated failures';
    if (item.kind === 'ai-ask') return '';           // a question you asked: not held for idleness or power
    if (typeof BatteryMode !== 'undefined' && BatteryMode.holdingJobs && BatteryMode.holdingJobs()) return 'saving battery';
    if (item.backlog) {
      if (!this._overnight(new Date(now))) return 'it waits for the night';
      if (!this._pluggedIn()) return 'it waits for the charger';
    }
    if (typeof document !== 'undefined' && document.hidden) return '';       // nobody is looking: idle by definition
    if (now - this._lastInput < this.HEAVY_IDLE_MS) return 'you are using Vex';
    return '';
  },

  heavy(name, fn, { kind = 'index', feature = '', backlog = false } = {}) {
    if (typeof name !== 'string' || !name) throw new Error('VexJobs.heavy needs a name');
    if (typeof fn !== 'function') throw new Error('VexJobs.heavy: ' + name + ' has no function');
    if (!this.HEAVY_KINDS.includes(kind)) throw new Error('VexJobs.heavy: unknown kind ' + kind);
    const owner = feature || (typeof VexRegistry !== 'undefined' ? VexRegistry.forJob(name) : null) || '';
    return new Promise((resolve, reject) => {
      const item = { name, fn, kind, feature: owner, backlog: !!backlog, wait: kind === 'ai-ask' || !!backlog, resolve, reject, at: Date.now() };
      const why = this._heavyBlock(item);
      // A refusal that does not wait is answered at once, and never queued.
      if (why && !item.wait && why !== 'you are using Vex') { resolve({ ran: false, reason: why }); return; }
      this._heavy.push(item);
      this._pumpHeavy();
    });
  },

  heavyQueue() { return this._heavy.map(i => ({ name: i.name, kind: i.kind, feature: i.feature, backlog: i.backlog, waitingMs: Date.now() - i.at })); },

  _pumpHeavy() {
    if (this._heavyTimer) { clearTimeout(this._heavyTimer); this._heavyTimer = null; }
    if (!this._heavy.length) return;
    if (!this._heavyRunning) {
      const now = Date.now();
      for (let i = 0; i < this._heavy.length; i++) {
        const item = this._heavy[i];
        const why = this._heavyBlock(item, now);
        if (why && !item.wait && why !== 'you are using Vex') {
          // A game started or memory fell while it waited for a quiet moment: refused.
          this._heavy.splice(i--, 1);
          item.resolve({ ran: false, reason: why });
          continue;
        }
        if (why) continue;
        this._heavy.splice(i, 1);
        this._runHeavy(item);
        break;
      }
    }
    if (this._heavy.length) this._heavyTimer = setTimeout(() => { this._heavyTimer = null; this._pumpHeavy(); }, this.HEAVY_POLL_MS);
  },

  _runHeavy(item) {
    this._heavyRunning = true;
    const key = item.feature || 'job:' + item.name;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const finish = () => {
      this._heavyRunning = false;
      if (typeof VexCost !== 'undefined') VexCost.job(item.feature, ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      this._pumpHeavy();
    };
    const ok = (value) => { if (typeof VexBreaker !== 'undefined') VexBreaker.ok(key); finish(); item.resolve({ ran: true, value }); };
    const bad = (err) => {
      window.VexProblems?.note('Background job', item.name + ' failed', err);
      if (typeof VexBreaker !== 'undefined') VexBreaker.fail(key, err);
      finish();
      item.reject(err);
    };
    try {
      const r = typeof VexCost !== 'undefined' ? VexCost.run(item.feature, item.fn) : item.fn();
      if (r && typeof r.then === 'function') r.then(ok, bad); else ok(r);
    } catch (err) { bad(err); }
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
