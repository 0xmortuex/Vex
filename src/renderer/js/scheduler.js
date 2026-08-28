// === Vex Scheduler Engine ===
//
// Recurring-task runner. Stores task definitions in localStorage
// ('vex.schedules'), polls every 60s, and fires AgentLoop.startHeadless when
// a task's next-run window is reached. calculateNextRun handles
// once/daily/weekly/monthly + 5-field cron via _parseCronNext.
// Public API: Scheduler (singleton — start, stop, createTask, updateTask,
// deleteTask, runTask, calculateNextRun, getAllTasks, getHistory).
// Depends on AgentLoop, TabManager.

const Scheduler = {
  STORAGE_KEY: 'vex.schedules',
  HISTORY_KEY: 'vex.scheduleHistory',
  _interval: null,
  _running: new Set(),

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._checkDueTasks(), 60000);
    setTimeout(() => this._checkDueTasks(), 5000); // Check shortly after startup
    console.log('[Scheduler] Started');
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  },

  getAllTasks() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); } catch { return []; }
  },

  _save(tasks) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tasks));
  },

  createTask(data) {
    const tasks = this.getAllTasks();
    const task = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      lastRunResult: null,
      runCount: 0,
      name: data.name || 'Untitled Task',
      description: data.description || '',
      frequency: data.frequency || 'daily',
      time: data.time || '09:00',
      daysOfWeek: data.daysOfWeek || [],
      dayOfMonth: data.dayOfMonth || 1,
      customCron: data.customCron || '',
      startDate: data.startDate || new Date().toISOString().slice(0, 10),
      prompt: data.prompt || '',
      runMode: 'auto',
      startingUrl: data.startingUrl || '',
      maxIterations: data.maxIterations || 15,
      notifyOnComplete: data.notifyOnComplete !== false,
      notifyOnFail: data.notifyOnFail !== false,
    };
    tasks.push(task);
    this._save(tasks);
    return task;
  },

  updateTask(id, updates) {
    const tasks = this.getAllTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx >= 0) { Object.assign(tasks[idx], updates); this._save(tasks); }
  },

  deleteTask(id) {
    this._save(this.getAllTasks().filter(t => t.id !== id));
  },

  calculateNextRun(task) {
    const now = new Date();
    const [h, m] = (task.time || '09:00').split(':').map(Number);

    if (task.frequency === 'once') {
      if (task.runCount > 0) return null;
      const d = new Date(task.startDate || now);
      d.setHours(h, m, 0, 0);
      return d > now ? d : null;
    }

    if (task.frequency === 'daily') {
      const next = new Date(now);
      next.setHours(h, m, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }

    if (task.frequency === 'weekly') {
      const days = task.daysOfWeek || [];
      if (days.length === 0) return null;
      for (let i = 0; i < 8; i++) {
        const c = new Date(now);
        c.setDate(c.getDate() + i);
        c.setHours(h, m, 0, 0);
        if (days.includes(c.getDay()) && c > now) return c;
      }
      return null;
    }

    if (task.frequency === 'monthly') {
      const next = new Date(now);
      next.setDate(task.dayOfMonth || 1);
      next.setHours(h, m, 0, 0);
      if (next <= now) next.setMonth(next.getMonth() + 1);
      return next;
    }

    if (task.frequency === 'custom' && task.customCron) {
      return this._parseCronNext(task.customCron, now);
    }

    return null;
  },

  _parseCronNext(cron, now) {
    if (!cron) return null;
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minP, hourP, dayP, monthP, dowP] = parts;
    const check = (val, p) => {
      if (p === '*') return true;
      if (p.includes(',')) return p.split(',').map(Number).includes(val);
      if (p.includes('/')) { const s = parseInt(p.split('/')[1]); return val % s === 0; }
      return parseInt(p) === val;
    };
    const c = new Date(now);
    c.setSeconds(0, 0);
    for (let i = 1; i <= 10080; i++) {
      c.setMinutes(c.getMinutes() + 1);
      if (check(c.getMinutes(), minP) && check(c.getHours(), hourP) &&
          check(c.getDate(), dayP) && check(c.getMonth() + 1, monthP) && check(c.getDay(), dowP)) {
        return new Date(c);
      }
    }
    return null;
  },

  async runTask(task, manual = false) {
    if (this._running.has(task.id)) return;
    if (this._running.size >= 3) { window.showToast?.('Max 3 tasks running simultaneously'); return; }
    this._running.add(task.id);

    const run = {
      id: 'run_' + Date.now(),
      taskId: task.id,
      taskName: task.name,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      success: null,
      summary: null,
      error: null,
      manual
    };

    try {
      window.showToast?.((manual ? 'Running' : 'Scheduled') + ': ' + task.name);

      // Open starting URL if specified
      if (task.startingUrl) {
        TabManager.createTab(task.startingUrl, true);
        await new Promise(r => setTimeout(r, 3000)); // Wait for page load
      }

      // Run agent headless
      if (typeof AgentLoop?.startHeadless === 'function') {
        const result = await AgentLoop.startHeadless(task.prompt, 'auto', { maxIterations: task.maxIterations || 15 });
        run.success = true;
        run.summary = result.summary || 'Task completed';
      } else {
        throw new Error('Agent system not available');
      }

      if (task.notifyOnComplete) {
        this._notify('Task complete: ' + task.name, run.summary);
      }
    } catch (err) {
      run.success = false;
      run.error = err.message;
      if (task.notifyOnFail) {
        this._notify('Task failed: ' + task.name, err.message);
      }
    }

    run.finishedAt = new Date().toISOString();
    this._running.delete(task.id);

    // Save to history
    const history = this.getHistory();
    history.unshift(run);
    if (history.length > 500) history.length = 500;
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));

    // Update task stats
    this.updateTask(task.id, {
      lastRunAt: run.startedAt,
      lastRunResult: run.success ? 'success' : 'failed',
      runCount: (task.runCount || 0) + 1
    });

    return run;
  },

  getHistory() {
    try { return JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]'); } catch { return []; }
  },

  clearHistory() {
    localStorage.setItem(this.HISTORY_KEY, '[]');
  },

  // Most recent scheduled occurrence AT OR BEFORE `now` for a recurring task
  // (daily/weekly/monthly), or null. This is what decides whether a run is DUE —
  // separate from calculateNextRun() (the next FUTURE run, shown in the UI).
  // calculateNextRun rolls forward the instant now passes the scheduled time, so
  // the old check could only fire in the 60s BEFORE the time (≈60s early) and
  // never caught a run that was missed while the app slept. This fires AT the
  // time and catches up a missed one within CATCHUP.
  _dueOccurrence(task, now) {
    const [h, m] = (task.time || '09:00').split(':').map(Number);
    if (task.frequency === 'daily') {
      const d = new Date(now); d.setHours(h, m, 0, 0);
      if (d > now) d.setDate(d.getDate() - 1);
      return d;
    }
    if (task.frequency === 'weekly') {
      const days = task.daysOfWeek || [];
      if (!days.length) return null;
      for (let i = 0; i < 8; i++) {
        const c = new Date(now); c.setDate(c.getDate() - i); c.setHours(h, m, 0, 0);
        if (c <= now && days.includes(c.getDay())) return c;
      }
      return null;
    }
    if (task.frequency === 'monthly') {
      const d = new Date(now); d.setDate(task.dayOfMonth || 1); d.setHours(h, m, 0, 0);
      if (d > now) d.setMonth(d.getMonth() - 1);
      return d;
    }
    return null;
  },

  _checkDueTasks() {
    const now = new Date();
    const CATCHUP = 6 * 60 * 60 * 1000; // run a missed occurrence up to 6h late (e.g. after sleep); older is skipped
    const recurring = { daily: true, weekly: true, monthly: true };
    for (const task of this.getAllTasks().filter(t => t.enabled)) {
      if (recurring[task.frequency]) {
        const occ = this._dueOccurrence(task, now);
        if (!occ) continue;
        const sinceOcc = now - occ;
        if (sinceOcc < 0 || sinceOcc > CATCHUP) continue;      // not reached yet, or too stale
        const last = task.lastRunAt ? new Date(task.lastRunAt) : null;
        if (last && last >= occ) continue;                      // already ran this occurrence
        this.runTask(task).catch(e => console.error('[Scheduler] Task error:', e));
      } else {
        // 'once' and 'custom' (cron) keep the next-run window.
        const next = this.calculateNextRun(task);
        if (!next) continue;
        const diff = next - now;
        if (diff <= 60000 && diff >= -60000) {
          const last = task.lastRunAt ? new Date(task.lastRunAt) : null;
          if (last && (now - last) < 90000) continue;
          this.runTask(task).catch(e => console.error('[Scheduler] Task error:', e));
        }
      }
    }
  },

  _notify(title, body) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
    window.showToast?.(title + (body ? ': ' + body : ''));
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;
