// === Page automations: record once, replay on demand, on a schedule or from Ctrl+K ==
//
// This is the part the person touches: the recorder bar, the step list, the
// editor, the approval prompt, the "automation running" pill with Stop, the run
// log and Settings > Page automations. Everything that decides what is safe is
// in js/automations-model.js (shared with main), and the runner, schedule,
// encryption and kill switch are in the main process (src/main/automations*.js).
//
// What this file does NOT do: keep a copy of a recording. Recordings live
// encrypted in main (automations.enc); this window asks for them when it needs
// them and holds them only while a dialog is open. The one localStorage key is
// the on/off mirror (the feature switch reads it synchronously).
//
// Loaded late (lazy-boot.js LATE_MODULES); it starts itself when it loads.
const VexAutomations = {
  ID: 'page-automations',
  ON_KEY: 'vex.automations.enabled',
  POLL_MS: 500,
  _state: null,
  _rec: null,           // the recording in progress { name, partition, steps, paused, tabId, wv, timer, ... }
  _approval: null,
  _lastAction: 0,

  // ---- on / off ----------------------------------------------------------------
  enabled() { try { return localStorage.getItem(this.ON_KEY) === '1'; } catch { return false; } },
  setEnabled(on) {
    localStorage.setItem(this.ON_KEY, on ? '1' : '0');
    this._api().setEnabled(!!on).then(() => this.refresh()).catch(err => this._fail(err));
  },

  _api() {
    const v = window.vex && window.vex.automations;
    if (!v) throw new Error('Page automations are not available in this window');
    return v;
  },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },
  _fail(err) { console.error('[Automations]', err); window.showToast?.(autoTr(this._msg(err)), 'error'); },
  // The rules and the in-page code are loaded the first time they are needed (they cost nothing at start-up). The page
  // code needs the rules at load, so one after the other.
  async _ready() {
    if (typeof AutoModel === 'undefined') { if (typeof VexLazy === 'undefined') throw new Error('The lazy loader is not available'); await VexLazy.ensure('js/automations-model.js'); }
    if (typeof AutoGuest === 'undefined') await VexLazy.ensure('js/automations-guest.js');
  },
  M() { if (typeof AutoModel === 'undefined') throw new Error('The automation rules are not loaded'); return AutoModel; },
  G() { if (typeof AutoGuest === 'undefined') throw new Error('The automation page code is not loaded'); return AutoGuest; },

  REASONS: {
    'not-found': 'The control was not found on the page',
    ambiguous: 'More than one control on the page matches, and Vex will not guess which',
    hidden: 'The control is on the page but is hidden',
    disabled: 'The control is switched off on the page',
    'sensitive-field': 'It is a password, code or card field; Vex never fills those',
    'not-approved': 'The control became more serious than it was when you approved it',
    'option-not-found': 'The list no longer has that choice',
    'not-a-list': 'The control is not a list',
    captcha: 'A CAPTCHA appeared. Vex does not try to get past those; open the page and do it yourself',
    'navigation-refused': 'That address cannot be opened by an automation',
    'load-failed': 'The page did not load',
    'wait-timeout': 'The text you waited for did not appear',
    'page-error': 'The page raised an error while the step ran',
    duration: 'The run took longer than its time limit',
    steps: 'The run reached its step limit',
    missed: 'Vex was closed or the PC was asleep at the time, and you chose to skip missed runs',
    rate: 'Too many runs in the last hour',
  },
  OUTCOMES: { ok: 'Done', asking: 'Asked you', failed: 'Failed', skipped: 'Skipped', stopped: 'Stopped', 'needs-approval': 'Needs your approval' },
  TYPE_NAMES: { open: 'Open a page', click: 'Click', type: 'Type', select: 'Choose', check: 'Tick a box', enter: 'Press Enter', read: 'Read a value', wait: 'Wait', pause: 'Pause', summarise: 'AI summary' },
  STATUS: { ok: 'Done', failed: 'Failed', stopped: 'Stopped', 'needs-approval': 'Needs your approval', 'needs-you': 'Needs you', limit: 'Stopped at a limit', skipped: 'Skipped', blocked: 'Not started' },

  // ---- state and events --------------------------------------------------------
  async refresh() {
    if (!window.vex || !window.vex.automations) return null;
    this._state = await this._api().state();
    try { localStorage.setItem(this.ON_KEY, this._state.enabled ? '1' : '0'); } catch (err) { console.error('[Automations] could not mirror the switch:', err); }
    this._drawRunning();
    this._setCommands();
    if (this._state.pending.length && !this._approval) this._showApproval(this._state.pending[0]);
    await this._deliver(this._state.undelivered);
    return this._state;
  },

  _onEvent(e) {
    if (!e || typeof e !== 'object') return;
    if (e.type === 'approval') { this._showApproval(e.request); this._state = Object.assign(this._state || {}, { pending: [e.request] }); }
    else if (e.type === 'approval-closed') this._closeApproval(e.runId);
    else if (e.type === 'started') { if (this._state) this._state.running = { ...e.run, step: -1 }; this._drawRunning(); }
    else if (e.type === 'step') { if (this._state && this._state.running) this._state.running.step = e.entry.i; this._drawRunning(); }
    else if (e.type === 'finished') {
      if (this._state) this._state.running = null;
      this._drawRunning();
      this.refresh().catch(err => this._fail(err));
      if (e.run) this._announce(e.run);
    } else if (e.type === 'state') this.refresh().catch(err => this._fail(err));
  },

  _announce(run) {
    const word = autoTr(this.STATUS[run.status] || run.status);
    window.showToast?.(run.name + ': ' + word, run.status === 'ok' ? undefined : (run.status === 'stopped' ? undefined : 'error'));
  },

  // ---- styles -------------------------------------------------------------------
  _style() {
    if (document.getElementById('vex-auto-style')) return;
    const st = document.createElement('style');
    st.id = 'vex-auto-style';
    st.textContent = `
      .vex-auto-ov { position:fixed; inset:0; z-index:100060; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; }
      .vex-auto-card { width:min(620px,94vw); max-height:88vh; overflow:auto; background:var(--surface,var(--bg)); color:var(--text); border:1px solid var(--border); border-radius:14px; padding:18px 20px; box-shadow:0 24px 60px var(--vex-shadow-color, rgba(0,0,0,0.45)); font-size:12.5px; }
      .vex-auto-card h2 { margin:0 0 4px; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px; }
      .vex-auto-card .vex-auto-sub { color:var(--text-muted); margin:0 0 10px; }
      .vex-auto-card label { display:block; margin:8px 0 3px; font-weight:600; }
      .vex-auto-card input[type=text], .vex-auto-card input[type=time], .vex-auto-card input[type=number], .vex-auto-card select, .vex-auto-card textarea { width:100%; box-sizing:border-box; padding:6px 8px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; font:inherit; }
      .vex-auto-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .vex-auto-btns { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; margin-top:14px; }
      .vex-auto-btn { padding:6px 12px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font:inherit; display:inline-flex; align-items:center; gap:6px; }
      .vex-auto-btn:hover { background:var(--vex-hover-fill, var(--surface)); }
      .vex-auto-btn.primary { background:var(--primary,var(--accent,#d4a574)); color:var(--on-primary,#111); border-color:transparent; font-weight:600; }
      .vex-auto-btn.danger { border-color:#c0392b; color:var(--text); }
      .vex-auto-btn[disabled] { opacity:.55; cursor:not-allowed; }
      .vex-auto-bar { position:fixed; top:56px; left:50%; transform:translateX(-50%); z-index:100040; width:min(760px,94vw); background:var(--surface,var(--bg)); color:var(--text); border:1px solid var(--border); border-radius:12px; padding:8px 10px; box-shadow:0 10px 30px var(--vex-shadow-color, rgba(0,0,0,0.4)); font-size:12px; }
      .vex-auto-dot { width:10px; height:10px; border-radius:50%; background:#d33; flex:none; animation:vexAutoPulse 1.4s ease-in-out infinite; }
      .vex-auto-dot.paused { background:var(--text-muted); animation:none; }
      @keyframes vexAutoPulse { 50% { opacity:.35; } }
      @media (prefers-reduced-motion: reduce) { .vex-auto-dot { animation:none; } }
      .vex-auto-steps { margin:8px 0 0; padding:0; list-style:none; max-height:260px; overflow:auto; }
      .vex-auto-step { display:grid; grid-template-columns:22px 1fr auto; gap:6px; align-items:start; padding:5px 4px; border-top:1px solid var(--border); }
      .vex-auto-step.bad { outline:2px solid #c0392b; border-radius:6px; }
      .vex-auto-step .n { color:var(--text-muted); text-align:right; padding-top:6px; }
      .vex-auto-step input[type=text], .vex-auto-step select, .vex-auto-step input[type=number] { padding:3px 6px; }
      .vex-auto-step .meta { color:var(--text-muted); font-size:11px; margin-top:2px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
      .vex-auto-chip { display:inline-flex; align-items:center; gap:4px; padding:1px 7px; border-radius:999px; border:1px solid var(--border); font-size:11px; color:var(--text); }
      .vex-auto-chip.lock { border-color:#c0392b; }
      .vex-auto-iconbtn { background:none; border:1px solid transparent; border-radius:6px; color:var(--text); padding:3px 5px; cursor:pointer; }
      .vex-auto-iconbtn:hover { background:var(--vex-hover-fill, var(--surface)); border-color:var(--border); }
      .vex-auto-iconbtn[disabled] { opacity:.35; cursor:not-allowed; }
      #vex-auto-running { position:fixed; left:12px; bottom:12px; z-index:100030; display:none; align-items:center; gap:10px; background:var(--surface,var(--bg)); color:var(--text); border:1px solid var(--border); border-radius:999px; padding:6px 8px 6px 14px; box-shadow:0 6px 20px var(--vex-shadow-color, rgba(0,0,0,0.35)); font-size:12px; }
      #vex-auto-running.on { display:flex; }
      .vex-auto-shot { max-width:100%; border:1px solid var(--border); border-radius:8px; margin:8px 0; display:block; }
      .vex-auto-log { width:100%; border-collapse:collapse; margin-top:6px; }
      .vex-auto-log td { padding:3px 6px; border-top:1px solid var(--border); vertical-align:top; }
      .vex-auto-item { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0; }
      .vex-auto-item .head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .vex-auto-item .head b { flex:1; min-width:120px; }
    `;
    const a11y = document.querySelector('link[href*="a11y.css"]');
    if (a11y && a11y.parentNode) a11y.parentNode.insertBefore(st, a11y); else document.head.appendChild(st);
  },

  // ---- small DOM helpers (text goes in as text, never as markup) -------------------
  _el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  },
  _icon(name, size) { const s = document.createElement('span'); s.style.display = 'inline-flex'; s.setAttribute('aria-hidden', 'true'); if (window.VexIcons) s.innerHTML = VexIcons.svg(name, { size: size || 14 }); return s; },
  _btn(label, icon, onClick, cls) {
    const b = this._el('button', { type: 'button', class: 'vex-auto-btn' + (cls ? ' ' + cls : '') });
    if (icon) b.append(this._icon(icon));
    b.append(document.createTextNode(autoTr(label)));
    b.addEventListener('click', onClick);
    return b;
  },
  _iconBtn(icon, label, onClick, disabled) {
    const b = this._el('button', { type: 'button', class: 'vex-auto-iconbtn', 'aria-label': autoTr(label), title: autoTr(label) });
    b.append(this._icon(icon, 13));
    if (disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  },
  _modal(labelledBy) {
    this._style();
    const ov = this._el('div', { class: 'vex-auto-ov', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy });
    const card = this._el('div', { class: 'vex-auto-card' });
    ov.append(card);
    document.body.append(ov);
    if (typeof VexLayer !== 'undefined') VexLayer.track(ov, { tier: 'dialog', id: 'page-automations' });
    return { ov, card, close: () => ov.remove() };
  },
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); } },
  _when(ms) { return ms ? new Date(ms).toLocaleString() : autoTr('Never'); },
  _scheduleText(s) {
    if (!s || s.kind === 'none') return autoTr('Not scheduled');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return autoTr(s.kind === 'daily' ? 'Every day at ' + s.time : s.kind === 'weekdays' ? 'Weekdays at ' + s.time : 'Every ' + days[s.day || 0] + ' at ' + s.time);
  },

  // ---- the "automation running" pill, with Stop ----------------------------------------
  _drawRunning() {
    this._style();
    let pill = document.getElementById('vex-auto-running');
    if (!pill) {
      pill = this._el('div', { id: 'vex-auto-running', role: 'status', 'aria-live': 'polite' });
      document.body.append(pill);
    }
    const run = this._state && this._state.running;
    pill.classList.toggle('on', !!run);
    pill.textContent = '';
    if (!run) return;
    const waiting = this._state.pending && this._state.pending.length;
    pill.append(this._el('span', { class: 'vex-auto-dot' }),
      this._el('span', { text: waiting ? autoTr('Automation waiting for you: ' + run.name) : autoTr(run.step >= 0 ? 'Automation running: ' + run.name + ' (step ' + (run.step + 1) + '/' + run.total + ')' : 'Automation running: ' + run.name) }));
    if (waiting) pill.append(this._btn('Open', null, () => { if (this._state.pending[0]) this._showApproval(this._state.pending[0]); }));
    pill.append(this._btn('Stop', 'stop', () => this._api().stop().catch(err => this._fail(err)), 'danger'));
  },

  // ---- the approval prompt ----------------------------------------------------------------
  _showApproval(req) {
    if (!req) return;
    this._closeApproval();
    const m = this._modal('vex-auto-ap-title');
    this._approval = { runId: req.runId, close: m.close };
    const title = req.kind === 'fill' ? 'Your turn: fill this in yourself' : req.kind === 'pause' ? 'Continue the automation?' : 'Approve this step?';
    m.ov.setAttribute('role', 'alertdialog');
    m.card.append(this._el('h2', { id: 'vex-auto-ap-title' }, this._icon(req.kind === 'consequence' ? 'warning' : 'robot', 18), autoTr(title)));
    m.card.append(this._el('p', { class: 'vex-auto-sub', text: autoTr('"' + req.name + '" step ' + (req.index + 1) + ' / ' + req.total) }));
    m.card.append(this._el('div', { style: 'font-weight:600;margin:6px 0', text: req.label }));
    if (req.why) m.card.append(this._el('div', { text: autoTr(req.why) }));
    if (req.kind === 'consequence' && req.locked) m.card.append(this._el('div', { class: 'vex-auto-chip lock', style: 'margin-top:8px' }, this._icon('lock', 12), autoTr('This kind of step always asks. It cannot be set to run by itself.')));
    if (req.kind === 'fill') m.card.append(this._el('div', { style: 'margin-top:8px', text: autoTr('Vex never types a password, code or card number. The page is open in a window; fill the field there, then continue.') }));
    if (req.url) m.card.append(this._el('div', { class: 'vex-auto-sub', style: 'margin-top:6px', text: this._host(req.url) }));
    if (req.screenshot) m.card.append(this._el('img', { class: 'vex-auto-shot', src: req.screenshot, alt: autoTr('The page right now') }));
    const answer = (d) => this._api().decide(req.runId, d).catch(err => this._fail(err));
    const stop = this._btn('Stop the run', 'stop', () => answer('stop'), 'danger');
    m.card.append(this._el('div', { class: 'vex-auto-btns' },
      this._btn('Decide later', null, () => this._closeApproval()),
      this._btn('Skip this step', null, () => answer('skip')),
      stop,
      this._btn(req.kind === 'fill' ? 'I filled it in, continue' : req.kind === 'pause' ? 'Continue' : 'Approve and run this step', 'check', () => answer('approve'), 'primary')));
    m.ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this._closeApproval(); } });
    stop.focus();
  },
  _closeApproval(runId) {
    if (this._approval && (!runId || this._approval.runId === runId)) { this._approval.close(); this._approval = null; }
    if (runId && this._state) this._state.pending = (this._state.pending || []).filter(p => p.runId !== runId);
    this._drawRunning();
  },

  // ---- the step list: one component for the recorder bar and the editor ----------------------
  // ctx = { steps, onChange(), bad: index|-1, live: bool }
  _stepList(ctx) {
    const M = this.M();
    const ul = this._el('ul', { class: 'vex-auto-steps', 'aria-label': autoTr('Steps') });
    const redraw = () => { ctx.onChange && ctx.onChange(); fill(); };
    const fill = () => {
      ul.textContent = '';
      ctx.steps.forEach((s, i) => {
        const li = this._el('li', { class: 'vex-auto-step' + (ctx.bad === i ? ' bad' : '') });
        li.append(this._el('span', { class: 'n', text: String(i + 1) }));
        const mid = this._el('div');
        const label = this._el('input', { type: 'text', value: s.label || M.describeStep(s), 'aria-label': autoTr('Step name') });
        label.addEventListener('change', () => { s.label = label.value.slice(0, 120); redraw(); });
        mid.append(label);
        const meta = this._el('div', { class: 'meta' });
        meta.append(this._el('span', { text: autoTr(this.TYPE_NAMES[s.type] || s.type) }));
        // the fields a step has
        if (s.type === 'open') {
          const u = this._el('input', { type: 'text', value: s.url, 'aria-label': autoTr('Address') });
          u.addEventListener('change', () => { try { s.url = M.cleanUrl(u.value).url; redraw(); } catch (err) { this._fail(err); u.value = s.url; } });
          mid.append(u);
        } else if ((s.type === 'type' || s.type === 'select') && !s.ask) {
          const v = this._el('input', { type: 'text', value: s.value || '', 'aria-label': autoTr('Text to type') });
          v.addEventListener('change', () => { s.value = v.value.slice(0, 500); redraw(); });
          mid.append(v);
        } else if (s.type === 'wait') {
          const w = this._el('input', { type: 'number', min: '0', max: '30', step: '0.5', value: String((s.ms || 0) / 1000), 'aria-label': autoTr('Seconds to wait') });
          w.addEventListener('change', () => { s.ms = Math.max(0, Math.min(30000, Math.round(Number(w.value) * 1000))); redraw(); });
          mid.append(w);
        } else if (s.type === 'read') {
          const r = this._el('input', { type: 'text', value: s.as || '', 'aria-label': autoTr('Name of the value') });
          r.addEventListener('change', () => { s.as = r.value.slice(0, 40); redraw(); });
          mid.append(r);
        }
        if (s.ask) meta.append(this._el('span', { class: 'vex-auto-chip' }, this._icon('lock', 11), autoTr('Asks you at run time; nothing is stored')));
        if (s.locked) meta.append(this._el('span', { class: 'vex-auto-chip lock', title: autoTr(s.consequence.why) }, this._icon('lock', 11), autoTr('Always asks') + ': ' + autoTr(s.consequence.why)));
        else if (s.consequence && s.consequence.level === 'soft') meta.append(this._el('span', { class: 'vex-auto-chip' }, autoTr(s.consequence.why)));
        if (s.urlTrimmed) meta.append(this._el('span', { class: 'vex-auto-chip' }, autoTr('Secret-looking parts of the address were left out')));
        if (['click', 'type', 'select', 'check', 'enter'].includes(s.type) && !s.locked && !s.ask) {
          const sel = this._el('select', { 'aria-label': autoTr('Ask first or run') });
          sel.append(this._el('option', { value: 'run', text: autoTr('Run') }), this._el('option', { value: 'ask', text: autoTr('Ask first') }));
          sel.value = s.confirm === 'ask' ? 'ask' : 'run';
          sel.style.width = 'auto';
          sel.addEventListener('change', () => { s.confirm = sel.value; redraw(); });
          meta.append(sel);
        }
        mid.append(meta);
        li.append(mid);
        const ctl = this._el('div', { style: 'display:flex;gap:2px' });
        ctl.append(this._iconBtn('chevron-up', 'Move up', () => { if (i > 0) { [ctx.steps[i - 1], ctx.steps[i]] = [ctx.steps[i], ctx.steps[i - 1]]; redraw(); } }, i === 0),
          this._iconBtn('chevron-down', 'Move down', () => { if (i < ctx.steps.length - 1) { [ctx.steps[i + 1], ctx.steps[i]] = [ctx.steps[i], ctx.steps[i + 1]]; redraw(); } }, i === ctx.steps.length - 1),
          this._iconBtn('trash', 'Delete this step', () => { ctx.steps.splice(i, 1); redraw(); }));
        if (ctx.fix && s.target && ['click', 'type', 'select', 'check', 'enter', 'read'].includes(s.type)) ctl.append(this._iconBtn('target', 'Pick this control again on the page', () => ctx.fix(i)));
        li.append(ctl);
        ul.append(li);
      });
      if (!ctx.steps.length) ul.append(this._el('li', { class: 'vex-auto-sub', text: autoTr('No steps yet. Use the page: every click, choice and typed word becomes a step.') }));
    };
    fill();
    ul.refill = fill;
    return ul;
  },

  // ---- recording -----------------------------------------------------------------------------------
  async startRecording() {
    await this._ready();
    const M = this.M(), G = this.G();
    await this._requireOn();
    if (this._rec) throw new Error('A recording is already in progress');
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = tab && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    if (!tab || !wv) throw new Error('Open the site you want to automate in a tab first');
    const url = wv.getURL ? wv.getURL() : tab.url;
    if (!/^https?:/i.test(String(url))) throw new Error('Open a web page first; only http and https pages can be recorded');
    const partition = wv.getAttribute('partition') || 'persist:main';
    if (!M.PARTITION_RE.test(partition)) throw new Error('Recording works in your main session or your own containers, not in private, Tor or routed tabs');
    const policy = window.VexTabPolicy;
    if (!policy || typeof policy.canReadWebview !== 'function' || !policy.canReadWebview(wv)) throw new Error('Recording is not available in private, Tor or routed tabs');
    const first = M.cleanUrl(url);
    const name = await window.vexPrompt({ title: autoTr('Record an automation'), message: autoTr('Name this automation. Then do the job once on the page: click, choose, type. Vex never records passwords, codes or card numbers.'), value: this._host(url), okLabel: autoTr('Start recording') });
    if (!name) return null;
    this._style();
    const rec = this._rec = { name: String(name).slice(0, 80), partition, tabId: tab.id, wv, steps: [{ ...M.cleanStep({ type: 'open', url: first.url, urlTrimmed: first.trimmed }, 0) }], paused: false, timer: null, dropped: 0, picking: false };
    await wv.executeJavaScript(G.call('recStart', []));
    const onNav = (e) => {
      if (!this._rec || e.isMainFrame === false) return;
      // A page the recorded click or Enter led to is part of that step; an address the person typed is a step of its own.
      if (Date.now() - this._lastAction > 4000 && !rec.paused) {
        try { M.stepsFromEvents([{ t: 'open', url: e.url }], rec.steps).forEach((s, i) => { rec.steps[i] = s; }); this._drawBar(); }
        catch (err) { this._fail(err); }
      }
    };
    const onReady = () => { if (this._rec) wv.executeJavaScript(G.call('recStart', [])).catch(err => this._fail(err)); };
    rec.onNav = onNav; rec.onReady = onReady;
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('dom-ready', onReady);
    if (typeof VexJobs === 'undefined') throw new Error('The job scheduler is not loaded');
    rec.job = VexJobs.every('Automation recorder', this.POLL_MS, () => this._recTick().catch(err => this._fail(err)), { feature: 'page-automations' });
    this._drawBar();
    return rec;
  },

  async _recTick() {
    const rec = this._rec; if (!rec || rec.busy) return;
    rec.busy = true;
    try {
      let events;
      try { events = await rec.wv.executeJavaScript(this.G().call('recDrain', [])); rec.fails = 0; }
      catch (err) {
        // A page that is navigating refuses a script for a moment; six refusals in a row (three seconds) are a real problem and are shown.
        rec.fails = (rec.fails || 0) + 1;
        if (rec.fails < 6) return;
        rec.fails = 0;
        throw err;
      }
      if (!Array.isArray(events) || !events.length) return;
      if (events.some(e => e.t === 'click' || e.t === 'enter')) this._lastAction = Date.now();
      if (rec.paused) return;   // taken from the page and thrown away: a paused recording writes nothing
      const before = rec.steps.length;
      const M = this.M();
      rec.steps = M.stepsFromEvents(events, rec.steps);
      rec.dropped += Math.max(0, events.length - Math.max(0, rec.steps.length - before));
      if (rec.steps.length >= M.LIMITS.maxSteps) { window.showToast?.(autoTr('That is the most steps one automation can have. Recording stopped.')); await this.stopRecording(); return; }
      rec.picking = false;
      this._drawBar();
    } finally { rec.busy = false; }
  },

  _drawBar() {
    const rec = this._rec;
    let bar = document.getElementById('vex-auto-rec');
    if (!rec) { if (bar) bar.remove(); return; }
    this._style();
    if (!bar) { bar = this._el('div', { id: 'vex-auto-rec', class: 'vex-auto-bar', role: 'region', 'aria-label': autoTr('Automation recorder') }); document.body.append(bar); }
    const keepScroll = bar.querySelector('.vex-auto-steps');
    const scroll = keepScroll ? keepScroll.scrollTop : 0;
    bar.textContent = '';
    const head = this._el('div', { class: 'vex-auto-row' });
    head.append(this._el('span', { class: 'vex-auto-dot' + (rec.paused ? ' paused' : '') }),
      this._el('b', { style: 'flex:1;min-width:140px', text: autoTr((rec.paused ? 'Paused: ' : 'Recording: ') + rec.name + ' (' + rec.steps.length + ' steps)') }),
      this._btn(rec.paused ? 'Resume' : 'Pause', rec.paused ? 'play' : 'pause', () => { rec.paused = !rec.paused; this._drawBar(); }),
      this._btn(rec.picking ? 'Click the value on the page' : 'Read a value', 'eye', () => { rec.picking = true; rec.wv.executeJavaScript(this.G().call('recPick', [true])).catch(err => this._fail(err)); this._drawBar(); }),
      this._btn('Add wait', 'clock', () => { rec.steps.push(this.M().cleanStep({ type: 'wait', ms: 2000 }, rec.steps.length)); this._drawBar(); }),
      this._btn('Add pause', 'pause', () => { rec.steps.push(this.M().cleanStep({ type: 'pause' }, rec.steps.length)); this._drawBar(); }),
      this._btn('Stop and review', 'stop', () => this.stopRecording().catch(err => this._fail(err)), 'primary'),
      this._btn('Cancel', 'x', () => this.cancelRecording().catch(err => this._fail(err))));
    bar.append(head);
    if (rec.dropped) bar.append(this._el('div', { class: 'vex-auto-sub', style: 'margin:4px 0 0', text: autoTr(rec.dropped + ' actions could not be turned into safe steps and were left out.') }));
    bar.append(this._stepList({ steps: rec.steps, onChange: () => this._drawBar() }));
    const ul = bar.querySelector('.vex-auto-steps'); if (ul) ul.scrollTop = scroll || ul.scrollHeight;
  },

  async _endRecording() {
    const rec = this._rec; if (!rec) return null;
    rec.job.stop();
    rec.wv.removeEventListener('did-navigate', rec.onNav);
    rec.wv.removeEventListener('dom-ready', rec.onReady);
    let tail = [];
    try { tail = await rec.wv.executeJavaScript(this.G().call('recStop', [])); } catch (err) { console.error('[Automations] could not stop the page recorder:', err); }
    if (!rec.paused && Array.isArray(tail) && tail.length) rec.steps = this.M().stepsFromEvents(tail, rec.steps);
    this._rec = null;
    this._drawBar();
    return rec;
  },
  async cancelRecording() { await this._endRecording(); window.showToast?.(autoTr('Recording discarded')); },
  async stopRecording() {
    const rec = await this._endRecording(); if (!rec) return null;
    if (rec.steps.length < 2) { window.showToast?.(autoTr('Nothing was recorded.')); return null; }
    return this.openEditor({ name: rec.name, partition: rec.partition, steps: rec.steps, enabled: true, mode: 'hidden', toInbox: true, schedule: { kind: 'none', time: '09:00', missed: 'run' } }, { isNew: true });
  },

  // Pick one control again on its page, to repair a step that no longer finds it.
  async pickAgain(rec, step, url) {
    const G = this.G();
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not ready yet');
    const tab = TabManager.createTab(url || rec.startUrl, true, null, { partition: rec.partition });
    let wv = null;
    for (let i = 0; i < 80 && !wv; i++) { await new Promise(r => setTimeout(r, 250)); wv = WebviewManager.webviews.get(tab.id); }
    if (!wv) throw new Error('The page did not open');
    await new Promise(r => setTimeout(r, 1500));
    await wv.executeJavaScript(G.call('recStart', []));
    await wv.executeJavaScript(G.call('recPick', [true]));
    window.showToast?.(autoTr('Click the control for this step on the page.'));
    for (let i = 0; i < 240; i++) {
      await new Promise(r => setTimeout(r, 500));
      const ev = (await wv.executeJavaScript(G.call('recDrain', []))).find(e => e.t === 'read');
      if (ev) { await wv.executeJavaScript(G.call('recStop', [])); return this.M().cleanTarget(ev.target); }
    }
    await wv.executeJavaScript(G.call('recStop', []));
    throw new Error('Nothing was picked within two minutes');
  },

  // ---- the editor ------------------------------------------------------------------------------------
  async openEditor(rec, { isNew = false, bad = -1 } = {}) {
    await this._ready();
    const M = this.M();
    const work = JSON.parse(JSON.stringify(rec));
    const m = this._modal('vex-auto-ed-title');
    const c = m.card;
    c.append(this._el('h2', { id: 'vex-auto-ed-title' }, this._icon('robot', 18), autoTr(isNew ? 'Review your automation' : 'Edit automation')));
    c.append(this._el('p', { class: 'vex-auto-sub', text: autoTr('Saved only on this computer, encrypted. It is never synced or sent anywhere; only Export can take it out, and Export leaves out everything you typed.') }));
    const name = this._el('input', { type: 'text', id: 'vex-auto-name', value: work.name, maxlength: '80' });
    c.append(this._el('label', { for: 'vex-auto-name', text: autoTr('Name') }), name);
    const mode = this._el('select', { id: 'vex-auto-mode' }, this._el('option', { value: 'hidden', text: autoTr('Hidden window (nothing appears)') }), this._el('option', { value: 'visible', text: autoTr('Visible window (you watch it work)') }));
    mode.value = work.mode || 'hidden';
    c.append(this._el('label', { for: 'vex-auto-mode', text: autoTr('How it runs') }), mode);
    c.append(this._el('div', { class: 'vex-auto-sub', style: 'margin-top:4px', text: autoTr(work.partition === 'persist:main' ? 'Session: your main session.' : 'Session: your container ' + work.partition.replace('persist:container-', '') + '.') + ' ' + autoTr('It uses the logins that session already has.') }));
    // schedule
    const sk = this._el('select', { id: 'vex-auto-sk' }, ...[['none', 'Only when I run it'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']].map(([v, t]) => this._el('option', { value: v, text: autoTr(t) })));
    sk.value = work.schedule.kind;
    const st = this._el('input', { type: 'time', value: work.schedule.time, 'aria-label': autoTr('Time of day') });
    const sd = this._el('select', { 'aria-label': autoTr('Day of the week') }, ...['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => this._el('option', { value: String(i), text: autoTr(d) })));
    sd.value = String(work.schedule.day == null ? 1 : work.schedule.day);
    const sm = this._el('select', { id: 'vex-auto-sm' }, this._el('option', { value: 'run', text: autoTr('Run it once when Vex wakes up') }), this._el('option', { value: 'skip', text: autoTr('Skip it') }));
    sm.value = work.schedule.missed || 'run';
    const sync = () => { st.style.display = sd.style.display = sk.value === 'none' ? 'none' : ''; sd.style.display = sk.value === 'weekly' ? '' : 'none'; sm.parentElement.style.display = sk.value === 'none' ? 'none' : ''; };
    c.append(this._el('label', { for: 'vex-auto-sk', text: autoTr('When it runs') }), this._el('div', { class: 'vex-auto-row' }, sk, st, sd));
    c.append(this._el('div', {}, this._el('label', { for: 'vex-auto-sm', text: autoTr('If the PC was off or asleep at that time') }), sm));
    sk.addEventListener('change', sync);
    // results
    const inbox = this._el('input', { type: 'checkbox', id: 'vex-auto-inbox' }); inbox.checked = work.toInbox !== false;
    const note = this._el('input', { type: 'checkbox', id: 'vex-auto-note' }); note.checked = !!work.toNote;
    c.append(this._el('div', { style: 'margin-top:8px' }, this._el('label', { for: 'vex-auto-inbox', style: 'display:flex;gap:6px;font-weight:400' }, inbox, autoTr('Put each result in the Inbox (done, failed or waiting for you)')),
      this._el('label', { for: 'vex-auto-note', style: 'display:flex;gap:6px;font-weight:400' }, note, autoTr('Also save the values it reads as a note'))));
    const lim = this._el('select', { id: 'vex-auto-lim' }, ...[[60000, '1 minute'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes'], [900000, '15 minutes']].map(([v, t]) => this._el('option', { value: String(v), text: autoTr(t) })));
    lim.value = String(work.maxRunMs || 300000);
    if (!lim.value) lim.value = '300000';
    c.append(this._el('label', { for: 'vex-auto-lim', text: autoTr('Longest a run may take (time spent waiting for you does not count)') }), lim);
    // steps
    c.append(this._el('label', { text: autoTr('Steps') }));
    const list = this._stepList({
      steps: work.steps, bad, onChange: () => {},
      fix: async (i) => {
        try {
          const target = await this.pickAgain(work, work.steps[i], bad === i && rec._failUrl ? rec._failUrl : null);
          work.steps[i].target = target; list.refill();
          window.showToast?.(autoTr('Step updated. Save to keep it.'));
        } catch (err) { this._fail(err); }
      },
    });
    c.append(list);
    c.append(this._el('div', { class: 'vex-auto-row', style: 'margin-top:6px' },
      this._btn('Add wait', 'clock', () => { work.steps.push(M.cleanStep({ type: 'wait', ms: 2000 }, work.steps.length)); list.refill(); }),
      this._btn('Add pause', 'pause', () => { work.steps.push(M.cleanStep({ type: 'pause' }, work.steps.length)); list.refill(); }),
      this._btn('Add AI summary', 'robot', async () => {
        if (work.steps.some(s => s.type === 'summarise')) return;
        const ok = await window.vexConfirm({ title: autoTr('Add an AI summary?'), message: autoTr('After each run, the values this automation read are sent to your AI service to be summarised. Nothing is sent unless this step is here. It is always the last step.'), okLabel: autoTr('Add the step') });
        if (ok) { work.steps.push(M.cleanStep({ type: 'summarise', prompt: 'Summarise these values in two sentences.' }, work.steps.length)); list.refill(); }
      })));
    const save = async () => {
      work.name = name.value.trim(); work.mode = mode.value;
      work.schedule = { kind: sk.value, time: st.value || '09:00', day: Number(sd.value), missed: sm.value };
      work.toInbox = inbox.checked; work.toNote = note.checked; work.maxRunMs = Number(lim.value);
      try { const saved = await this._api().save(work); m.close(); await this.refresh(); window.showToast?.(autoTr('Saved: ' + saved.name)); this._rerenderSettings(); }
      catch (err) { this._fail(err); }
    };
    c.append(this._el('div', { class: 'vex-auto-btns' },
      this._btn('Cancel', null, () => m.close()),
      ...(isNew ? [] : [this._btn('Run now', 'play', async () => { await save(); this.run(work.id).catch(err => this._fail(err)); })]),
      this._btn('Save', 'check', save, 'primary')));
    sync();
    m.ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.close(); });
    name.focus();
    return m;
  },

  // ---- running --------------------------------------------------------------------------------------------
  async _requireOn() {
    if (!this.enabled()) {
      const ok = await window.vexConfirm({ title: autoTr('Switch on Page automations?'), message: autoTr('Page automations record what you do on a site and repeat it later, in a window of their own, using the logins that session already has. They never fill passwords, codes or card numbers, and they always ask before anything that looks like submitting, buying, paying, sending, posting, deleting or transferring. You can stop everything at any time.'), okLabel: autoTr('Switch on') });
      if (!ok) throw new Error('Page automations are switched off');
      localStorage.setItem(this.ON_KEY, '1');
      await this._api().setEnabled(true);
      await this.refresh();
    }
  },
  async run(id) {
    await this._requireOn();
    const r = await this._api().run(id);
    window.showToast?.(autoTr('Automation started'));
    return r;
  },

  async showRun(runId) {
    const run = await this._api().runGet(runId);
    const m = this._modal('vex-auto-run-title');
    const c = m.card;
    c.append(this._el('h2', { id: 'vex-auto-run-title' }, this._icon(run.status === 'ok' ? 'check' : 'warning', 18), run.name + ': ' + autoTr(this.STATUS[run.status] || run.status)));
    c.append(this._el('p', { class: 'vex-auto-sub', text: this._when(run.startedAt) + ' · ' + autoTr(run.trigger === 'manual' ? 'Run by you' : run.trigger === 'missed' ? 'Run on wake (it was missed)' : 'Scheduled') }));
    if (run.failure) {
      const f = run.failure;
      c.append(this._el('div', { class: 'vex-auto-item', style: 'border-color:#c0392b' },
        this._el('b', { text: (f.index >= 0 ? autoTr('Stopped at step ' + (f.index + 1)) + (f.label ? ': ' + f.label : '') : autoTr('Not run')) }),
        this._el('div', { text: autoTr(this.REASONS[f.reason] || f.message || f.reason) })));
      if (run.shot) c.append(this._el('img', { class: 'vex-auto-shot', src: run.shot, alt: autoTr('The page when the run stopped') }));
    }
    if (run.status === 'needs-approval') c.append(this._el('div', { class: 'vex-auto-item', text: autoTr('A step was waiting for your approval and nobody answered, so it was not done.') }));
    if (run.reads && run.reads.length) {
      c.append(this._el('label', { text: autoTr('Values read') }));
      for (const r of run.reads) c.append(this._el('div', { class: 'vex-auto-item' }, this._el('b', { text: r.as + ': ' }), r.text));
    }
    if (run.summary) c.append(this._el('div', { class: 'vex-auto-item' }, this._el('b', { text: autoTr('AI summary') + ': ' }), run.summary));
    c.append(this._el('label', { text: autoTr('Run log') }));
    const tb = this._el('table', { class: 'vex-auto-log' });
    for (const e of run.log || []) tb.append(this._el('tr', {}, this._el('td', { text: String(e.i + 1) }), this._el('td', { text: e.label }), this._el('td', { text: autoTr(this.OUTCOMES[e.outcome] || e.outcome) + (e.detail ? ': ' + autoTr(e.detail) : '') })));
    c.append(tb);
    const btns = this._el('div', { class: 'vex-auto-btns' });
    if (run.failure && run.failure.index >= 0) btns.append(this._btn('Fix this step', 'edit', async () => {
      m.close();
      const st = await this._api().state();
      const rec = st.recs.find(x => x.id === run.recId);
      if (!rec) { this._fail(new Error('That automation no longer exists')); return; }
      rec._failUrl = run.failure.url || null;
      this.openEditor(rec, { bad: run.failure.index });
    }, 'primary'));
    btns.append(this._btn('Close', null, () => m.close()));
    c.append(btns);
    m.ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.close(); });
    return m;
  },

  // ---- results into the Inbox, a note and (only if the person added the step) an AI summary ----------------------
  _delivering: false,
  async _deliver(runs) {
    if (this._delivering || !runs || !runs.length) return;
    this._delivering = true;
    try {
      const st = this._state || await this._api().state();
      const done = [];
      for (const r of runs.slice().reverse()) {
        const rec = st.recs.find(x => x.id === r.recId);
        let summary = '';
        if (r.summariseRequested && r.reads.length && r.status === 'ok') {
          try { summary = await this._summarise(rec, r); } catch (err) { summary = autoTr('The AI summary failed') + ': ' + this._msg(err); }
        }
        const word = autoTr(this.STATUS[r.status] || r.status);
        // The Inbox list is kept in plain localStorage, so it never carries a value that was read: it says what happened and
        // "Open" shows the values from the encrypted store.
        const detail = r.failure ? autoTr(this.REASONS[r.failure.reason] || r.failure.message || r.failure.reason) : (r.reads.length ? autoTr(r.reads.length + ' values read. Open to see them.') : '');
        if ((!rec || rec.toInbox !== false) && typeof AttentionInbox !== 'undefined' && AttentionInbox.add) {
          AttentionInbox.add({ feature: this.ID, label: autoTr('Page automations'), id: r.id, title: r.name + ': ' + word, body: detail,
            action: { label: autoTr('Open'), key: 'open-run:' + r.id } });
        }
        if (rec && rec.toNote && r.reads.length && typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
          const now = new Date().toISOString();
          NotesPanel.notes.unshift({ id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: r.name + ' ' + new Date(r.startedAt).toLocaleDateString(), content: r.reads.map(x => '**' + x.as + '**: ' + x.text).join('\n\n') + (summary ? '\n\n' + summary : ''), pinned: false, tags: ['automation'], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now });
          NotesPanel.save();
          try { NotesPanel.renderList?.(); } catch (err) { console.error('[Automations] the notes list could not be redrawn:', err); }
        }
        done.push(r.id);
      }
      await this._api().ack(done);
    } finally { this._delivering = false; }
  },
  async _summarise(rec, run) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callAI !== 'function') throw new Error('The AI service is not available');
    const step = rec && rec.steps.find(s => s.type === 'summarise');
    const text = run.reads.map(x => x.as + ': ' + x.text).join('\n');
    const out = await AIRouter.callAI('chat', { message: ((step && step.prompt) || 'Summarise these values in two sentences.') + '\n\n' + text, conversationHistory: [] });
    let t = out && (out.result != null ? out.result : out);
    if (typeof t === 'string' && /^\s*\{/.test(t)) { try { const j = JSON.parse(t); t = j.reply || j.summary || t; } catch (err) { /* vex-allow-empty-catch: not JSON, so it is plain text after all */ } }
    return String(t || '').trim().slice(0, 600);
  },

  // ---- Settings -----------------------------------------------------------------------------------------------------
  _settingsBody: null,
  _rerenderSettings() { if (this._settingsBody && this._settingsBody.isConnected) this.render(this._settingsBody); },
  render(body) {
    this._settingsBody = body;
    const PS = window.ProtectSettings;
    if (!PS) throw new Error('Settings helpers are not loaded');
    this._style();
    body.textContent = '';
    const api = this._api();
    body.append(this._el('div', { style: 'font-size:12px;color:var(--text-muted);margin:2px 0 8px', text: autoTr('Record a job on a site once, then run it again from here, from Ctrl+K or on a schedule. It runs in a window of its own, in the session you recorded it in, and uses the logins that session already has.') }));
    const status = this._el('div', { role: 'status', style: 'font-size:12px;margin:6px 0' });
    body.append(PS.toggle({ text: autoTr('Allow page automations'), hint: autoTr('Off by default'), checked: this.enabled(), onChange: (v) => this.setEnabled(v) }));
    const list = this._el('div');
    const draw = (st) => {
      list.textContent = '';
      status.textContent = st.killed ? autoTr('The kill switch is on: nothing runs and no schedule fires until you re-arm it.') : (st.enabled ? '' : autoTr('Switched off: nothing is recorded or run.'));
      for (const rec of st.recs) {
        const item = this._el('div', { class: 'vex-auto-item' });
        const head = this._el('div', { class: 'head' }, this._el('b', { text: rec.name }));
        const sw = this._el('input', { type: 'checkbox', 'aria-label': autoTr('Switched on') }); sw.checked = rec.enabled;
        sw.addEventListener('change', async () => { try { await api.save({ ...rec, enabled: sw.checked }); await this.refresh(); this._rerenderSettings(); } catch (err) { this._fail(err); sw.checked = !sw.checked; } });
        head.append(sw);
        item.append(head);
        item.append(this._el('div', { class: 'vex-auto-sub', style: 'margin:3px 0', text: this._host(rec.startUrl) + ' · ' + autoTr(rec.steps.length + ' steps') + ' · ' + this._scheduleText(rec.schedule) + (rec.nextAt ? ' · ' + autoTr('Next run: ' + this._when(rec.nextAt)) : '') + ' · ' + autoTr('Last result: ' + (rec.lastStatus ? autoTr(this.STATUS[rec.lastStatus] || rec.lastStatus) : autoTr('Never run'))) }));
        if (rec.os && rec.os.error && rec.schedule.kind !== 'none') item.append(this._el('div', { class: 'vex-auto-sub', text: autoTr(rec.os.error) }));
        const row = this._el('div', { class: 'vex-auto-row' });
        row.append(this._btn('Run now', 'play', () => this.run(rec.id).catch(err => this._fail(err))),
          this._btn('Edit', 'edit', () => this.openEditor(rec)),
          this._btn('Run log', 'list', async () => { const runs = await api.runs(rec.id); if (runs[0]) this.showRun(runs[0].id).catch(err => this._fail(err)); else window.showToast?.(autoTr('It has not run yet')); }),
          this._btn('Export', 'download', async () => { try { const text = await api.exportOne(rec.id); await this._saveText(rec.name + '.vex-automation.json', text); } catch (err) { this._fail(err); } }),
          this._btn('Delete', 'trash', async () => { if (await window.vexConfirm({ title: autoTr('Delete this automation?'), message: rec.name, okLabel: autoTr('Delete'), danger: true })) { try { await api.remove(rec.id); await this.refresh(); this._rerenderSettings(); } catch (err) { this._fail(err); } } }, 'danger'));
        item.append(row);
        list.append(item);
      }
      if (!st.recs.length) list.append(this._el('div', { class: 'vex-auto-sub', text: autoTr('No automations yet. Open a site in a tab, then press Record.') }));
    };
    const top = this._el('div', { class: 'vex-auto-row' },
      this._btn('Record on the current tab', 'play', () => this.startRecording().catch(err => this._fail(err)), 'primary'),
      this._btn('Import', 'upload', () => this._importFile()),
      this._btn('Stop all automations (kill switch)', 'stop', async () => { try { await api.kill(); await this.refresh(); this._rerenderSettings(); window.showToast?.(autoTr('Everything is stopped and held.')); } catch (err) { this._fail(err); } }, 'danger'),
      this._btn('Re-arm', 'refresh', async () => { try { await api.rearm(); await this.refresh(); this._rerenderSettings(); } catch (err) { this._fail(err); } }));
    body.append(top, status, list);
    body.append(this._el('div', { style: 'font-weight:600;font-size:12.5px;margin:14px 0 4px', text: autoTr('The rules, and the limits') }));
    const rules = ['Passwords, one-time codes, card numbers and anything a password manager filled are never recorded or typed. That step asks you at run time.',
      'Any step that looks like submitting, buying, paying, sending, posting, deleting, transferring or confirming always pauses for your approval, in English or Turkish. For payment, delete, transfer and send steps that cannot be switched off.',
      'If a control cannot be found, or two match, the run stops and tells you which step and why, with a picture of the page. It never clicks something else.',
      'If a CAPTCHA appears the run stops and asks you. Vex does not try to get past one.',
      'At most 60 steps and 12 pages in a recording, 15 minutes a run, 6 runs an hour for each automation and 20 overall. No loops. One automation runs at a time.',
      'Not in private, Tor or routed tabs. Never downloads or installs a file. Recordings are encrypted on this computer and never synced; Export leaves out everything you typed.',
      'A click that submits a form by script, a file chooser, pop-ups and frames from other sites are not handled.'];
    const ul = this._el('ul', { style: 'margin:0;padding-left:18px;font-size:12px;color:var(--text-muted)' });
    for (const r of rules) ul.append(this._el('li', { text: autoTr(r) }));
    body.append(ul);
    this.refresh().then(draw).catch(err => { status.textContent = this._msg(err); });
    return body;
  },

  async _saveText(name, text) {
    if (window.vex && typeof window.vex.saveTextFile === 'function') { await window.vex.saveTextFile(name, text, 'json'); return; }
    throw new Error('Saving a file is not available here');
  },
  _importFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      try {
        const file = input.files && input.files[0]; if (!file) return;
        const saved = await this._api().importText(await file.text());
        await this.refresh(); this._rerenderSettings();
        window.showToast?.(autoTr('Imported, switched off. Review it before you run it: ' + saved.name));
        this.openEditor(saved);
      } catch (err) { this._fail(err); }
    });
    input.click();
  },

  // ---- Ctrl+K ------------------------------------------------------------------------------------------------------------------
  _commands() {
    const run = (fn) => () => { Promise.resolve().then(fn).catch(err => this._fail(err)); };
    const list = [
      { id: 'automations:record', label: 'Record an automation on this page', hint: 'Do a job once and replay it later; passwords are never recorded', icon: 'play', action: run(() => this.startRecording()) },
      { id: 'automations:open', label: 'Page automations', hint: 'Your recordings, schedules, run log and the kill switch', icon: 'robot', action: run(() => SettingsUI.openSection('setting-page-automations')) },
      { id: 'automations:stop', label: 'Stop the running automation', hint: 'Ends the run at once', icon: 'stop', action: run(() => this._api().stop()) },
      { id: 'automations:kill', label: 'Stop all automations', hint: 'The kill switch: nothing runs until you re-arm it', icon: 'stop', action: run(async () => { await this._api().kill(); await this.refresh(); }) },
    ];
    for (const rec of (this._state && this._state.recs) || []) list.push({ id: 'automations:run:' + rec.id, label: `Run automation: ${rec.name}`, hint: this._host(rec.startUrl) + ' · ' + rec.steps.length + ' steps', icon: 'play', action: run(() => this.run(rec.id)) });
    return list;
  },
  // Switched off: only the two ways in are listed (Record asks to switch the feature on; Page automations opens its section).
  _setCommands() {
    if (!window.VexModuleCommands) return;
    const all = this._commands();
    VexModuleCommands.set('automations:', this.enabled() ? all : all.slice(0, 2));
  },

  init() {
    if (this._started) return false;
    this._started = true;
    if (!window.VexSettingsGroups) throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({
      id: 'page-automations', title: 'Page automations', before: 'about',
      keywords: 'automation automations macro record replay repeat schedule script click fill form site job routine rpa grades report download copy price kill switch',
      render: (body) => this.render(body),
    });
    if (window.vex && window.vex.automations) {
      window.vex.automations.onEvent((e) => this._onEvent(e));
      if (typeof AttentionInbox !== 'undefined' && AttentionInbox.handle) AttentionInbox.handle(this.ID, (key) => { if (/^open-run:/.test(key)) this.showRun(key.slice(9)).catch(err => this._fail(err)); });
      this.refresh().catch(err => console.error('[Automations] could not read its state:', err));
    }
    this._setCommands();
    return true;
  },
};

// Dialog and toast text goes through the interface language (js/i18n-ui.js); in English, or before it is loaded, it is as written.
function autoTr(text) { return (typeof window !== 'undefined' && typeof window.vexTr === 'function') ? window.vexTr(text) : text; }

if (typeof window !== 'undefined') { window.VexAutomations = VexAutomations; VexAutomations.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAutomations };
