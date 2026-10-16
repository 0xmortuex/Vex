// === Vex Agent task panel ===
//
// The visible side of agent-task-runner.js: say what you want, read the plan,
// approve it, watch it work, and stop it whenever you like.
//
//   goal  ->  PLAN (every step listed, marked "looks only" or "asks you first")
//         ->  Approve  ->  live step log with a status per step
//         ->  every step that writes shows the exact element and value and
//             waits for Allow / Skip / Stop
//
// Off until turned on in this panel or Settings. The red kill switch stops the
// run, switches the feature off and stops page-script schedules. The model is
// the LOCAL one unless your backend is already cloud and you ticked "use
// cloud" for the agent.
//
// Nothing here is available in a private window. State: 'vex.agentTask.*'
// (agent-safety.js), the run log in 'vex.agentTask.log'; local only.
// Depends on AgentSafety, AgentTaskRunner, TaskRun, AgentActionLog, AIRouter,
// AgentTools, AgentExecutor, TabManager, WebviewManager, VexIcons.

const AgentTaskPanel = {
  _el: null,
  _run: null,
  _plan: null,        // { goal, steps, trimmed, backend }
  _planning: null,    // AbortController while the model writes the plan
  _tick: null,
  _pending: null,     // { resolve } for the write-step confirmation card in view

  _esc(s) { return window.escapeHtml(String(s == null ? '' : s)); },
  _icon(name, size) { return window.VexIcons && VexIcons.has(name) ? VexIcons.svg(name, { size: size || 16 }) : ''; },

  available() { return AgentSafety.available(); },
  isOpen() { return !!this._el; },

  // --- the model -----------------------------------------------------------------
  backend() {
    const status = typeof AIRouter !== 'undefined' && AIRouter.getOllamaStatus ? AIRouter.getOllamaStatus() : {};
    return AgentSafety.chooseBackend(AgentSafety.prefs(), status);
  },

  async _ask(prompt, signal) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI router is not available');
    const backend = this.backend();
    if (backend === 'local') {
      if (!AIRouter.isOllamaAvailable()) {
        let up = false;
        try { up = await AIRouter.ollamaUp(); } catch { up = false; }
        if (!up) throw new Error('The local AI is not running. Start Ollama (Settings › AI) - the agent task runner uses the local model unless you tick "use cloud" for it.');
      }
    }
    // callOn: exactly this backend, no quiet fall-back to the other one.
    const out = await AIRouter.callOn(backend, 'chat', { message: prompt, conversationHistory: [], signal });
    return AgentTaskRunner.replyText(out);
  },

  async makePlan(goal) {
    const prefs = AgentSafety.prefs();
    const ctl = new AbortController();
    this._planning = ctl;
    try {
      const text = await this._ask(AgentTaskRunner.planPrompt(goal, prefs.maxSteps), ctl.signal);
      const parsed = AgentTaskRunner.parsePlan(text, { maxSteps: prefs.maxSteps });
      if (parsed.errors.length) throw new Error('The plan was refused: ' + parsed.errors.slice(0, 3).join('; '));
      return { goal, steps: parsed.steps, trimmed: parsed.trimmed, backend: this.backend() };
    } finally { this._planning = null; }
  },

  // --- the real dependencies of a run ---------------------------------------------------
  _eval(wv, code) {
    if (window.vexGuestEval) return window.vexGuestEval(wv, code);
    return wv.executeJavaScript(code);
  },
  _tab() {
    const t = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = t && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(t.id) : null;
    let url = t ? t.url : '';
    try { if (wv && typeof wv.getURL === 'function') url = wv.getURL() || url; } catch { /* use the tab's */ }
    return { webview: wv, url, tabId: t && t.id };
  },

  _deps() {
    const self = this;
    return {
      safety: AgentSafety,
      tab: () => self._tab(),
      async probe(step) {
        const t = self._tab();
        const nonce = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        step._nonce = nonce;
        return self._eval(t.webview, AgentTaskRunner.probeCode(step, nonce));
      },
      async exec(step, ctx) {
        const wv = ctx.tab && ctx.tab.webview;
        switch (step.op) {
          case 'search': {
            const r = await AgentTools.webSearch(step.query, 8);
            const text = r.results.map((x, i) => (i + 1) + '. ' + x.title + '\n   ' + x.url + '\n   ' + x.snippet).join('\n');
            return { ok: true, summary: r.results.length + ' results from ' + r.engine, text, title: 'Search: ' + step.query };
          }
          case 'read_url': {
            const r = await AgentTools.readUrl(step.url);
            return { ok: true, summary: r.title || step.url, text: (r.title ? r.title + '\n' : '') + (r.text || ''), title: (r.title || step.url) + ' (' + step.url + ')' };
          }
          case 'navigate': {
            const r = await AgentExecutor.executeTool('navigate', { url: step.url }, { webview: wv });
            return r.ok ? { ok: true, summary: 'Opened ' + step.url } : { ok: false, error: r.error };
          }
          case 'read_page': {
            const r = await self._eval(wv, AgentTaskRunner.readPageCode());
            return { ok: true, summary: (r.title || r.url), text: r.text, title: (r.title || '') + ' (' + r.url + ')' };
          }
          case 'scroll': {
            const r = await AgentExecutor.executeTool('scroll', { direction: step.direction, amount: 600 }, { webview: wv });
            return r.ok ? { ok: true, summary: 'Scrolled ' + step.direction } : { ok: false, error: r.error };
          }
          case 'find': {
            const r = await AgentExecutor.executeTool('search_in_page', { query: step.text }, { webview: wv });
            const f = r.ok && r.result;
            return f && f.found ? { ok: true, summary: 'Found it', text: f.excerpt, title: 'Found "' + step.text + '"' } : { ok: true, summary: 'Not on this page' };
          }
          case 'wait': {
            await new Promise(res => setTimeout(res, step.ms));
            return { ok: true, summary: 'Waited ' + step.ms + ' ms' };
          }
          case 'type': case 'select': case 'click': {
            const r = await self._eval(wv, AgentTaskRunner.writeCode(step, step._nonce));
            if (r && r.ok && typeof AgentExecutor._settle === 'function') { try { await AgentExecutor._settle(wv, 600); } catch { /* the page is still moving */ } }
            return r || { ok: false, error: 'No answer from the page' };
          }
          default: return { ok: false, error: 'Not a step the agent can do' };
        }
      },
      confirm: (info) => self._askWrite(info),
      confirmFresh: (info) => window.vexConfirm({
        title: 'Send this form to another site?',
        message: 'This step would post a form to ' + info.origin + ', which is not the page you are on.\n\n' + info.text,
        okLabel: 'Send it', danger: true,
      }),
      summarize: (goal, obs, signal) => self._ask(AgentTaskRunner.summaryPrompt(goal, obs), signal),
      onChange: (run) => { self._persist(run); self._renderRun(); },
    };
  },

  _persist(run) {
    try { AgentActionLog.upsert(run.snapshot()); } catch (err) { console.error('[AgentTask] the action log could not be saved:', err); }
  },

  _askWrite(info) {
    return new Promise((resolve) => {
      this._pending = { info, resolve: (v) => { this._pending = null; resolve(v); this._renderRun(); } };
      this._renderRun();
      this._el?.querySelector('[data-act=allow]')?.focus();
    });
  },

  // --- running -------------------------------------------------------------------------
  async startRun() {
    if (!this._plan) return;
    if (!AgentSafety.enabled()) throw new Error('The Vex agent is off');
    const prefs = AgentSafety.prefs();
    const budget = new AgentBudget({ maxSteps: prefs.maxSteps, maxMs: prefs.maxMinutes * 60000 });
    const run = new TaskRun({ goal: this._plan.goal, steps: this._plan.steps, deps: this._deps(), budget, backend: this._plan.backend, scope: { readOnly: this._plan.readOnly === true } });
    this._run = run;
    this._plan = null;
    this._renderRun();
    this._tick = setInterval(() => this._renderMeta(), 1000);
    try { await run.run(); }
    finally {
      clearInterval(this._tick); this._tick = null;
      if (this._pending) this._pending.resolve('stop');
      this._persist(run);
      this._renderRun();
      if (run.status === 'done' || run.status === 'blocked' || run.status === 'failed') window.showToast?.('Agent task ' + run.status + (run.reason ? ': ' + run.reason : ''), run.status === 'done' ? undefined : 'error');
    }
  },

  // --- the panel -----------------------------------------------------------------------
  open() {
    if (!this.available()) { window.showToast?.('The Vex agent is not available in a private window', 'error'); return null; }
    if (this._el) { this._el.querySelector('textarea, button')?.focus(); return this._el; }
    const el = document.createElement('aside');
    el.id = 'vex-agent-task-panel';
    el.className = 'vex-agent-task';
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'Agent task');
    document.body.appendChild(el);
    this._el = el;
    this._offKill = AgentSafety.onKill((why) => { window.showToast?.('Agent stopped: ' + why); this._renderRun(); });
    this._render();
    return el;
  },

  close() {
    if (this._run && !this._run.endedAt) this._run.stop('You closed the panel');
    if (this._planning) this._planning.abort();
    if (this._pending) this._pending.resolve('stop');
    if (this._offKill) { this._offKill(); this._offKill = null; }
    clearInterval(this._tick); this._tick = null;
    this._el?.remove();
    this._el = null;
  },

  _render() {
    if (!this._el) return;
    if (this._run) return this._renderRun();
    const on = AgentSafety.enabled();
    const prefs = AgentSafety.prefs();
    const status = typeof AIRouter !== 'undefined' && AIRouter.getOllamaStatus ? AIRouter.getOllamaStatus() : {};
    const backend = this.backend();
    const log = AgentActionLog.all();
    const body = on ? `
      <label for="vex-at-goal" class="vex-at-label">What should it do?</label>
      <textarea id="vex-at-goal" rows="3" maxlength="${AgentTaskRunner.MAX_GOAL}" placeholder="compare these three laptops, find the cheapest slot..." spellcheck="true"></textarea>
      <div class="vex-at-meta">Model: ${backend === 'cloud' ? 'cloud (you allowed it for the agent)' : 'local (' + this._esc((typeof AIRouter !== 'undefined' && AIRouter.getModel && AIRouter.getModel()) || 'Ollama') + ')'}
        · up to ${prefs.maxSteps} steps, ${prefs.maxMinutes} min</div>
      ${status.forceCloud ? `<label class="vex-at-check"><input type="checkbox" id="vex-at-cloud" ${prefs.useCloud ? 'checked' : ''}> Use the cloud model for the agent (page text read by the agent is sent to it)</label>` : ''}
      <div class="vex-at-actions"><button type="button" class="vex-at-btn vex-at-primary" data-act="plan">Make a plan</button></div>
      <div class="vex-at-note">It lists every step first. Reading pages needs one approval; typing, choosing and clicking ask you each time. It never touches passwords, cards or codes, never works in private or Tor tabs, never downloads.</div>`
      : `<p class="vex-at-note">The agent task runner is off. When on, Vex plans a task, shows you every step, and then works through pages while you watch. Anything that types or clicks asks first.</p>
         <div class="vex-at-actions"><button type="button" class="vex-at-btn vex-at-primary" data-act="enable">Turn on</button></div>`;
    this._el.innerHTML = `
      <header class="vex-at-head">
        <span class="vex-at-title">${this._icon('robot')} Agent task</span>
        <span class="vex-at-head-btns">
          <button type="button" class="vex-at-btn vex-at-kill" data-act="kill" title="Stop everything and switch the agent off">${this._icon('stop', 14)} Kill switch</button>
          <button type="button" class="vex-at-btn vex-at-icon" data-act="close" aria-label="Close the agent task panel">${this._icon('x', 14)}</button>
        </span>
      </header>
      <div class="vex-at-body">${body}
        <div class="vex-at-plan" id="vex-at-plan" aria-live="polite"></div>
        <details class="vex-at-history"><summary>Action log (${log.length})</summary>
          <div class="vex-at-log-list">${log.slice(0, 20).map(r => `<details><summary>${this._esc(r.status)} · ${this._esc(String(r.goal).slice(0, 70))}</summary><ol>${(r.steps || []).map(s => `<li>${this._esc(s.status)} - ${this._esc(s.text)}${s.result ? ' <em>' + this._esc(s.result) + '</em>' : ''}</li>`).join('')}</ol></details>`).join('') || '<div class="vex-at-note">Nothing yet.</div>'}</div>
          ${log.length ? '<button type="button" class="vex-at-btn" data-act="clearlog">Clear the log</button>' : ''}
        </details>
      </div>`;
    this._wire();
    if (this._plan) this._renderPlan();
  },

  _wire() {
    const el = this._el;
    el.querySelector('[data-act=close]').addEventListener('click', () => this.close());
    el.querySelector('[data-act=kill]').addEventListener('click', () => { AgentSafety.kill('Kill switch pressed in the agent panel'); this._render(); });
    el.querySelector('[data-act=enable]')?.addEventListener('click', async () => {
      const ok = await window.vexConfirm({
        title: 'Turn on the agent task runner?',
        message: 'Vex will plan tasks and then work through web pages for you. Reading and searching run after you approve the plan; typing, choosing and clicking ask you every time. It never types or reads passwords, card details or codes, never works in private, Tor or routed tabs or on sites you excluded, and never downloads files. It stops at the step and time budgets, and the kill switch is always in this panel.',
        okLabel: 'Turn on',
      });
      if (ok) { AgentSafety.setEnabled(true); this._render(); }
    });
    el.querySelector('#vex-at-cloud')?.addEventListener('change', (e) => { AgentSafety.setPrefs({ useCloud: e.target.checked }); this._render(); });
    el.querySelector('[data-act=plan]')?.addEventListener('click', async (e) => {
      const goal = el.querySelector('#vex-at-goal').value.trim();
      if (!goal) { window.showToast?.('Say what it should do first', 'error'); return; }
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Planning...';
      try { this._plan = await this.makePlan(goal); this._renderPlan(); }
      catch (err) { window.showToast?.(err.message, 'error'); const p = el.querySelector('#vex-at-plan'); if (p) p.innerHTML = '<div class="vex-at-error" role="alert">' + this._esc(err.message) + '</div>'; }
      finally { btn.disabled = false; btn.textContent = 'Make a plan'; }
    });
    el.querySelector('[data-act=clearlog]')?.addEventListener('click', async () => {
      if (await window.vexConfirm({ title: 'Clear the action log?', message: 'This removes the record of every agent task.', okLabel: 'Clear', danger: true })) { AgentActionLog.clear(); this._render(); }
    });
  },

  _renderPlan() {
    const box = this._el && this._el.querySelector('#vex-at-plan');
    if (!box || !this._plan) return;
    const p = this._plan;
    box.innerHTML = `<h3 class="vex-at-h">Plan - ${p.steps.length} step${p.steps.length === 1 ? '' : 's'}</h3>
      ${p.trimmed ? `<div class="vex-at-note">The plan was longer than your budget; ${p.trimmed} step${p.trimmed === 1 ? ' was' : 's were'} cut.</div>` : ''}
      <ol class="vex-at-steps">${p.steps.map(s => `<li class="vex-at-step vex-at-${s.kind}"><span class="vex-at-badge">${s.kind === 'write' ? 'asks you first' : 'looks only'}</span> ${this._esc(AgentTaskRunner.describeStep(s))} ${this._whyButton(s)}${this._explainBlock(s, null)}</li>`).join('')}</ol>
      ${p.steps.some(s => s.kind === 'write') ? `<label class="vex-at-note"><input type="checkbox" data-act="readonly" ${p.readOnly ? 'checked' : ''}> Read-only run: skip every step that types, chooses or clicks</label>` : ''}
      <div class="vex-at-actions">
        <button type="button" class="vex-at-btn vex-at-primary" data-act="approve">${this._icon('play', 14)} Approve and run</button>
        <button type="button" class="vex-at-btn" data-act="discard">Discard</button>
      </div>`;
    box.querySelector('[data-act=discard]').addEventListener('click', () => { this._plan = null; box.innerHTML = ''; });
    box.querySelector('[data-act=readonly]')?.addEventListener('change', (e) => { p.readOnly = e.target.checked; });
    this._wireWhy(box, () => this._renderPlan());
    box.querySelector('[data-act=approve]').addEventListener('click', () => this.startRun().catch(err => { window.showToast?.(err.message, 'error'); this._run = null; this._render(); }));
  },

  _metaText(r) {
    const fmt = (n) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
    const head = r.endedAt ? r.status[0].toUpperCase() + r.status.slice(1) + (r.reason ? ': ' + r.reason : '') : (r.status === 'paused' ? 'Paused' : 'Working');
    return head + ' · step ' + Math.min(r.budget.used, r.budget.maxSteps) + ' of ' + r.budget.maxSteps + ' · ' + fmt(Math.round(r.budget.elapsed() / 1000)) + ' of ' + fmt(Math.round(r.budget.maxMs / 1000)) + ' · ' + (r.backend === 'cloud' ? 'cloud model' : 'local model');
  },

  // Once a second, only the counters: re-drawing the buttons under a pointer
  // that is mid-click would swallow the click.
  _renderMeta() {
    const m = this._el && this._run && this._el.querySelector('.vex-at-meta');
    if (m) m.textContent = this._metaText(this._run);
  },

  _renderRun() {
    if (!this._el || !this._run) return;
    const r = this._run;
    const done = !!r.endedAt;
    const pend = this._pending;
    const mark = { pending: 'waiting', running: 'working', awaiting: 'needs you', done: 'done', skipped: 'skipped', blocked: 'refused', failed: 'failed', stopped: 'stopped' };
    this._el.innerHTML = `
      <header class="vex-at-head">
        <span class="vex-at-title">${this._icon('robot')} Agent task</span>
        <span class="vex-at-head-btns">
          <button type="button" class="vex-at-btn vex-at-kill" data-act="kill" title="Stop everything and switch the agent off">${this._icon('stop', 14)} Kill switch</button>
          <button type="button" class="vex-at-btn vex-at-icon" data-act="close" aria-label="Close the agent task panel">${this._icon('x', 14)}</button>
        </span>
      </header>
      <div class="vex-at-body">
        <div class="vex-at-goal">${this._esc(r.goal)}</div>
        <div class="vex-at-meta" role="status">${this._esc(this._metaText(r))}</div>
        <div class="vex-at-actions">
          ${done ? '<button type="button" class="vex-at-btn" data-act="newtask">New task</button>' : `
            <button type="button" class="vex-at-btn" data-act="pause">${r.status === 'paused' ? this._icon('play', 14) + ' Resume' : this._icon('pause', 14) + ' Pause'}</button>
            <button type="button" class="vex-at-btn vex-at-danger" data-act="stop">${this._icon('stop', 14)} Stop</button>`}
        </div>
        ${pend ? `<div class="vex-at-confirm" role="alertdialog" aria-label="Allow this step?">
          <div class="vex-at-confirm-h">Allow this step?</div>
          <div class="vex-at-confirm-t">${this._esc(pend.info.text)}</div>
          <div class="vex-at-confirm-u">On ${this._esc(pend.info.url || '')}</div>
          <div class="vex-at-actions">
            <button type="button" class="vex-at-btn vex-at-primary" data-act="allow">Allow</button>
            <button type="button" class="vex-at-btn" data-act="skip">Skip it</button>
            <button type="button" class="vex-at-btn vex-at-danger" data-act="stopstep">Stop the task</button>
          </div></div>` : ''}
        <ol class="vex-at-steps">${r.steps.map(s => `<li class="vex-at-step vex-at-${s.status}"><span class="vex-at-badge">${mark[s.status] || s.status}</span> ${this._esc(AgentTaskRunner.describeStep(s))} ${this._whyButton(s)}${s.result ? `<div class="vex-at-result">${this._esc(s.result)}</div>` : ''}${this._explainBlock(s, r)}</li>`).join('')}</ol>
        ${r.shield && r.shield.hits ? `<div class="vex-at-note">${r.shield.hits} instruction-like phrase${r.shield.hits === 1 ? '' : 's'} on the pages ${r.shield.hits === 1 ? 'was' : 'were'} removed before the model saw ${r.shield.hits === 1 ? 'it' : 'them'}: page text is data, never orders.</div>` : ''}
        ${r.answer ? `<h3 class="vex-at-h">Answer</h3><div class="vex-at-answer">${this._esc(r.answer)}</div>` : ''}
        <details class="vex-at-history" ${done ? '' : 'open'}><summary>Live log</summary>
          <ul class="vex-at-livelog" aria-live="polite">${r.log.slice(-40).map(l => `<li>${new Date(l.at).toLocaleTimeString()} ${this._esc(l.text)}</li>`).join('')}</ul></details>
      </div>`;
    const q = (a) => this._el.querySelector('[data-act=' + a + ']');
    q('close').addEventListener('click', () => this.close());
    q('kill').addEventListener('click', () => AgentSafety.kill('Kill switch pressed in the agent panel'));
    q('pause')?.addEventListener('click', () => { r.status === 'paused' ? r.resume() : r.pause(); this._renderRun(); });
    q('stop')?.addEventListener('click', () => r.stop('You stopped it'));
    q('newtask')?.addEventListener('click', () => { this._run = null; this._render(); });
    q('allow')?.addEventListener('click', () => pend.resolve('allow'));
    q('skip')?.addEventListener('click', () => pend.resolve('skip'));
    q('stopstep')?.addEventListener('click', () => pend.resolve('stop'));
    this._wireWhy(this._el, () => this._renderRun());
  },

  // "Explain this step": which steps have their explanation open (by step number).
  _explained: new Set(),
  _whyButton(s) {
    const open = this._explained.has(s.id);
    return `<button type="button" class="vex-at-why" data-why="${s.id}" aria-expanded="${open}">${open ? 'Hide' : 'Why?'}</button>`;
  },
  _explainBlock(s, run) {
    if (!this._explained.has(s.id)) return '';
    const e = AgentTaskRunner.explainStep(s, run);
    return `<div class="vex-at-explain" role="note" aria-label="Explanation of step ${s.id}">${e.lines.map(l => '<div>' + this._esc(l) + '</div>').join('')}</div>`;
  },
  _wireWhy(root, redraw) {
    root.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.why);
      if (this._explained.has(id)) this._explained.delete(id); else this._explained.add(id);
      redraw();
    }));
  },

  // --- Settings + Ctrl+K -----------------------------------------------------------------
  renderSettings(container) {
    if (!container) return;
    if (!this.available()) { container.innerHTML = '<div class="muted" style="font-size:12px">The Vex agent is not available in a private window.</div>'; return; }
    const prefs = AgentSafety.prefs();
    const on = AgentSafety.enabled();
    const status = typeof AIRouter !== 'undefined' && AIRouter.getOllamaStatus ? AIRouter.getOllamaStatus() : {};
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">The agent task runner plans a task, lists every step, then works through pages in a side panel. Reading runs after one approval; typing and clicking ask every time. It never handles passwords, cards or codes, never works in private, Tor or routed tabs or on excluded sites, never downloads.</p>
      <label class="setting-toggle-row" style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" id="at-enabled" ${on ? 'checked' : ''} aria-label="Turn on the agent task runner"><span>Turn on the agent task runner</span></label>
      <div class="site-settings-row"><div class="site-settings-info"><div class="site-settings-host">Step budget</div><div class="site-settings-what">Hard limit on steps in one task (1 to ${AgentSafety.MAX_STEPS_CAP})</div></div>
        <input type="number" id="at-steps" class="set-input" min="1" max="${AgentSafety.MAX_STEPS_CAP}" value="${prefs.maxSteps}" style="width:80px" aria-label="Step budget"></div>
      <div class="site-settings-row"><div class="site-settings-info"><div class="site-settings-host">Time budget (minutes)</div><div class="site-settings-what">Waiting for your answers does not count</div></div>
        <input type="number" id="at-min" class="set-input" min="1" max="${AgentSafety.MAX_MINUTES_CAP}" value="${prefs.maxMinutes}" style="width:80px" aria-label="Time budget in minutes"></div>
      <label class="setting-toggle-row" style="display:flex;align-items:center;gap:8px;margin:10px 0"><input type="checkbox" id="at-cloud" ${prefs.useCloud ? 'checked' : ''} ${status.forceCloud ? '' : 'disabled'} aria-label="Use the cloud model for the agent"><span>Use the cloud model for the agent${status.forceCloud ? '' : ' (only offered when your AI backend is set to cloud)'}</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" id="at-open">Open the panel</button>
        <button type="button" class="btn-secondary" id="at-kill">Kill switch: stop and switch off</button>
        <button type="button" class="btn-secondary" id="at-clear">Clear the action log</button>
      </div>`;
    const q = (s) => container.querySelector(s);
    const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { window.showToast?.(err.message, 'error'); } this.renderSettings(container); };
    q('#at-enabled').addEventListener('change', guard(async (e) => {
      if (e.target.checked) {
        const ok = await window.vexConfirm({ title: 'Turn on the agent task runner?', message: 'Vex will plan tasks and then work through web pages for you, asking before it types or clicks. It never handles passwords, cards or codes, and you can stop it any time.', okLabel: 'Turn on' });
        if (ok) AgentSafety.setEnabled(true);
      } else AgentSafety.setEnabled(false);
    }));
    q('#at-steps').addEventListener('change', guard((e) => { AgentSafety.setPrefs({ maxSteps: Math.max(1, Math.min(AgentSafety.MAX_STEPS_CAP, Math.floor(Number(e.target.value)) || AgentSafety.DEFAULT_STEPS)) }); }));
    q('#at-min').addEventListener('change', guard((e) => { AgentSafety.setPrefs({ maxMinutes: Math.max(1, Math.min(AgentSafety.MAX_MINUTES_CAP, Math.floor(Number(e.target.value)) || AgentSafety.DEFAULT_MINUTES)) }); }));
    q('#at-cloud').addEventListener('change', guard((e) => { AgentSafety.setPrefs({ useCloud: e.target.checked }); }));
    q('#at-open').addEventListener('click', () => this.open());
    q('#at-kill').addEventListener('click', guard(() => { AgentSafety.kill('Kill switch pressed in Settings'); }));
    q('#at-clear').addEventListener('click', guard(async () => {
      if (await window.vexConfirm({ title: 'Clear the action log?', message: 'This removes the record of every agent task.', okLabel: 'Clear', danger: true })) AgentActionLog.clear();
    }));
  },

  _registerCommands() {
    if (typeof window === 'undefined' || !window.VexModuleCommands) return;
    VexModuleCommands.set('agenttask:', this.available() ? [{
      id: 'agenttask:open', label: 'Agent task: plan and run in a side panel', hint: 'See every step first; typing and clicking ask you', icon: 'robot',
      action: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    }] : []);
  },

  init() {
    if (typeof document === 'undefined') return;
    if (window.VexSettingsGroups) VexSettingsGroups.register({ id: 'agent-task', title: 'AI agent — task runner', render: (c) => this.renderSettings(c) });
    this._registerCommands();
  },
};

if (typeof window !== 'undefined') { window.AgentTaskPanel = AgentTaskPanel; AgentTaskPanel.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentTaskPanel };
