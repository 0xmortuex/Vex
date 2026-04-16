// === Vex Schedules Panel ===

const TASK_TEMPLATES = [
  { name: 'Morning CUSA Briefing', description: 'Summarize CUSA announcements every morning', frequency: 'daily', time: '08:00', startingUrl: 'https://discord.com/app', prompt: 'Go to CUSA Discord announcements. Summarize the last 24 hours of messages.' },
  { name: 'GitHub Trending Check', description: 'Daily trending JS repos', frequency: 'daily', time: '12:00', startingUrl: 'https://github.com/trending/javascript', prompt: 'List the top 5 trending JavaScript repos today with name, description, and stars.' },
  { name: 'Weather Forecast', description: 'Morning weather for Istanbul', frequency: 'daily', time: '07:30', startingUrl: 'https://weather.com/', prompt: 'Get today\'s weather for Istanbul: current temp, high/low, conditions.' },
  { name: 'News Briefing', description: 'Top 5 news headlines', frequency: 'daily', time: '09:00', startingUrl: 'https://news.google.com/', prompt: 'List top 5 news headlines with one-sentence summaries.' },
  { name: 'Weekly Roblox Trades', description: 'Check Roblox trade offers on Sunday', frequency: 'weekly', daysOfWeek: [0], time: '10:00', startingUrl: 'https://www.roblox.com/trades', prompt: 'Check active trade offers. List new incoming offers.' }
];

const SchedulesPanel = {
  _activeTab: 'active',

  init() {
    const panel = document.getElementById('panel-schedules');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="sched-container">
        <div class="sched-header">
          <h2>Scheduled Tasks</h2>
          <div class="sched-header-row">
            <div class="sched-tabs">
              <button class="sched-tab active" data-tab="active">Active</button>
              <button class="sched-tab" data-tab="history">History</button>
              <button class="sched-tab" data-tab="templates">Templates</button>
            </div>
            <button class="sched-new-btn" id="sched-new-btn">+ New Task</button>
          </div>
        </div>
        <div class="sched-content" id="sched-content"></div>
      </div>
    `;

    panel.querySelectorAll('.sched-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.sched-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activeTab = btn.dataset.tab;
        this._render();
      });
    });

    document.getElementById('sched-new-btn')?.addEventListener('click', () => this.showModal());
    this._render();
  },

  _render() {
    if (this._activeTab === 'active') this._renderActive();
    else if (this._activeTab === 'history') this._renderHistory();
    else if (this._activeTab === 'templates') this._renderTemplates();
  },

  _renderActive() {
    const c = document.getElementById('sched-content');
    if (!c) return;
    const tasks = Scheduler.getAllTasks();

    if (tasks.length === 0) {
      c.innerHTML = '<div class="sched-empty">No scheduled tasks yet. Create one or use a template.</div>';
      return;
    }

    c.innerHTML = tasks.map(t => {
      const next = Scheduler.calculateNextRun(t);
      const nextStr = next ? this._timeUntil(next) : 'Not scheduled';
      const freqStr = t.frequency === 'daily' ? 'Daily at ' + t.time :
        t.frequency === 'weekly' ? 'Weekly at ' + t.time :
        t.frequency === 'monthly' ? 'Monthly on day ' + t.dayOfMonth :
        t.frequency === 'once' ? 'Once at ' + t.time : t.frequency;
      const statusIcon = t.lastRunResult === 'success' ? '\u2713' : t.lastRunResult === 'failed' ? '\u2717' : '\u2014';

      return `<div class="sched-card" data-id="${t.id}">
        <div class="sched-card-header">
          <span class="sched-card-name">${this._esc(t.name)}</span>
          <button class="sched-card-toggle${t.enabled ? ' on' : ''}" data-action="toggle"></button>
        </div>
        <div class="sched-card-meta">
          <span>${freqStr}</span><span>Next: ${nextStr}</span><span>Last: ${statusIcon}</span><span>Runs: ${t.runCount || 0}</span>
        </div>
        <div class="sched-card-prompt">${this._esc(t.prompt)}</div>
        <div class="sched-card-actions">
          <button data-action="run">Run Now</button>
          <button data-action="edit">Edit</button>
          <button data-action="delete" class="danger">Delete</button>
        </div>
      </div>`;
    }).join('');

    c.querySelectorAll('.sched-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
        const task = Scheduler.getAllTasks().find(t => t.id === id);
        if (task) { Scheduler.updateTask(id, { enabled: !task.enabled }); this._render(); }
      });
      card.querySelector('[data-action="run"]')?.addEventListener('click', () => {
        const task = Scheduler.getAllTasks().find(t => t.id === id);
        if (task) Scheduler.runTask(task, true);
      });
      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        const task = Scheduler.getAllTasks().find(t => t.id === id);
        if (task) this.showModal(task);
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        Scheduler.deleteTask(id);
        this._render();
      });
    });
  },

  _renderHistory() {
    const c = document.getElementById('sched-content');
    if (!c) return;
    const history = Scheduler.getHistory();

    if (history.length === 0) {
      c.innerHTML = '<div class="sched-empty">No task history yet.</div>';
      return;
    }

    c.innerHTML = '<div style="text-align:right;margin-bottom:8px"><button id="sched-clear-hist" style="font-size:11px;background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:4px 10px;border-radius:4px;cursor:pointer">Clear History</button></div>' +
      history.slice(0, 50).map(r => {
        const time = new Date(r.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="sched-hist-item">
          <span class="sched-hist-icon">${r.success ? '\u2705' : '\u274C'}</span>
          <div class="sched-hist-info">
            <div class="sched-hist-name">${this._esc(r.taskName)}</div>
            <div class="sched-hist-detail">${this._esc(r.success ? (r.summary || 'OK') : (r.error || 'Failed'))}</div>
          </div>
          <span class="sched-hist-time">${time}</span>
        </div>`;
      }).join('');

    document.getElementById('sched-clear-hist')?.addEventListener('click', () => {
      Scheduler.clearHistory();
      this._render();
    });
  },

  _renderTemplates() {
    const c = document.getElementById('sched-content');
    if (!c) return;

    c.innerHTML = TASK_TEMPLATES.map((t, i) => `
      <div class="sched-template" data-idx="${i}">
        <div class="sched-template-name">${this._esc(t.name)}</div>
        <div class="sched-template-desc">${this._esc(t.description)}</div>
      </div>
    `).join('');

    c.querySelectorAll('.sched-template').forEach(el => {
      el.addEventListener('click', () => {
        const t = TASK_TEMPLATES[parseInt(el.dataset.idx)];
        if (t) this.showModal(t);
      });
    });
  },

  showModal(existing) {
    let modal = document.getElementById('sched-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sched-modal';
      modal.className = 'sched-modal';
      document.body.appendChild(modal);
    }

    const isEdit = existing?.id;
    const data = existing || {};
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const selDays = data.daysOfWeek || [];

    modal.innerHTML = `<div class="sched-modal-content">
      <h3>${isEdit ? 'Edit' : 'New'} Scheduled Task</h3>
      <label>Task Name</label>
      <input type="text" id="sm-name" value="${this._esc(data.name || '')}" placeholder="My task...">
      <label>Frequency</label>
      <select id="sm-freq">
        <option value="once"${data.frequency==='once'?' selected':''}>Once</option>
        <option value="daily"${(!data.frequency||data.frequency==='daily')?' selected':''}>Daily</option>
        <option value="weekly"${data.frequency==='weekly'?' selected':''}>Weekly</option>
        <option value="monthly"${data.frequency==='monthly'?' selected':''}>Monthly</option>
      </select>
      <label>Time</label>
      <input type="time" id="sm-time" value="${data.time || '09:00'}">
      <div id="sm-days-wrap" style="display:${data.frequency==='weekly'?'block':'none'}">
        <label>Days of Week</label>
        <div class="sched-days-row">${days.map((d,i) => `<button class="sched-day-btn${selDays.includes(i)?' selected':''}" data-day="${i}">${d}</button>`).join('')}</div>
      </div>
      <label>Starting URL (optional)</label>
      <input type="text" id="sm-url" value="${this._esc(data.startingUrl || '')}" placeholder="https://...">
      <label>Task Prompt</label>
      <textarea id="sm-prompt" placeholder="What should Vex do?">${this._esc(data.prompt || '')}</textarea>
      <div class="sched-modal-actions">
        <button class="sched-btn-cancel" id="sm-cancel">Cancel</button>
        <button class="sched-btn-save" id="sm-save">Save</button>
      </div>
    </div>`;

    modal.classList.add('visible');

    // Frequency change shows/hides days
    modal.querySelector('#sm-freq').addEventListener('change', (e) => {
      modal.querySelector('#sm-days-wrap').style.display = e.target.value === 'weekly' ? 'block' : 'none';
    });

    // Day selection
    modal.querySelectorAll('.sched-day-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
    modal.querySelector('#sm-cancel').addEventListener('click', () => modal.classList.remove('visible'));
    modal.querySelector('#sm-save').addEventListener('click', () => {
      const name = modal.querySelector('#sm-name').value.trim();
      const prompt = modal.querySelector('#sm-prompt').value.trim();
      if (!name || !prompt) { window.showToast?.('Name and prompt required'); return; }

      const selectedDays = Array.from(modal.querySelectorAll('.sched-day-btn.selected')).map(b => parseInt(b.dataset.day));
      const taskData = {
        name,
        frequency: modal.querySelector('#sm-freq').value,
        time: modal.querySelector('#sm-time').value,
        daysOfWeek: selectedDays,
        startingUrl: modal.querySelector('#sm-url').value.trim(),
        prompt
      };

      if (isEdit) {
        Scheduler.updateTask(existing.id, taskData);
      } else {
        Scheduler.createTask(taskData);
      }

      modal.classList.remove('visible');
      this._activeTab = 'active';
      document.querySelectorAll('.sched-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'active'));
      this._render();
      window.showToast?.('Task saved');
    });
  },

  _timeUntil(date) {
    const ms = date - new Date();
    if (ms < 0) return 'overdue';
    if (ms < 60000) return 'in < 1 min';
    if (ms < 3600000) return 'in ' + Math.round(ms / 60000) + ' min';
    if (ms < 86400000) return 'in ' + Math.round(ms / 3600000) + ' hr';
    return 'in ' + Math.round(ms / 86400000) + ' days';
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
