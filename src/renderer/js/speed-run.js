// === Speed-run: a stopwatch for clearing a list ==================================
//
// Time yourself clearing the unread mail in your inbox, or finishing the
// Read Later queue. Your own best time is kept on this computer and shown
// beside the clock. That is all there is:
//
//   * no leaderboard, no sharing, no comparison with anyone else
//   * no countdown, no "hurry", no message when you are slower
//   * stopping partway just stops; nothing is recorded and nothing is said
//   * the clock can be hidden while you work
//
// API (also what the tests drive):
//   VexSpeedRun.COURSES                       [{ id, name, what, remaining() }]
//   VexSpeedRun.formatMs(ms)                  '1:05', '12:03', '1:02:03'
//   VexSpeedRun.bests()                       { courseId: { ms, at, runs } }
//   VexSpeedRun.record(courseId, ms, at?)     -> { ms, best, isBest, previous }
//   VexSpeedRun.begin(course, deps?)          a run object (start/check/stop)
//   VexSpeedRun.open()                        the dialog (Ctrl+K: "Speed-run")
//
// A run is { start(), check(), stop() }. check() asks the course how many are
// left; when that reaches zero the run finishes and is recorded.
//
// Storage: localStorage `vex.speedrun` { bests, showClock }. Per device.
// Signals the medal `speed-run-first` (VexMedals ignores it if undefined).
const VexSpeedRun = {
  KEY: 'vex.speedrun',

  // remaining() answers a number (or a promise of one): how many are left.
  COURSES: [
    {
      id: 'reading', name: 'Read Later queue', what: 'unread saved pages', pollMs: 2000,
      remaining() {
        if (typeof ReadLater === 'undefined' || !Array.isArray(ReadLater.items)) throw new Error('Read Later is not loaded');
        return ReadLater.items.filter(i => !i.read).length;
      },
    },
    {
      id: 'inbox', name: 'Unread mail', what: 'unread messages', pollMs: 20000,
      async remaining() {
        const m = typeof window !== 'undefined' && window.vex && window.vex.mail;
        if (!m || typeof m.accounts !== 'function' || typeof m.inbox !== 'function') throw new Error('Mail is not available in this window');
        const unwrap = (r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer'); return r.value; };
        const accounts = unwrap(await m.accounts());
        if (!accounts.length) throw new Error('No mail account is set up');
        let n = 0;
        for (const a of accounts) {
          const box = unwrap(await m.inbox(a.id, 1));
          n += Number(box.unseen) || 0;
        }
        return n;
      },
    },
  ],

  _state() {
    const v = VexExpression.read(this.KEY, null);
    const bests = v && typeof v.bests === 'object' && v.bests ? v.bests : {};
    return { bests, showClock: !(v && v.showClock === false) };
  },

  bests() { return JSON.parse(JSON.stringify(this._state().bests)); },

  showClock() { return this._state().showClock; },
  setShowClock(on) {
    if (typeof on !== 'boolean') throw new Error('On or off');
    const st = this._state();
    VexExpression.write(this.KEY, { bests: st.bests, showClock: on });
  },

  clear() {
    const st = this._state();
    VexExpression.write(this.KEY, { bests: {}, showClock: st.showClock });
  },

  formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('A time is a number of milliseconds');
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  },

  record(courseId, ms, at) {
    if (!this.COURSES.some(c => c.id === courseId)) throw new Error('Unknown course: ' + courseId);
    if (!Number.isFinite(ms) || ms < 0) throw new Error('A time is a number of milliseconds');
    const st = this._state();
    const prev = st.bests[courseId] || null;
    const isBest = !prev || ms < prev.ms;
    st.bests[courseId] = {
      ms: isBest ? Math.round(ms) : prev.ms,
      at: isBest ? (at || Date.now()) : prev.at,
      runs: (prev ? prev.runs : 0) + 1,
    };
    VexExpression.write(this.KEY, { bests: st.bests, showClock: st.showClock });
    return { ms: Math.round(ms), best: st.bests[courseId].ms, isBest, previous: prev ? prev.ms : null };
  },

  // deps: { now() } for tests.
  begin(course, deps) {
    const now = (deps && deps.now) || (() => Date.now());
    const self = {
      course,
      startedAt: null,
      startCount: null,
      finished: null,
      async start() {
        const n = await course.remaining();
        if (!Number.isInteger(n) || n < 0) throw new Error('The course did not say how many are left');
        if (n === 0) throw new Error('There is nothing to clear in ' + course.name);
        self.startCount = n;
        self.startedAt = now();
        return n;
      },
      elapsed() { return self.startedAt == null ? 0 : (self.finished ? self.finished.ms : now() - self.startedAt); },
      // -> { left, done, result? }
      async check() {
        if (self.startedAt == null) throw new Error('The run has not started');
        if (self.finished) return { left: 0, done: true, result: self.finished };
        const left = await course.remaining();
        if (left === 0) {
          const ms = now() - self.startedAt;
          const rec = VexSpeedRun.record(course.id, ms);
          self.finished = { ms, startCount: self.startCount, ...rec };
          VexExpression.signal('speed-run-first');
          return { left: 0, done: true, result: self.finished };
        }
        return { left, done: false };
      },
      stop() { self.startedAt = null; self.finished = null; },
    };
    return self;
  },

  open() {
    const X = VexExpression;
    const dlg = X.dialog('Speed-run', { onClose: () => { if (timer) clearInterval(timer); timer = null; } });
    let timer = null;
    let run = null;
    let checking = false;
    const drawStart = () => {
      if (timer) { clearInterval(timer); timer = null; }
      run = null;
      const b = this.bests();
      dlg.body.innerHTML = `
        <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 10px">Time yourself clearing a list. Your best time stays on this computer. Stop whenever you like; nothing is recorded then.</p>
        ${this.COURSES.map(c => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
            <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13.5px">${X.esc(c.name)}</div>
              <div style="font-size:11.5px;color:var(--text-muted)">${b[c.id] ? 'Your best: ' + this.formatMs(b[c.id].ms) : 'No time yet'}</div></div>
            <button type="button" class="btn-primary" data-sr-start="${c.id}">Start</button>
          </div>`).join('')}
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <label style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-sr-clock ${this.showClock() ? 'checked' : ''}> Show the clock while I work</label>
          <button type="button" class="btn-secondary" data-sr-close style="margin-left:auto">Close</button>
        </div>`;
      dlg.body.querySelector('[data-sr-close]').addEventListener('click', () => dlg.close());
      dlg.body.querySelector('[data-sr-clock]').addEventListener('change', (e) => {
        try { this.setShowClock(e.target.checked); } catch (err) { X.toast(err.message, 'error'); }
      });
      dlg.body.querySelectorAll('[data-sr-start]').forEach(btn => btn.addEventListener('click', () => start(btn.dataset.srStart)));
    };
    const drawRun = (left) => {
      const clock = this.showClock() ? this.formatMs(run.elapsed()) : '';
      dlg.body.innerHTML = `
        <div style="font-weight:600;font-size:13.5px">${X.esc(run.course.name)}</div>
        <div data-sr-clockface style="font-size:34px;font-weight:700;margin:6px 0;font-variant-numeric:tabular-nums">${X.esc(clock) || '&nbsp;'}</div>
        <div style="font-size:12.5px;color:var(--text-muted)" data-sr-left>${left} ${X.esc(run.course.what)} left</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="button" class="btn-secondary" data-sr-check>Check now</button>
          <button type="button" class="btn-secondary" data-sr-stop style="margin-left:auto">Stop</button>
        </div>`;
      dlg.body.querySelector('[data-sr-check]').addEventListener('click', () => poll());
      dlg.body.querySelector('[data-sr-stop]').addEventListener('click', () => { run.stop(); drawStart(); });
    };
    const drawDone = (r) => {
      dlg.body.innerHTML = `
        <div style="font-weight:600;font-size:13.5px">${X.esc(run.course.name)}: cleared</div>
        <div style="font-size:34px;font-weight:700;margin:6px 0;font-variant-numeric:tabular-nums">${this.formatMs(r.ms)}</div>
        <div style="font-size:12.5px;color:var(--text-muted)">${r.isBest ? (r.previous == null ? 'That is your first time here.' : 'A new best for you.') : 'Your best is ' + this.formatMs(r.best) + '.'}</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="btn-secondary" data-sr-back>Back</button><button type="button" class="btn-secondary" data-sr-close style="margin-left:auto">Close</button></div>`;
      dlg.body.querySelector('[data-sr-back]').addEventListener('click', drawStart);
      dlg.body.querySelector('[data-sr-close]').addEventListener('click', () => dlg.close());
    };
    const poll = async () => {
      if (!run || checking) return;
      checking = true;
      try {
        const r = await run.check();
        if (r.done) { if (timer) clearInterval(timer); timer = null; drawDone(r.result); }
        else {
          const left = dlg.body.querySelector('[data-sr-left]');
          if (left) left.textContent = r.left + ' ' + run.course.what + ' left';
        }
      } catch (err) {
        X.toast('Could not check: ' + err.message, 'error');
      } finally { checking = false; }
    };
    const start = async (id) => {
      const course = this.COURSES.find(c => c.id === id);
      run = this.begin(course);
      try {
        const n = await run.start();
        drawRun(n);
        // The clock face updates every second; the course is asked on its own,
        // slower, beat.
        let last = 0;
        timer = setInterval(() => {
          if (!run) return;
          const face = dlg.body.querySelector('[data-sr-clockface]');
          if (face && this.showClock()) face.textContent = this.formatMs(run.elapsed());
          last += 1000;
          if (last >= course.pollMs) { last = 0; poll(); }
        }, 1000);
      } catch (err) {
        run = null;
        X.toast(err.message, 'error');
        drawStart();
      }
    };
    drawStart();
    return dlg;
  },

  commands: [
    {
      id: 'speedrun', label: 'Speed-Run: Time Yourself Clearing a List',
      hint: 'A stopwatch for the unread mail or the Read Later queue; your own best time stays on this computer',
      icon: 'timer',
      action: () => { try { VexSpeedRun.open(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    },
  ],

  brief: {
    id: 'speed-run-best', title: 'Your best times', icon: 'timer',
    isEnabled() {
      try { return Object.keys(VexSpeedRun.bests()).length > 0 && !VexExpression.gaming(); } catch { return false; }
    },
    build() {
      if (!this.isEnabled()) return null;
      const b = VexSpeedRun.bests();
      const lines = VexSpeedRun.COURSES.filter(c => b[c.id]).map(c => ({ text: c.name + ': ' + VexSpeedRun.formatMs(b[c.id].ms), detail: 'your best' }));
      return lines.length ? { id: 'speed-run-best', title: 'Your best times', icon: 'timer', lines } : null;
    },
  },

  renderSettings(container) {
    const X = VexExpression;
    const p = document.createElement('p');
    p.className = 'setting-info muted';
    p.style.margin = '0 0 6px';
    p.textContent = 'A stopwatch for clearing the unread mail or the Read Later queue, started from Ctrl+K. Only your own best time is kept, here.';
    container.appendChild(p);
    container.appendChild(X.toggleRow('Show the clock while a run is going', '', this.showClock(), (on) => this.setShowClock(on)));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = 'Forget my best times';
    b.addEventListener('click', async () => {
      try {
        const ok = typeof vexConfirm === 'function' ? await vexConfirm({ title: 'Forget your best times?', message: 'The saved times on this computer are removed.', okLabel: 'Forget them', danger: true }) : true;
        if (ok) { this.clear(); X.toast('Best times cleared'); }
      } catch (err) { X.toast(err.message, 'error'); }
    });
    container.appendChild(b);
  },
};

if (typeof window !== 'undefined') window.VexSpeedRun = VexSpeedRun;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpeedRun };
