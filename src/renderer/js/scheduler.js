// === Vex Scheduler Engine ===
//
// Runs saved tasks on a schedule. Task definitions live in localStorage
// ('vex.schedules'); run records in 'vex.scheduleHistory'. A 20s poll asks each
// enabled task for its most recent occurrence at-or-before now and fires it once.
//
// Two invariants the engine is built around:
//   * NO DUPLICATE RUNS — before a run starts, the occurrence it belongs to is
//     written to task.lastOccurrence and persisted. A crash, a restart mid-run,
//     or a second poll can never fire the same occurrence twice.
//   * NO SILENT DRIFT / NO SILENT LOSS — occurrences are computed from local
//     wall-clock fields (never by adding 86400000), so a DST jump does not move
//     "09:00 daily". An occurrence missed while the app was closed is either
//     caught up (within the task's catch-up window) or recorded in history as
//     'skipped' — it is never dropped without a trace.
//
// Schedule types: interval / daily / weekly / monthly / once / cron.
// Action types: agent, openUrls, reload, sleepTabs, saveSession,
//               clearBrowsingData, reminder.
//
// Public API: Scheduler (singleton — start, stop, createTask, updateTask,
// deleteTask, setEnabled, duplicateTask, runTask, calculateNextRun,
// nextOccurrence, prevOccurrence, parseCron, validate, describeSchedule,
// describeNextRun, describeAction, getAllTasks, getTask, getHistory,
// getTaskHistory, clearHistory, ACTIONS, SCHEDULE_TYPES).
// Depends on AgentLoop, TabManager, WebviewManager, SessionManager (each is
// optional at call time — a missing dependency fails that run, not the engine).

const Scheduler = {
  STORAGE_KEY: 'vex.schedules',
  HISTORY_KEY: 'vex.scheduleHistory',
  POLL_MS: 20000,
  MAX_HISTORY: 300,
  MAX_QUEUE: 50,
  // A run more than this late is skipped even when catch-up is on, so a laptop
  // that slept for a week does not wake into a stampede.
  MAX_CATCHUP_MIN: 7 * 24 * 60,
  // With catch-up off a task still tolerates a little lateness, otherwise an
  // occurrence landing between two polls would never fire at all.
  NO_CATCHUP_GRACE_MS: 90000,

  _interval: null,
  _startup: null,
  _running: new Set(),
  _controllers: new Map(),
  _queue: [],
  _draining: false,

  SCHEDULE_TYPES: ['interval', 'daily', 'weekly', 'monthly', 'once', 'cron'],

  // ---------------------------------------------------------------- lifecycle

  start() {
    if (window.VexTabPolicy?.isPrivateWindow) return;
    if (this._interval) return;
    this._interval = setInterval(() => this._checkDueTasks(), this.POLL_MS);
    // Deliberately delayed: TabManager/AgentLoop/SessionManager finish wiring
    // after the scheduler starts, and a catch-up run needs them.
    this._startup = setTimeout(() => { this._startup = null; this._checkDueTasks(); }, 5000);
    console.log('[Scheduler] Started');
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    clearTimeout(this._startup); this._startup = null;
    for (const entry of this._queue.splice(0)) entry.reject?.(new Error('Scheduler stopped'));
    for (const controller of this._controllers.values()) controller.abort(new Error('Scheduler stopped'));
  },

  cancelTask(id) {
    this._queue = this._queue.filter(entry => {
      if (entry.task.id !== id) return true;
      entry.reject?.(new Error('Task cancelled'));
      return false;
    });
    this._controllers.get(id)?.abort(new Error('Task cancelled'));
  },

  isRunning(id) { return this._running.has(id); },
  isQueued(id) { return this._queue.some(entry => entry.task.id === id); },

  _emit() {
    try { window.dispatchEvent(new CustomEvent('vex-schedules-changed')); } catch { /* no DOM in unit tests */ }
  },

  // ------------------------------------------------------------------ storage

  getAllTasks() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    let changed = false;
    const tasks = raw.map(task => {
      const migrated = this._migrate(task);
      if (migrated !== task) changed = true;
      return migrated;
    });
    if (changed) { try { this._save(tasks); } catch { /* keep the in-memory migration */ } }
    return tasks;
  },

  getTask(id) { return this.getAllTasks().find(t => t.id === id) || null; },

  // localStorage can throw (quota, private mode). Losing the task list silently
  // is worse than a visible failure, so this surfaces instead of swallowing.
  _save(tasks) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      window.showToast?.('Could not save scheduled tasks: ' + err.message);
      throw err;
    }
  },

  // v1 tasks stored the schedule as flat frequency/time/daysOfWeek/dayOfMonth/
  // customCron/startDate fields and had exactly one implicit action (run the
  // agent on `prompt`). Lift both into the v2 shape, in place, on read.
  _migrate(task) {
    if (!task || typeof task !== 'object') return task;
    if (task.v === 2 && task.schedule && task.action) return task;
    const requested = task.schedule?.type || task.frequency || 'daily';
    const type = requested === 'custom' ? 'cron' : requested;
    // An unrecognised type is preserved verbatim rather than coerced to
    // 'daily': a task whose schedule we cannot read must go quiet (and show
    // "Not scheduled"), not silently start firing on a schedule nobody chose.
    const schedule = task.schedule ? { ...task.schedule, type } : {
      type,
      time: task.time || '09:00',
      daysOfWeek: Array.isArray(task.daysOfWeek) ? task.daysOfWeek.slice() : [],
      dayOfMonth: task.dayOfMonth || 1,
      date: task.startDate || new Date().toISOString().slice(0, 10),
      cron: task.customCron || '',
      everyMinutes: 60,
      anchor: Date.parse(task.createdAt || '') || Date.now(),
    };
    const action = task.action || {
      type: 'agent',
      prompt: task.prompt || '',
      startingUrl: task.startingUrl || '',
      maxIterations: task.maxIterations || 15,
    };
    return {
      ...task,
      v: 2,
      schedule,
      action,
      catchUp: task.catchUp === undefined ? true : !!task.catchUp,
      catchUpWindowMin: task.catchUpWindowMin || 720,
      lastOccurrence: task.lastOccurrence || null,
      failCount: task.failCount || 0,
    };
  },

  _normalizeSchedule(input, fallback) {
    const base = fallback || {};
    const raw = input || {};
    const requested = raw.type === 'custom' ? 'cron' : raw.type;
    const type = this.SCHEDULE_TYPES.includes(requested) ? requested : (base.type || 'daily');
    const time = /^\d{1,2}:\d{2}$/.test(raw.time || '') ? raw.time : (base.time || '09:00');
    const days = Array.isArray(raw.daysOfWeek)
      ? raw.daysOfWeek.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      : (base.daysOfWeek || []);
    return {
      type,
      time,
      daysOfWeek: [...new Set(days)].sort((a, b) => a - b),
      // 'last' pins to the final day of each month — the only sane reading of
      // "the 31st" in February.
      dayOfMonth: raw.dayOfMonth === 'last'
        ? 'last'
        : Math.min(31, Math.max(1, Number(raw.dayOfMonth) || Number(base.dayOfMonth) || 1)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : (base.date || new Date().toISOString().slice(0, 10)),
      cron: typeof raw.cron === 'string' ? raw.cron.trim() : (base.cron || ''),
      everyMinutes: Math.min(60 * 24 * 30, Math.max(1, Number(raw.everyMinutes) || Number(base.everyMinutes) || 60)),
      anchor: Number(raw.anchor) || Number(base.anchor) || Date.now(),
    };
  },

  createTask(data) {
    const tasks = this.getAllTasks();
    const schedule = this._normalizeSchedule(data.schedule || {
      type: data.frequency, time: data.time, daysOfWeek: data.daysOfWeek,
      dayOfMonth: data.dayOfMonth, date: data.startDate, cron: data.customCron,
    });
    const task = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      v: 2,
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString(),
      name: data.name || 'Untitled Task',
      description: data.description || '',
      schedule,
      action: data.action || {
        type: 'agent',
        prompt: data.prompt || '',
        startingUrl: data.startingUrl || '',
        maxIterations: data.maxIterations || 15,
      },
      catchUp: data.catchUp !== false,
      catchUpWindowMin: Math.min(this.MAX_CATCHUP_MIN, Math.max(1, Number(data.catchUpWindowMin) || 720)),
      notifyOnComplete: data.notifyOnComplete !== false,
      notifyOnFail: data.notifyOnFail !== false,
      lastOccurrence: null,
      lastRunAt: null,
      lastRunResult: null,
      runCount: 0,
      failCount: 0,
    };
    // Claim every occurrence that predates the task, so a brand-new "daily at
    // 09:00" created at 14:00 does not immediately report this morning as missed.
    const prior = this.prevOccurrence(task, Date.now());
    task.lastOccurrence = prior === null ? null : new Date(prior).toISOString();
    tasks.push(task);
    this._save(tasks);
    this._emit();
    return task;
  },

  updateTask(id, updates) {
    const tasks = this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    const task = tasks[idx];
    const next = { ...task, ...updates };
    if (updates.schedule) {
      next.schedule = this._normalizeSchedule(updates.schedule, task.schedule);
      // A changed schedule invalidates the old claim: re-baseline so the new
      // schedule neither replays its past nor skips its next occurrence.
      if (JSON.stringify(next.schedule) !== JSON.stringify(task.schedule)) {
        const prior = this.prevOccurrence(next, Date.now());
        next.lastOccurrence = prior === null ? null : new Date(prior).toISOString();
      }
    }
    if (updates.catchUpWindowMin !== undefined) {
      next.catchUpWindowMin = Math.min(this.MAX_CATCHUP_MIN, Math.max(1, Number(updates.catchUpWindowMin) || 720));
    }
    tasks[idx] = next;
    this._save(tasks);
    this._emit();
    return next;
  },

  setEnabled(id, enabled) {
    const task = this.getTask(id);
    if (!task) return null;
    const patch = { enabled: !!enabled };
    // Re-arming a paused task must not replay everything it slept through.
    if (enabled && !task.enabled) {
      const prior = this.prevOccurrence(task, Date.now());
      patch.lastOccurrence = prior === null ? null : new Date(prior).toISOString();
    }
    return this.updateTask(id, patch);
  },

  deleteTask(id) {
    this.cancelTask(id);
    this._save(this.getAllTasks().filter(t => t.id !== id));
    this._emit();
  },

  duplicateTask(id) {
    const task = this.getTask(id);
    if (!task) return null;
    return this.createTask({
      name: task.name + ' (copy)',
      description: task.description,
      schedule: { ...task.schedule, anchor: Date.now() },
      action: { ...task.action },
      catchUp: task.catchUp,
      catchUpWindowMin: task.catchUpWindowMin,
      notifyOnComplete: task.notifyOnComplete,
      notifyOnFail: task.notifyOnFail,
      enabled: false,
    });
  },

  // ------------------------------------------------- occurrence computation
  //
  // Everything below is pure: (task, timestamp) -> timestamp | null. All local
  // wall-clock arithmetic goes through the Date(y, m, d, h, min) constructor,
  // which normalises overflow and keeps the intended clock time across a DST
  // transition. Nothing adds a fixed number of milliseconds except `interval`,
  // where a fixed duration is exactly what the user asked for.

  _hm(schedule) {
    const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
    return [Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0];
  },

  _daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); },

  _monthDay(schedule, year, monthIndex) {
    const dim = this._daysInMonth(year, monthIndex);
    if (schedule.dayOfMonth === 'last') return dim;
    return Math.min(Number(schedule.dayOfMonth) || 1, dim);
  },

  _onceAt(schedule) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.date || '');
    if (!m) return null;
    const [h, min] = this._hm(schedule);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, 0, 0).getTime();
  },

  // First occurrence strictly after `fromMs`. Returns ms or null.
  nextOccurrence(task, fromMs) {
    const t = this._migrate(task);
    const s = t.schedule;
    const from = Number(fromMs);
    if (!Number.isFinite(from)) return null;
    const [h, min] = this._hm(s);

    if (s.type === 'once') {
      const at = this._onceAt(s);
      if (at === null) return null;
      if ((t.runCount || 0) > 0) return null;
      if (t.lastOccurrence && Date.parse(t.lastOccurrence) >= at) return null;
      return at > from ? at : null;
    }

    if (s.type === 'interval') {
      const step = Math.max(1, Number(s.everyMinutes) || 60) * 60000;
      const anchor = Number(s.anchor) || from;
      if (from < anchor) return anchor;
      return anchor + (Math.floor((from - anchor) / step) + 1) * step;
    }

    if (s.type === 'daily') {
      const d = new Date(from);
      for (let i = 0; i < 3; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, min, 0, 0).getTime();
        if (c > from) return c;
      }
      return null;
    }

    if (s.type === 'weekly') {
      const days = s.daysOfWeek || [];
      if (!days.length) return null;
      const d = new Date(from);
      for (let i = 0; i < 8; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, min, 0, 0);
        if (c.getTime() > from && days.includes(c.getDay())) return c.getTime();
      }
      return null;
    }

    if (s.type === 'monthly') {
      const d = new Date(from);
      for (let i = 0; i < 14; i++) {
        const probe = new Date(d.getFullYear(), d.getMonth() + i, 1);
        const day = this._monthDay(s, probe.getFullYear(), probe.getMonth());
        const c = new Date(probe.getFullYear(), probe.getMonth(), day, h, min, 0, 0).getTime();
        if (c > from) return c;
      }
      return null;
    }

    if (s.type === 'cron') return this._cronNext(s.cron, from);

    return null;
  },

  // Most recent occurrence at or before `atMs`. Returns ms or null.
  prevOccurrence(task, atMs) {
    const t = this._migrate(task);
    const s = t.schedule;
    const at = Number(atMs);
    if (!Number.isFinite(at)) return null;
    const [h, min] = this._hm(s);

    if (s.type === 'once') {
      const on = this._onceAt(s);
      return on !== null && on <= at ? on : null;
    }

    if (s.type === 'interval') {
      const step = Math.max(1, Number(s.everyMinutes) || 60) * 60000;
      const anchor = Number(s.anchor) || at;
      if (at < anchor) return null;
      return anchor + Math.floor((at - anchor) / step) * step;
    }

    if (s.type === 'daily') {
      const d = new Date(at);
      for (let i = 0; i < 3; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, h, min, 0, 0).getTime();
        if (c <= at) return c;
      }
      return null;
    }

    if (s.type === 'weekly') {
      const days = s.daysOfWeek || [];
      if (!days.length) return null;
      const d = new Date(at);
      for (let i = 0; i < 8; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, h, min, 0, 0);
        if (c.getTime() <= at && days.includes(c.getDay())) return c.getTime();
      }
      return null;
    }

    if (s.type === 'monthly') {
      const d = new Date(at);
      for (let i = 0; i < 14; i++) {
        const probe = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const day = this._monthDay(s, probe.getFullYear(), probe.getMonth());
        const c = new Date(probe.getFullYear(), probe.getMonth(), day, h, min, 0, 0).getTime();
        if (c <= at) return c;
      }
      return null;
    }

    if (s.type === 'cron') return this._cronPrev(s.cron, at);

    return null;
  },

  // Back-compat wrapper (v1 callers and the panel): the next run as a Date.
  calculateNextRun(task, fromMs) {
    const ms = this.nextOccurrence(task, fromMs === undefined ? Date.now() : fromMs);
    return ms === null ? null : new Date(ms);
  },

  // --------------------------------------------------------------------- cron

  CRON_DOW_NAMES: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
  CRON_MONTH_NAMES: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },

  _cronValue(token, names) {
    if (/^\d+$/.test(token)) return Number(token);
    const named = names && names[String(token).toLowerCase()];
    return named === undefined ? null : named;
  },

  _cronField(spec, min, max, names) {
    const out = new Set();
    for (const seg of String(spec).split(',')) {
      const m = /^(\*|\d+|[a-zA-Z]{3})(?:-(\d+|[a-zA-Z]{3}))?(?:\/(\d+))?$/.exec(seg.trim());
      if (!m) return null;
      const step = m[3] === undefined ? 1 : Number(m[3]);
      if (!(step >= 1)) return null;
      let lo, hi;
      if (m[1] === '*') { lo = min; hi = max; }
      else {
        lo = this._cronValue(m[1], names);
        if (lo === null) return null;
        if (m[2] !== undefined) { hi = this._cronValue(m[2], names); if (hi === null) return null; }
        else hi = m[3] === undefined ? lo : max;
      }
      if (lo < min || hi > max || lo > hi) return null;
      for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out.size ? out : null;
  },

  // Returns { minute, hour, dom, month, dow, domRestricted, dowRestricted } or null.
  parseCron(expr) {
    const parts = String(expr || '').trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const minute = this._cronField(parts[0], 0, 59, null);
    const hour = this._cronField(parts[1], 0, 23, null);
    const dom = this._cronField(parts[2], 1, 31, null);
    const month = this._cronField(parts[3], 1, 12, this.CRON_MONTH_NAMES);
    const dowRaw = this._cronField(parts[4], 0, 7, this.CRON_DOW_NAMES);
    if (!minute || !hour || !dom || !month || !dowRaw) return null;
    return {
      minute: [...minute].sort((a, b) => a - b),
      hour: [...hour].sort((a, b) => a - b),
      dom,
      month,
      dow: new Set([...dowRaw].map(v => (v === 7 ? 0 : v))),
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*',
    };
  },

  // Vixie semantics: when BOTH day-of-month and day-of-week are restricted the
  // day matches if EITHER matches; otherwise the unrestricted field is ignored.
  _cronDayMatches(f, date) {
    if (!f.month.has(date.getMonth() + 1)) return false;
    if (f.domRestricted && f.dowRestricted) return f.dom.has(date.getDate()) || f.dow.has(date.getDay());
    if (f.domRestricted) return f.dom.has(date.getDate());
    if (f.dowRestricted) return f.dow.has(date.getDay());
    return true;
  },

  _cronNext(expr, fromMs) {
    const f = this.parseCron(expr);
    if (!f) return null;
    const start = new Date(fromMs);
    for (let i = 0; i < 400; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (!this._cronDayMatches(f, day)) continue;
      for (const h of f.hour) {
        for (const m of f.minute) {
          const c = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).getTime();
          if (c > fromMs) return c;
        }
      }
    }
    return null;
  },

  _cronPrev(expr, atMs) {
    const f = this.parseCron(expr);
    if (!f) return null;
    const start = new Date(atMs);
    for (let i = 0; i < 400; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i);
      if (!this._cronDayMatches(f, day)) continue;
      for (let hi = f.hour.length - 1; hi >= 0; hi--) {
        for (let mi = f.minute.length - 1; mi >= 0; mi--) {
          const c = new Date(day.getFullYear(), day.getMonth(), day.getDate(), f.hour[hi], f.minute[mi], 0, 0).getTime();
          if (c <= atMs) return c;
        }
      }
    }
    return null;
  },

  // --------------------------------------------------------------- validation

  validate(data) {
    const errors = [];
    if (!String(data.name || '').trim()) errors.push('Give the task a name');
    const s = this._normalizeSchedule(data.schedule);
    if (s.type === 'weekly' && !(s.daysOfWeek || []).length) errors.push('Pick at least one day of the week');
    if (s.type === 'cron' && !this.parseCron(s.cron)) errors.push('Cron needs five valid fields, e.g. 0 9 * * 1-5');
    if (s.type === 'once') {
      const at = this._onceAt(s);
      if (at === null) errors.push('Pick a date for the one-off run');
      else if (at <= Date.now()) errors.push('That date and time has already passed');
    }
    const action = data.action || {};
    const spec = this.ACTIONS[action.type];
    if (!spec) errors.push('Pick what the task should do');
    else errors.push(...spec.validate(action));
    return errors;
  },

  // ------------------------------------------------------------------ actions

  _webUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('URL is empty');
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
    let url;
    try { url = new URL(withScheme); } catch { throw new Error('Not a valid URL: ' + raw); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs can be opened: ' + raw);
    return url.href;
  },

  _urlList(action) {
    return String(action.urls || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  },

  ACTIONS: {
    agent: {
      label: 'Run an AI task',
      hint: 'Opens a background tab and lets the agent work through a prompt.',
      validate: a => (String(a.prompt || '').trim() ? [] : ['The AI task needs a prompt']),
      summary: a => 'AI task: ' + String(a.prompt || '').slice(0, 90),
      async run(task, ctx) {
        const action = task.action;
        if (typeof AgentLoop === 'undefined' || typeof AgentLoop.startHeadless !== 'function') throw new Error('Agent system not available');
        const startingUrl = action.startingUrl ? Scheduler._webUrl(action.startingUrl) : 'about:blank';
        const taskTab = TabManager.createTab(startingUrl, false);
        // The run owns this tab for its whole lifetime and must hand it back.
        // Before this, every scheduled run leaked one background tab — and the
        // leak survived restarts because leaked tabs were session-restored.
        ctx.cleanup(() => { try { TabManager.closeTab(taskTab.id); } catch { /* already gone */ } });
        const taskWebview = WebviewManager.webviews.get(taskTab.id);
        if (!taskWebview) throw new Error('Could not create the background tab');
        const onClosed = () => ctx.controller.abort(new Error('Scheduled tab was closed'));
        taskWebview.addEventListener('vex-disposed', onClosed, { once: true });
        ctx.cleanup(() => taskWebview.removeEventListener('vex-disposed', onClosed));
        await window.VexLifecycle.ready(taskWebview, ctx.controller.signal);
        const result = await window.VexLifecycle.run(
          () => AgentLoop.startHeadless(action.prompt, 'auto', {
            maxIterations: action.maxIterations || 15,
            webview: taskWebview,
            signal: ctx.controller.signal,
          }),
          { signal: ctx.controller.signal, timeout: 10 * 60 * 1000 }
        );
        return result?.summary || 'Task completed';
      },
    },

    openUrls: {
      label: 'Open pages',
      hint: 'Opens one or more URLs as tabs. One per line.',
      validate: a => {
        const urls = Scheduler._urlList(a);
        if (!urls.length) return ['Add at least one URL'];
        try { urls.forEach(u => Scheduler._webUrl(u)); } catch (err) { return [err.message]; }
        return [];
      },
      summary: a => {
        const n = Scheduler._urlList(a).length;
        return 'Open ' + n + ' page' + (n === 1 ? '' : 's');
      },
      async run(task) {
        const urls = Scheduler._urlList(task.action).map(u => Scheduler._webUrl(u));
        const activate = !task.action.background;
        urls.forEach((url, i) => TabManager.createTab(url, activate && i === 0));
        return 'Opened ' + urls.length + ' page' + (urls.length === 1 ? '' : 's');
      },
    },

    reload: {
      label: 'Reload tabs',
      hint: 'Reloads open tabs whose URL contains the text below. Leave it empty for every tab.',
      validate: () => [],
      summary: a => (a.match ? 'Reload tabs matching "' + a.match + '"' : 'Reload every tab'),
      async run(task) {
        const needle = String(task.action.match || '').toLowerCase();
        const tabs = (TabManager.tabs || []).filter(t => !needle || String(t.url || '').toLowerCase().includes(needle));
        let reloaded = 0;
        for (const tab of tabs) {
          const view = WebviewManager?.webviews?.get(tab.id);
          if (!view || typeof view.reload !== 'function') continue;
          try { view.reload(); reloaded++; } catch { /* a sleeping or disposed tab cannot reload */ }
        }
        if (!reloaded) throw new Error('No open tab matched' + (needle ? ' "' + task.action.match + '"' : ''));
        return 'Reloaded ' + reloaded + ' tab' + (reloaded === 1 ? '' : 's');
      },
    },

    sleepTabs: {
      label: 'Sleep background tabs',
      hint: 'Frees memory by suspending every tab except the one you are looking at.',
      validate: () => [],
      summary: () => 'Put background tabs to sleep',
      async run() {
        if (typeof TabManager?.sleepAllInactive !== 'function') throw new Error('Tab sleeping is not available');
        const awakeBefore = (TabManager.tabs || []).filter(t => !t.sleeping).length;
        await TabManager.sleepAllInactive();
        const awakeAfter = (TabManager.tabs || []).filter(t => !t.sleeping).length;
        const slept = Math.max(0, awakeBefore - awakeAfter);
        return 'Put ' + slept + ' tab' + (slept === 1 ? '' : 's') + ' to sleep';
      },
    },

    saveSession: {
      label: 'Save a session snapshot',
      hint: 'Saves the current tabs so you can restore them later.',
      validate: () => [],
      summary: a => 'Save session "' + (a.sessionName || 'Auto') + '"',
      async run(task) {
        if (typeof SessionManager?.saveCurrentSession !== 'function') throw new Error('Sessions are not available');
        const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const name = (task.action.sessionName || 'Auto') + ' - ' + stamp;
        const session = SessionManager.saveCurrentSession(name);
        return 'Saved "' + name + '" (' + (session?.tabs?.length || 0) + ' tabs)';
      },
    },

    clearBrowsingData: {
      label: 'Clear browsing data',
      hint: 'Wipes cache, cookies, history and saved sessions — the same action as the Settings button.',
      validate: () => [],
      summary: () => 'Clear all browsing data',
      async run() {
        if (typeof window.vex?.clearBrowsingData !== 'function') throw new Error('Clearing browsing data is not available');
        await window.vex.clearBrowsingData();
        return 'Browsing data cleared';
      },
    },

    reminder: {
      label: 'Show a reminder',
      hint: 'A notification at the scheduled time. Nothing else happens.',
      validate: a => (String(a.message || '').trim() ? [] : ['Write the reminder text']),
      summary: a => 'Reminder: ' + String(a.message || '').slice(0, 90),
      async run(task) {
        Scheduler._notify(task.name, task.action.message);
        return String(task.action.message || '').slice(0, 200);
      },
    },
  },

  describeAction(task) {
    const t = this._migrate(task);
    const spec = this.ACTIONS[t.action?.type];
    if (!spec) return 'Unknown action';
    try { return spec.summary(t.action); } catch { return spec.label; }
  },

  // ------------------------------------------------------------ plain English

  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  MONTH_NAMES: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

  _clock(date) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  },

  _ordinal(n) {
    const suffix = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
  },

  describeSchedule(task) {
    const s = this._migrate(task).schedule;
    if (s.type === 'interval') {
      const n = Number(s.everyMinutes) || 60;
      if (n % 1440 === 0) return 'Every ' + (n / 1440 === 1 ? 'day' : n / 1440 + ' days');
      if (n % 60 === 0) return 'Every ' + (n / 60 === 1 ? 'hour' : n / 60 + ' hours');
      return 'Every ' + (n === 1 ? 'minute' : n + ' minutes');
    }
    if (s.type === 'daily') return 'Every day at ' + s.time;
    if (s.type === 'weekly') {
      const days = s.daysOfWeek || [];
      if (!days.length) return 'Weekly, but no days are picked';
      if (days.length === 7) return 'Every day at ' + s.time;
      if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'Every weekday at ' + s.time;
      if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Every weekend day at ' + s.time;
      return 'Every ' + days.map(d => this.DAY_NAMES[d]).join(', ') + ' at ' + s.time;
    }
    if (s.type === 'monthly') {
      const which = s.dayOfMonth === 'last' ? 'the last day' : 'the ' + this._ordinal(Number(s.dayOfMonth) || 1);
      return 'Monthly on ' + which + ' at ' + s.time;
    }
    if (s.type === 'once') {
      const at = this._onceAt(s);
      if (at === null) return 'Once, but no date is set';
      const d = new Date(at);
      return 'Once on ' + d.getDate() + ' ' + this.MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() + ' at ' + this._clock(d);
    }
    if (s.type === 'cron') return this.parseCron(s.cron) ? 'Cron: ' + s.cron : 'Cron: invalid expression';
    return 'Unknown schedule';
  },

  // "tomorrow at 09:00" / "in 4 minutes" / "Mon at 07:30" / "12 Oct at 09:00"
  describeNextRun(task, nowMs) {
    const t = this._migrate(task);
    if (!t.enabled) return 'Paused';
    const now = nowMs === undefined ? Date.now() : nowMs;
    const next = this.nextOccurrence(t, now);
    if (next === null) {
      if (t.schedule.type === 'once') return (t.runCount || 0) > 0 ? 'Already run' : 'Date has passed';
      if (t.schedule.type === 'weekly' && !(t.schedule.daysOfWeek || []).length) return 'No days picked';
      if (t.schedule.type === 'cron' && !this.parseCron(t.schedule.cron)) return 'Invalid cron';
      return 'Not scheduled';
    }
    const d = new Date(next);
    const diff = next - now;
    if (diff < 60000) return 'in less than a minute';
    if (diff < 3600000) { const n = Math.round(diff / 60000); return 'in ' + n + ' minute' + (n === 1 ? '' : 's'); }
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
    if (dayDiff === 0) return 'today at ' + this._clock(d);
    if (dayDiff === 1) return 'tomorrow at ' + this._clock(d);
    if (dayDiff < 7) return this.DAY_NAMES[d.getDay()] + ' at ' + this._clock(d);
    return d.getDate() + ' ' + this.MONTH_NAMES[d.getMonth()] + ' at ' + this._clock(d);
  },

  // ------------------------------------------------------------------ polling

  _catchUpWindowMs(task) {
    if (!task.catchUp) return this.NO_CATCHUP_GRACE_MS;
    return Math.min(this.MAX_CATCHUP_MIN, Math.max(1, Number(task.catchUpWindowMin) || 720)) * 60000;
  },

  _checkDueTasks(nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    const tasks = this.getAllTasks();
    const skipped = [];
    const toRun = [];
    let claimedAny = false;
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (this._running.has(task.id) || this.isQueued(task.id)) continue;
      let occ;
      try { occ = this.prevOccurrence(task, now); }
      catch (err) { console.error('[Scheduler] schedule error for ' + task.name + ':', err); continue; }
      if (occ === null) continue;
      const claimed = task.lastOccurrence ? Date.parse(task.lastOccurrence) : null;
      if (claimed !== null && occ <= claimed) continue;   // already accounted for
      const lateBy = now - occ;
      // Claim BEFORE running: this is the whole duplicate-run guarantee. Every
      // claim in this pass is written in one go, so a burst of due tasks costs
      // one localStorage write rather than one per task.
      task.lastOccurrence = new Date(occ).toISOString();
      claimedAny = true;
      if (lateBy > this._catchUpWindowMs(task)) {
        // Leave a trace: a run the user never saw is a bug report waiting to
        // happen, so it goes into history as 'skipped'.
        skipped.push({
          id: 'skip_' + task.id + '_' + occ,
          taskId: task.id,
          taskName: task.name,
          actionType: task.action?.type || 'agent',
          startedAt: new Date(occ).toISOString(),
          finishedAt: new Date(now).toISOString(),
          durationMs: 0,
          status: 'skipped',
          summary: null,
          error: 'Missed while Vex was closed (' + this._humanDuration(lateBy) + ' late)',
          manual: false,
          occurrence: new Date(occ).toISOString(),
          lateMs: lateBy,
        });
        continue;
      }
      toRun.push({ task, occ });
    }
    // Persist every claim first, then act on them: if the write fails nothing
    // runs, which is the safe direction (a missed run beats a duplicate one).
    if (claimedAny) this._save(tasks);
    for (const run of skipped) this._record(run);
    for (const { task, occ } of toRun) this._enqueue(task, occ, false);
  },

  _enqueue(task, occMs, manual) {
    if (this._queue.length >= this.MAX_QUEUE) {
      console.warn('[Scheduler] run queue is full, dropping', task.name);
      return;
    }
    this._queue.push({ task, occurrence: occMs, manual });
    this._drain();
  },

  // Runs are serialised. Before, two tasks due in the same minute meant the
  // second was dropped with a toast and no record; now it waits its turn.
  async _drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this._queue.length) {
        const entry = this._queue.shift();
        try {
          const run = await this._execute(entry.task, entry.occurrence, entry.manual);
          entry.resolve?.(run);
        } catch (err) {
          console.error('[Scheduler] run failed:', err);
          entry.reject?.(err);
        }
      }
    } finally {
      this._draining = false;
    }
  },

  // ---------------------------------------------------------------- execution

  // "Run it right now". Resolves with the run record once the queue reaches it.
  runTask(task, manual = true) {
    const fresh = this.getTask(task?.id) || this._migrate(task);
    if (!fresh) return Promise.reject(new Error('Task not found'));
    if (this._running.has(fresh.id)) return Promise.reject(new Error('That task is already running'));
    if (this._queue.length >= this.MAX_QUEUE) return Promise.reject(new Error('The run queue is full'));
    return new Promise((resolve, reject) => {
      this._queue.push({ task: fresh, occurrence: Date.now(), manual, resolve, reject });
      this._drain();
    });
  },

  async _execute(task, occMs, manual) {
    if (window.VexTabPolicy?.isPrivateWindow) throw new Error('Scheduled tasks are disabled in private windows');
    const spec = this.ACTIONS[task.action?.type];
    const startedMs = Date.now();
    const run = {
      id: 'run_' + startedMs + '_' + Math.random().toString(36).slice(2, 6),
      taskId: task.id,
      taskName: task.name,
      actionType: task.action?.type || 'agent',
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: null,
      durationMs: 0,
      status: 'failed',
      summary: null,
      error: null,
      manual,
      occurrence: new Date(occMs).toISOString(),
      lateMs: Math.max(0, startedMs - occMs),
    };

    this._running.add(task.id);
    this._emit();
    const controller = new AbortController();
    this._controllers.set(task.id, controller);
    const cleanups = [];
    const ctx = { controller, cleanup: fn => cleanups.push(fn) };
    const timeout = setTimeout(() => controller.abort(new Error('Scheduled task exceeded ten minutes')), 10 * 60 * 1000);

    try {
      if (!spec) throw new Error('Unknown action "' + task.action?.type + '"');
      window.showToast?.((manual ? 'Running' : 'Scheduled') + ': ' + task.name);
      run.summary = await spec.run(task, ctx);
      run.status = 'success';
      if (task.notifyOnComplete && task.action.type !== 'reminder') this._notify('Task complete: ' + task.name, run.summary);
    } catch (err) {
      run.status = 'failed';
      run.error = err?.message || String(err);
      if (task.notifyOnFail) this._notify('Task failed: ' + task.name, run.error);
    } finally {
      clearTimeout(timeout);
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch (err) { console.error('[Scheduler] cleanup failed:', err); }
      }
      this._controllers.delete(task.id);
      this._running.delete(task.id);
    }

    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - startedMs;
    this._record(run);

    // Re-read: the task may have been edited (or deleted) while the run was in
    // flight, and writing back a stale copy would roll runCount backwards.
    const current = this.getTask(task.id);
    if (current) {
      const patch = {
        lastRunAt: run.startedAt,
        lastRunResult: run.status,
        runCount: (current.runCount || 0) + 1,
        failCount: (current.failCount || 0) + (run.status === 'failed' ? 1 : 0),
      };
      // A one-off that has run is done; stop it polling forever.
      if (current.schedule.type === 'once' && run.status === 'success' && !manual) patch.enabled = false;
      this.updateTask(task.id, patch);
    }
    this._emit();
    return run;
  },

  // ------------------------------------------------------------------ history

  getHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  },

  getTaskHistory(taskId, limit = 10) {
    return this.getHistory().filter(r => r.taskId === taskId).slice(0, limit);
  },

  _record(run) {
    const history = this.getHistory();
    if (history.some(r => r.id === run.id)) return;   // idempotent for a repeated claim
    history.unshift(run);
    if (history.length > this.MAX_HISTORY) history.length = this.MAX_HISTORY;
    try { localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history)); }
    catch (err) { console.error('[Scheduler] could not save run history:', err); }
    this._emit();
  },

  clearHistory() {
    localStorage.setItem(this.HISTORY_KEY, '[]');
    this._emit();
  },

  _humanDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + ' min';
    if (ms < 86400000) return Math.round(ms / 3600000) + ' hr';
    return Math.round(ms / 86400000) + ' days';
  },

  _notify(title, body) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch { /* notifications can be blocked mid-session */ }
    }
    window.showToast?.(title + (body ? ': ' + body : ''));
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;
