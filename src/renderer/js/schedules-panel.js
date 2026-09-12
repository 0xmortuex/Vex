// === Vex Schedules Panel ===
//
// UI for Scheduler: the Active list (schedule + next run in plain English, last
// result, per-task recent runs), the History log (success/failure/skipped with
// durations), Templates, and the create/edit modal that drives every schedule
// type and every action type the engine supports.
//
// Icons are inline SVG on currentColor — no emoji anywhere in this panel.
// Public API: SchedulesPanel (singleton — init, showModal).
// Depends on Scheduler, VexUI, vexConfirm, window.showToast.

const TASK_TEMPLATES = [
  {
    name: 'Morning reading list',
    description: 'Opens the pages you start the day with, every weekday at 08:30.',
    schedule: { type: 'weekly', time: '08:30', daysOfWeek: [1, 2, 3, 4, 5] },
    action: { type: 'openUrls', urls: 'https://news.ycombinator.com/\nhttps://github.com/trending', background: true },
  },
  {
    name: 'Free some memory',
    description: 'Puts every background tab to sleep once an hour.',
    schedule: { type: 'interval', everyMinutes: 60 },
    action: { type: 'sleepTabs' },
  },
  {
    name: 'Save my tabs',
    description: 'Snapshots the open tabs every evening so nothing is lost.',
    schedule: { type: 'daily', time: '18:00' },
    action: { type: 'saveSession', sessionName: 'End of day' },
  },
  {
    name: 'Stand up and stretch',
    description: 'A reminder every 45 minutes.',
    schedule: { type: 'interval', everyMinutes: 45 },
    action: { type: 'reminder', message: 'Stand up, look away from the screen for 20 seconds.' },
  },
  {
    name: 'Keep the dashboard fresh',
    description: 'Reloads any open tab whose URL contains "dashboard" every 15 minutes.',
    schedule: { type: 'interval', everyMinutes: 15 },
    action: { type: 'reload', match: 'dashboard' },
  },
  {
    name: 'Weekly clean slate',
    description: 'Clears cache, cookies and history every Sunday night.',
    schedule: { type: 'weekly', time: '23:00', daysOfWeek: [0] },
    action: { type: 'clearBrowsingData' },
  },
  {
    name: 'Daily news briefing',
    description: 'Sends the agent to summarise the headlines each morning.',
    schedule: { type: 'daily', time: '09:00' },
    action: { type: 'agent', startingUrl: 'https://news.google.com/', prompt: 'List the top 5 news headlines with a one-sentence summary each.' },
  },
];

const SchedulesPanel = {
  _activeTab: 'active',
  _historyFilter: 'all',
  _expanded: new Set(),
  _ticker: null,
  _boundChange: null,

  // 16px stroke icons on currentColor, matching the sidebar/top-bar vocabulary.
  _icon(name, size = 16) {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      play: '<path d="m7 4 12 8-12 8z"/>',
      pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
      check: '<path d="m4 12 5 5L20 7"/>',
      cross: '<path d="M6 6 18 18M18 6 6 18"/>',
      skip: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      dash: '<path d="M5 12h14"/>',
      spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
      chevron: '<path d="m6 9 6 6 6-6"/>',
    };
    return `<svg class="sched-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.dash}</svg>`;
  },

  init() {
    const panel = document.getElementById('panel-schedules');
    if (!panel) return;
    if (panel.dataset.rendered) { this._render(); return; }   // reopening must refresh, not freeze
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="sched-container">
        <div class="sched-header">
          <h2>Scheduled Tasks</h2>
          <div class="sched-header-row">
            <div class="sched-tabs" role="tablist">
              <button class="sched-tab active" data-tab="active" role="tab" aria-selected="true">Active</button>
              <button class="sched-tab" data-tab="history" role="tab" aria-selected="false">History</button>
              <button class="sched-tab" data-tab="templates" role="tab" aria-selected="false">Templates</button>
            </div>
            <button class="sched-new-btn" id="sched-new-btn">${this._icon('plus', 14)}<span>New Task</span></button>
          </div>
        </div>
        <div class="sched-content" id="sched-content"></div>
      </div>
    `;

    panel.querySelectorAll('.sched-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.sched-tab').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', String(b === btn));
        });
        this._activeTab = btn.dataset.tab;
        this._render();
      });
    });

    document.getElementById('sched-new-btn')?.addEventListener('click', () => this.showModal());

    // The engine announces every task/run change; the ticker keeps the "next
    // run" countdowns honest while the panel sits open. A burst of runs fires a
    // burst of events, so redraws are coalesced into one frame.
    if (!this._boundChange) {
      this._boundChange = () => this._scheduleRender();
      window.addEventListener('vex-schedules-changed', this._boundChange);
    }
    if (!this._ticker) this._ticker = setInterval(() => { if (this._visible()) this._render(); }, 30000);

    this._render();
  },

  _visible() {
    const panel = document.getElementById('panel-schedules');
    return !!panel && panel.style.display !== 'none' && panel.offsetParent !== null;
  },

  _scheduleRender() {
    if (this._pendingRender) return;
    this._pendingRender = true;
    const run = () => { this._pendingRender = false; if (this._visible()) this._render(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  },

  _render() {
    if (this._activeTab === 'active') this._renderActive();
    else if (this._activeTab === 'history') this._renderHistory();
    else if (this._activeTab === 'templates') this._renderTemplates();
  },

  _statusIcon(status) {
    if (status === 'success') return `<span class="sched-status ok" title="Succeeded">${this._icon('check', 14)}</span>`;
    if (status === 'failed') return `<span class="sched-status bad" title="Failed">${this._icon('cross', 14)}</span>`;
    if (status === 'skipped') return `<span class="sched-status warn" title="Missed">${this._icon('skip', 14)}</span>`;
    return `<span class="sched-status none" title="Never run">${this._icon('dash', 14)}</span>`;
  },

  _when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  },

  // ------------------------------------------------------------------ active

  _renderActive() {
    const c = document.getElementById('sched-content');
    if (!c) return;
    const tasks = Scheduler.getAllTasks();

    if (tasks.length === 0) {
      c.innerHTML = window.VexUI
        ? VexUI.emptyState('clock', 'No scheduled tasks yet', 'Create one, or start from a template')
        : '<div class="sched-empty">No scheduled tasks yet.</div>';
      return;
    }

    // One history read for the whole list, not one per card.
    const history = Scheduler.getHistory();
    c.innerHTML = tasks.map(t => {
      const busy = Scheduler.isRunning(t.id) || Scheduler.isQueued(t.id);
      const runs = history.filter(r => r.taskId === t.id).slice(0, 5);
      const open = this._expanded.has(t.id);
      const nextText = busy
        ? (Scheduler.isRunning(t.id) ? 'running now' : 'queued')
        : Scheduler.describeNextRun(t);
      return `<div class="sched-card${t.enabled ? '' : ' paused'}${busy ? ' busy' : ''}" data-id="${t.id}">
        <div class="sched-card-header">
          ${this._statusIcon(t.lastRunResult)}
          <span class="sched-card-name">${this._esc(t.name)}</span>
          <button class="sched-card-toggle${t.enabled ? ' on' : ''}" data-action="toggle" role="switch"
            aria-checked="${t.enabled}" aria-label="${t.enabled ? 'Pause' : 'Resume'} ${this._esc(t.name)}"
            title="${t.enabled ? 'Pause this task' : 'Resume this task'}"></button>
        </div>
        <div class="sched-card-meta">
          <span class="sched-sched">${this._esc(Scheduler.describeSchedule(t))}</span>
          <span class="sched-next">${busy ? this._icon('spinner', 12) : this._icon('clock', 12)} next: ${this._esc(nextText)}</span>
        </div>
        <div class="sched-card-prompt">${this._esc(Scheduler.describeAction(t))}</div>
        <div class="sched-card-actions">
          <button data-action="run" ${busy ? 'disabled' : ''}>${this._icon('play', 12)}<span>Run now</span></button>
          <button data-action="edit">${this._icon('pencil', 12)}<span>Edit</span></button>
          <button data-action="duplicate">${this._icon('copy', 12)}<span>Duplicate</span></button>
          <button data-action="delete" class="danger">${this._icon('trash', 12)}<span>Delete</span></button>
          <span class="sched-card-stats">${t.runCount || 0} run${(t.runCount || 0) === 1 ? '' : 's'}${t.failCount ? ' · ' + t.failCount + ' failed' : ''}</span>
          ${runs.length ? `<button class="sched-card-expand${open ? ' open' : ''}" data-action="expand" aria-expanded="${open}">${this._icon('chevron', 12)}<span>${open ? 'Hide' : 'Recent'} runs</span></button>` : ''}
        </div>
        ${open && runs.length ? `<div class="sched-card-runs">${runs.map(r => `
          <div class="sched-run-row">
            ${this._statusIcon(r.status)}
            <span class="sched-run-when">${this._esc(this._when(r.startedAt))}</span>
            <span class="sched-run-dur">${r.status === 'skipped' ? '—' : this._esc(Scheduler._humanDuration(r.durationMs || 0))}</span>
            <span class="sched-run-detail">${this._esc(r.error || r.summary || '')}</span>
          </div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');

    c.querySelectorAll('.sched-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
        const task = Scheduler.getTask(id);
        if (!task) return;
        Scheduler.setEnabled(id, !task.enabled);
        this._render();
      });
      card.querySelector('[data-action="run"]')?.addEventListener('click', () => {
        const task = Scheduler.getTask(id);
        if (!task) return;
        this._render();
        Scheduler.runTask(task, true).catch(err => window.showToast?.('Could not run: ' + err.message));
      });
      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        const task = Scheduler.getTask(id);
        if (task) this.showModal(task);
      });
      card.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => {
        const copy = Scheduler.duplicateTask(id);
        if (copy) window.showToast?.('Duplicated as "' + copy.name + '" (paused)');
        this._render();
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const task = Scheduler.getTask(id);
        if (!task) return;
        const ok = await (window.vexConfirm
          ? window.vexConfirm({ title: 'Delete this task?', message: '"' + task.name + '" and its schedule will be removed. Run history is kept.', okLabel: 'Delete', danger: true })
          : Promise.resolve(true));
        if (!ok) return;
        Scheduler.deleteTask(id);
        this._expanded.delete(id);
        this._render();
      });
      card.querySelector('[data-action="expand"]')?.addEventListener('click', () => {
        if (this._expanded.has(id)) this._expanded.delete(id); else this._expanded.add(id);
        this._render();
      });
    });
  },

  // ----------------------------------------------------------------- history

  _renderHistory() {
    const c = document.getElementById('sched-content');
    if (!c) return;
    const all = Scheduler.getHistory();

    if (all.length === 0) {
      c.innerHTML = window.VexUI
        ? VexUI.emptyState('history', 'No task history yet', 'Every run — and every missed run — shows up here')
        : '<div class="sched-empty">No task history yet.</div>';
      return;
    }

    const names = new Map();
    all.forEach(r => { if (!names.has(r.taskId)) names.set(r.taskId, r.taskName); });
    const rows = this._historyFilter === 'all' ? all : all.filter(r => r.taskId === this._historyFilter);

    c.innerHTML = `
      <div class="sched-hist-bar">
        <select id="sched-hist-filter" aria-label="Filter history by task">
          <option value="all">All tasks</option>
          ${[...names].map(([id, name]) => `<option value="${this._esc(id)}"${this._historyFilter === id ? ' selected' : ''}>${this._esc(name)}</option>`).join('')}
        </select>
        <button id="sched-clear-hist">Clear history</button>
      </div>
      ${rows.slice(0, 100).map(r => `
        <div class="sched-hist-item ${this._esc(r.status || 'failed')}">
          ${this._statusIcon(r.status)}
          <div class="sched-hist-info">
            <div class="sched-hist-name">${this._esc(r.taskName)}${r.manual ? ' <span class="sched-tag">manual</span>' : ''}${r.lateMs > 60000 ? ' <span class="sched-tag">caught up</span>' : ''}</div>
            <div class="sched-hist-detail">${this._esc(r.error || r.summary || (r.status === 'success' ? 'Done' : ''))}</div>
          </div>
          <span class="sched-hist-time">${this._esc(this._when(r.startedAt))}${r.status === 'skipped' ? '' : ' · ' + this._esc(Scheduler._humanDuration(r.durationMs || 0))}</span>
        </div>`).join('')}
    `;

    document.getElementById('sched-hist-filter')?.addEventListener('change', e => {
      this._historyFilter = e.target.value;
      this._render();
    });
    document.getElementById('sched-clear-hist')?.addEventListener('click', async () => {
      const ok = await (window.vexConfirm
        ? window.vexConfirm({ title: 'Clear run history?', message: 'Every recorded run will be removed. The tasks themselves stay.', okLabel: 'Clear', danger: true })
        : Promise.resolve(true));
      if (!ok) return;
      Scheduler.clearHistory();
      this._historyFilter = 'all';
      this._render();
    });
  },

  // --------------------------------------------------------------- templates

  _renderTemplates() {
    const c = document.getElementById('sched-content');
    if (!c) return;
    c.innerHTML = TASK_TEMPLATES.map((t, i) => `
      <div class="sched-template" data-idx="${i}" role="button" tabindex="0">
        <div class="sched-template-name">${this._esc(t.name)}</div>
        <div class="sched-template-desc">${this._esc(t.description)}</div>
        <div class="sched-template-meta">${this._icon('clock', 12)}${this._esc(Scheduler.describeSchedule(t))}</div>
      </div>
    `).join('');

    c.querySelectorAll('.sched-template').forEach(el => {
      const open = () => {
        const t = TASK_TEMPLATES[Number(el.dataset.idx)];
        if (t) this.showModal({ ...t, schedule: { ...t.schedule }, action: { ...t.action } });
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  },

  // ------------------------------------------------------------------- modal

  showModal(existing) {
    let modal = document.getElementById('sched-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sched-modal';
      modal.className = 'sched-modal';
      document.body.appendChild(modal);
    }

    const isEdit = !!existing?.id;
    const source = existing ? Scheduler._migrate(existing) : {};
    const s = Scheduler._normalizeSchedule(source.schedule || {});
    const action = { type: 'agent', ...(source.action || {}) };
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const selDays = s.daysOfWeek || [];
    const opt = (value, label, selected) => `<option value="${this._esc(value)}"${selected ? ' selected' : ''}>${this._esc(label)}</option>`;

    // Interval is stored in minutes; the form splits it into value + unit.
    const every = Number(s.everyMinutes) || 60;
    const unit = every % 1440 === 0 ? 1440 : (every % 60 === 0 ? 60 : 1);

    modal.innerHTML = `<div class="sched-modal-content" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Edit' : 'New'} scheduled task">
      <h3>${isEdit ? 'Edit' : 'New'} Scheduled Task</h3>

      <label for="sm-name">Task name</label>
      <input type="text" id="sm-name" value="${this._esc(source.name || '')}" placeholder="What is this for?">

      <label for="sm-type">Schedule</label>
      <select id="sm-type">
        ${opt('interval', 'Every N minutes / hours', s.type === 'interval')}
        ${opt('daily', 'Every day', s.type === 'daily')}
        ${opt('weekly', 'Certain weekdays', s.type === 'weekly')}
        ${opt('monthly', 'Once a month', s.type === 'monthly')}
        ${opt('once', 'Once, at a date and time', s.type === 'once')}
        ${opt('cron', 'Cron expression', s.type === 'cron')}
      </select>

      <div class="sm-field" data-for="interval">
        <label for="sm-every">Run every</label>
        <div class="sched-inline">
          <input type="number" id="sm-every" min="1" max="1000" value="${Math.max(1, Math.round(every / unit))}">
          <select id="sm-every-unit">
            ${opt('1', 'minutes', unit === 1)}
            ${opt('60', 'hours', unit === 60)}
            ${opt('1440', 'days', unit === 1440)}
          </select>
        </div>
      </div>

      <div class="sm-field" data-for="daily weekly monthly once">
        <label for="sm-time">Time</label>
        <input type="time" id="sm-time" value="${this._esc(s.time)}">
      </div>

      <div class="sm-field" data-for="weekly">
        <label>Days of the week</label>
        <div class="sched-days-row">${days.map((d, i) => `<button type="button" class="sched-day-btn${selDays.includes(i) ? ' selected' : ''}" data-day="${i}" aria-pressed="${selDays.includes(i)}">${d}</button>`).join('')}</div>
      </div>

      <div class="sm-field" data-for="monthly">
        <label for="sm-dom">Day of the month</label>
        <select id="sm-dom">
          ${Array.from({ length: 31 }, (_, i) => opt(String(i + 1), Scheduler._ordinal(i + 1), String(s.dayOfMonth) === String(i + 1))).join('')}
          ${opt('last', 'Last day of the month', s.dayOfMonth === 'last')}
        </select>
        <div class="sm-hint">Short months clamp down — the 31st runs on the 28th in February, never in March.</div>
      </div>

      <div class="sm-field" data-for="once">
        <label for="sm-date">Date</label>
        <input type="date" id="sm-date" value="${this._esc(s.date)}">
      </div>

      <div class="sm-field" data-for="cron">
        <label for="sm-cron">Cron expression</label>
        <input type="text" id="sm-cron" value="${this._esc(s.cron)}" placeholder="0 9 * * 1-5" spellcheck="false">
        <div class="sm-hint">minute hour day-of-month month day-of-week. Ranges, lists and steps work: <code>*/15 9-17 * * mon-fri</code>.</div>
      </div>

      <label for="sm-action">Do what</label>
      <select id="sm-action">
        ${Object.entries(Scheduler.ACTIONS).map(([id, spec]) => opt(id, spec.label, action.type === id)).join('')}
      </select>
      <div class="sm-hint" id="sm-action-hint"></div>

      <div class="sm-afield" data-for="agent">
        <label for="sm-prompt">Prompt</label>
        <textarea id="sm-prompt" placeholder="What should the agent do?">${this._esc(action.prompt || '')}</textarea>
        <label for="sm-url">Starting page (optional)</label>
        <input type="text" id="sm-url" value="${this._esc(action.startingUrl || '')}" placeholder="https://...">
      </div>

      <div class="sm-afield" data-for="openUrls">
        <label for="sm-urls">URLs, one per line</label>
        <textarea id="sm-urls" placeholder="https://example.com">${this._esc(action.urls || '')}</textarea>
        <label class="sched-check"><input type="checkbox" id="sm-bg"${action.background ? ' checked' : ''}> Open in the background</label>
      </div>

      <div class="sm-afield" data-for="reload">
        <label for="sm-match">Only tabs whose URL contains</label>
        <input type="text" id="sm-match" value="${this._esc(action.match || '')}" placeholder="leave empty for every tab">
      </div>

      <div class="sm-afield" data-for="saveSession">
        <label for="sm-session">Session name</label>
        <input type="text" id="sm-session" value="${this._esc(action.sessionName || 'Auto')}" placeholder="Auto">
      </div>

      <div class="sm-afield" data-for="reminder">
        <label for="sm-message">Reminder text</label>
        <textarea id="sm-message" placeholder="Time to...">${this._esc(action.message || '')}</textarea>
      </div>

      <div class="sm-afield" data-for="clearBrowsingData">
        <div class="sm-warn">This wipes cache, cookies, history and saved sessions every time it runs. You will be signed out of sites.</div>
      </div>

      <label for="sm-catchup">If Vex was closed at that moment</label>
      <select id="sm-catchup">
        ${opt('run', 'Run it as soon as Vex opens', source.catchUp !== false)}
        ${opt('skip', 'Skip that run', source.catchUp === false)}
      </select>
      <div class="sm-field" data-for="catchup">
        <label for="sm-window">…but only if less than</label>
        <select id="sm-window">
          ${[['60', '1 hour'], ['360', '6 hours'], ['720', '12 hours'], ['1440', '1 day'], ['4320', '3 days'], ['10080', '7 days']]
            .map(([v, l]) => opt(v, l + ' late', String(source.catchUpWindowMin || 720) === v)).join('')}
        </select>
      </div>

      <label class="sched-check"><input type="checkbox" id="sm-notify-ok"${source.notifyOnComplete !== false ? ' checked' : ''}> Notify me when it succeeds</label>
      <label class="sched-check"><input type="checkbox" id="sm-notify-fail"${source.notifyOnFail !== false ? ' checked' : ''}> Notify me when it fails</label>

      <div class="sm-preview" id="sm-preview"></div>
      <div class="sm-errors" id="sm-errors" role="alert"></div>

      <div class="sched-modal-actions">
        <button class="sched-btn-cancel" id="sm-cancel">Cancel</button>
        <button class="sched-btn-save" id="sm-save">${isEdit ? 'Save changes' : 'Create task'}</button>
      </div>
    </div>`;

    modal.classList.add('visible');

    const q = sel => modal.querySelector(sel);
    const collect = () => {
      const type = q('#sm-type').value;
      const selectedDays = Array.from(modal.querySelectorAll('.sched-day-btn.selected')).map(b => Number(b.dataset.day));
      const actionType = q('#sm-action').value;
      const built = { type: actionType };
      if (actionType === 'agent') {
        built.prompt = q('#sm-prompt').value.trim();
        built.startingUrl = q('#sm-url').value.trim();
        built.maxIterations = action.maxIterations || 15;
      } else if (actionType === 'openUrls') {
        built.urls = q('#sm-urls').value.trim();
        built.background = q('#sm-bg').checked;
      } else if (actionType === 'reload') {
        built.match = q('#sm-match').value.trim();
      } else if (actionType === 'saveSession') {
        built.sessionName = q('#sm-session').value.trim() || 'Auto';
      } else if (actionType === 'reminder') {
        built.message = q('#sm-message').value.trim();
      }
      return {
        name: q('#sm-name').value.trim(),
        schedule: {
          type,
          time: q('#sm-time').value || '09:00',
          daysOfWeek: selectedDays,
          dayOfMonth: q('#sm-dom').value === 'last' ? 'last' : Number(q('#sm-dom').value),
          date: q('#sm-date').value,
          cron: q('#sm-cron').value.trim(),
          everyMinutes: Math.max(1, Number(q('#sm-every').value) || 1) * Number(q('#sm-every-unit').value),
          anchor: s.anchor,
        },
        action: built,
        catchUp: q('#sm-catchup').value === 'run',
        catchUpWindowMin: Number(q('#sm-window').value) || 720,
        notifyOnComplete: q('#sm-notify-ok').checked,
        notifyOnFail: q('#sm-notify-fail').checked,
      };
    };

    const refresh = () => {
      const type = q('#sm-type').value;
      const actionType = q('#sm-action').value;
      // Time belongs to everything except interval and cron.
      modal.querySelectorAll('.sm-field').forEach(el => {
        const targets = el.dataset.for.split(' ');
        let show;
        if (targets.includes('catchup')) show = q('#sm-catchup').value === 'run';
        else show = targets.includes(type);
        el.style.display = show ? 'block' : 'none';
      });
      modal.querySelectorAll('.sm-afield').forEach(el => {
        el.style.display = el.dataset.for === actionType ? 'block' : 'none';
      });
      q('#sm-action-hint').textContent = Scheduler.ACTIONS[actionType]?.hint || '';

      const draft = collect();
      const errors = Scheduler.validate(draft);
      const preview = q('#sm-preview');
      // A preview is only meaningful once the schedule itself is valid.
      const scheduleBroken = errors.some(e => /cron|day of the week|date/i.test(e));
      if (scheduleBroken) {
        preview.textContent = '';
      } else {
        const probe = { ...draft, enabled: true, runCount: 0 };
        const upcoming = [];
        let from = Date.now();
        for (let i = 0; i < 3; i++) {
          const n = Scheduler.nextOccurrence(probe, from);
          if (n === null) break;
          upcoming.push(n);
          from = n;
        }
        preview.innerHTML = upcoming.length
          ? `${this._icon('clock', 12)}<span>${this._esc(Scheduler.describeSchedule(probe))} — next: ${this._esc(Scheduler.describeNextRun(probe))}${upcoming.length > 1 ? ', then ' + this._esc(upcoming.slice(1).map(ms => this._when(new Date(ms).toISOString())).join(', ')) : ''}</span>`
          : `${this._icon('skip', 12)}<span>This schedule will never run.</span>`;
      }
      q('#sm-errors').innerHTML = errors.map(e => `<div>${this._esc(e)}</div>`).join('');
      return errors;
    };

    modal.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', refresh);
      el.addEventListener('change', refresh);
    });
    modal.querySelectorAll('.sched-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('selected');
        btn.setAttribute('aria-pressed', String(btn.classList.contains('selected')));
        refresh();
      });
    });
    refresh();

    // #sched-modal is persistent, so the backdrop listener would stack one copy
    // per open. The inner controls are rebuilt each time and do not leak.
    if (!modal._backdropWired) {
      modal._backdropWired = true;
      modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('visible'); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('visible')) modal.classList.remove('visible');
      });
    }

    q('#sm-cancel').addEventListener('click', () => modal.classList.remove('visible'));
    q('#sm-save').addEventListener('click', () => {
      const data = collect();
      const errors = refresh();
      if (errors.length) { window.showToast?.(errors[0]); return; }

      if (isEdit) Scheduler.updateTask(existing.id, data);
      else Scheduler.createTask(data);

      modal.classList.remove('visible');
      this._activeTab = 'active';
      document.querySelectorAll('.sched-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === 'active');
        b.setAttribute('aria-selected', String(b.dataset.tab === 'active'));
      });
      this._render();
      window.showToast?.(isEdit ? 'Task updated' : 'Task created');
    });

    q('#sm-name').focus();
  },

  _esc(s) { return window.escapeHtml(s); },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { SchedulesPanel, TASK_TEMPLATES };
