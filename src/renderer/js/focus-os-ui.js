// === Focus OS: the panel and its Settings group ================================
//
// A small window: the day's progress ring and one line ("2 of 5 blocks done"),
// today's blocks with Start / Done / Skip, and the goals with their proposed
// blocks waiting for a yes. Nothing here changes a plan by itself: Plan blocks
// only PROPOSES, and a proposal becomes real on Confirm.
//
// The logic is FocusOS (focus-os.js) over the pure planner
// (focus-os-planner.js). This file is DOM only, built with textContent so a
// goal's title can never become markup.
const FocusOSUI = {
  ID: 'vex-focusos',
  STYLE_ID: 'vex-focusos-style',
  _proposals: {},      // goalId -> last propose() answer, for the notes under it
  _unlisten: null,

  CSS: `
    #vex-focusos { position:fixed; inset:0; z-index:100050; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; font-family:'Outfit',sans-serif; }
    #vex-focusos .fo-box { width:600px; max-width:95vw; max-height:88vh; display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; box-shadow:0 24px 60px var(--vex-shadow-color, rgba(0,0,0,.5)); }
    #vex-focusos .fo-head { display:flex; align-items:center; gap:8px; padding:16px 20px 8px; }
    #vex-focusos .fo-title { flex:1; font-size:15px; font-weight:700; display:inline-flex; align-items:center; gap:7px; }
    #vex-focusos .fo-body { overflow-y:auto; padding:6px 20px 20px; font-size:12.5px; }
    #vex-focusos .fo-day { display:flex; align-items:center; gap:14px; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg); margin-bottom:12px; }
    #vex-focusos .fo-ring-track { stroke:var(--border); }
    #vex-focusos .fo-ring-fill { stroke:var(--primary, var(--accent, #d4a574)); }
    #vex-focusos .fo-line { font-size:14px; font-weight:600; }
    #vex-focusos .fo-sub { font-size:11.5px; color:var(--text-muted); }
    #vex-focusos h4 { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); margin:14px 0 6px; font-weight:600; }
    #vex-focusos .fo-row { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:9px; margin-bottom:6px; background:var(--bg); }
    #vex-focusos .fo-row.fo-active { border-color:var(--primary, var(--accent, #d4a574)); }
    #vex-focusos .fo-row.fo-muted { opacity:.65; }
    #vex-focusos .fo-grow { flex:1; min-width:0; }
    #vex-focusos .fo-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #vex-focusos .fo-btn { padding:5px 10px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:7px; cursor:pointer; font-size:12px; font-family:inherit; display:inline-flex; align-items:center; gap:5px; }
    #vex-focusos .fo-btn:hover { background:var(--vex-hover-fill, rgba(127,127,127,.12)); }
    #vex-focusos .fo-btn.fo-primary { background:var(--primary, var(--accent, #d4a574)); color:#111; border-color:transparent; font-weight:600; }
    #vex-focusos .fo-bar { height:5px; border-radius:3px; background:var(--border); overflow:hidden; margin-top:5px; }
    #vex-focusos .fo-bar > i { display:block; height:100%; background:var(--primary, var(--accent, #d4a574)); }
    #vex-focusos .fo-note { font-size:11.5px; color:var(--text-muted); margin:4px 0 8px; }
    #vex-focusos .fo-form label { display:flex; gap:8px; align-items:center; margin:6px 0; flex-wrap:wrap; }
    #vex-focusos .fo-form input[type=text], #vex-focusos .fo-form input[type=date], #vex-focusos .fo-form input[type=number], #vex-focusos .fo-form select { padding:5px 8px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:7px; font-family:inherit; font-size:12.5px; }
    #vex-focusos .fo-form input[type=text] { flex:1; min-width:180px; }
  `,

  // ---- tiny DOM helpers ----------------------------------------------------------------
  _icon(name, size) {
    try { return (window.VexIcons && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 14 }) : ''; } catch { return ''; }
  },
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _btn(label, icon, onClick, primary, aria) {
    const b = this._el('button', 'fo-btn' + (primary ? ' fo-primary' : ''));
    b.type = 'button';
    if (aria) { b.setAttribute('aria-label', aria); b.title = aria; }
    if (icon) b.insertAdjacentHTML('afterbegin', this._icon(icon, 13));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', () => { Promise.resolve().then(onClick).catch(err => this._fail(err)); });
    return b;
  },
  _fail(err) { try { window.showToast?.((err && err.message) || String(err), 'error'); } catch { /* no toast layer */ } console.error('[FocusOS]', err); },
  _time(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); },
  _date(ms) { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); },
  _hours(min) { return min >= 60 ? (Math.round(min / 6) / 10) + ' h' : min + ' min'; },

  ring(fraction, size = 56) {
    const r = 22, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, fraction || 0));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 56 56');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', Math.round(f * 100) + ' percent of today\'s blocks done');
    for (const [cls, dash] of [['fo-ring-track', null], ['fo-ring-fill', f]]) {
      const ci = document.createElementNS(NS, 'circle');
      ci.setAttribute('class', cls); ci.setAttribute('cx', '28'); ci.setAttribute('cy', '28'); ci.setAttribute('r', String(r));
      ci.setAttribute('fill', 'none'); ci.setAttribute('stroke-width', '5');
      if (dash !== null) { ci.setAttribute('stroke-dasharray', (c * dash).toFixed(1) + ' ' + c.toFixed(1)); ci.setAttribute('stroke-linecap', 'round'); ci.setAttribute('transform', 'rotate(-90 28 28)'); }
      svg.appendChild(ci);
    }
    return svg;
  },

  // ---- the window ---------------------------------------------------------------------
  open() {
    if (typeof FocusOS === 'undefined') throw new Error('Focus OS is not available in this build');
    this.close();
    if (!document.getElementById(this.STYLE_ID)) {
      const st = this._el('style'); st.id = this.STYLE_ID; st.textContent = this.CSS; document.head.appendChild(st);
    }
    const m = this._el('div'); m.id = this.ID;
    const box = this._el('div', 'fo-box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'fo-title');
    const head = this._el('div', 'fo-head');
    const title = this._el('span', 'fo-title'); title.id = 'fo-title';
    title.insertAdjacentHTML('afterbegin', this._icon('target', 16));
    title.appendChild(document.createTextNode('Focus OS'));
    const x = this._btn('', 'x', () => this.close()); x.setAttribute('aria-label', 'Close'); x.title = 'Close';
    head.append(title, x);
    const body = this._el('div', 'fo-body'); body.id = 'fo-body';
    box.append(head, body); m.appendChild(box);
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'focus-os-ui' });
    m.addEventListener('click', (e) => { if (e.target === m) this.close(); });
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', onKey);
    this._unlisten = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('vex:focus-os-changed', this._onChange); };
    this._onChange = () => { if (!this._formOpen) this.paint(); };
    document.addEventListener('vex:focus-os-changed', this._onChange);
    this.paint();
    x.focus({ preventScroll: true });
    return m;
  },
  close() {
    const m = document.getElementById(this.ID);
    if (m) m.remove();
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    this._formOpen = false;
  },

  paint() {
    const body = document.querySelector('#' + this.ID + ' #fo-body');
    if (!body) return;
    const P = FocusOSPlanner, now = Date.now();
    body.textContent = '';
    this._formOpen = false;

    // The day: ring + one line.
    const d = P.dayProgress(FocusOS.blocks(), now);
    const day = this._el('div', 'fo-day');
    const txt = this._el('div', 'fo-grow');
    txt.append(this._el('div', 'fo-line', d.text), this._el('div', 'fo-sub', this._date(now)));
    day.append(this.ring(d.fraction), txt);
    body.appendChild(day);

    // A running block.
    const run = FocusOS.active();
    if (run) {
      const g = FocusOS.goal(run.goalId);
      const r = this._el('div', 'fo-row fo-active');
      const t = this._el('div', 'fo-grow');
      t.append(this._el('div', 'fo-name', (g ? g.title : 'Focus block')), this._el('div', 'fo-sub', 'Running until ' + this._time(run.end)));
      r.append(t,
        this._btn('Done', 'check', async () => { await FocusOS.finish(run.id); }, true),
        this._btn('Stop without counting', 'skip', async () => { await FocusOS.skip(run.id); }));
      body.appendChild(r);
    }

    // Today's blocks.
    body.appendChild(this._el('h4', null, 'Today'));
    const today = FocusOS.today(now);
    if (!today.length) body.appendChild(this._el('div', 'fo-note', 'Nothing planned for today. Plan blocks for a goal below.'));
    for (const b of today) body.appendChild(this._blockRow(b, now));

    // Goals.
    const h = this._el('h4', null, 'Goals');
    body.appendChild(h);
    const goals = FocusOS.goals();
    if (!goals.length) body.appendChild(this._el('div', 'fo-note', 'Say what you want done and by when. Vex proposes the blocks around your calendar and reminders; nothing starts until you say so.'));
    for (const g of goals) body.appendChild(this._goalCard(g, now));
    const add = this._btn('New goal', 'plus', () => this.newGoal(), goals.length === 0);
    add.style.marginTop = '6px';
    body.appendChild(add);
  },

  _blockRow(b, now) {
    const g = FocusOS.goal(b.goalId);
    const row = this._el('div', 'fo-row' + (b.state === 'active' ? ' fo-active' : '') + (b.state === 'skipped' ? ' fo-muted' : ''));
    const t = this._el('div', 'fo-grow');
    t.append(this._el('div', 'fo-name', g ? g.title : 'Focus block'),
      this._el('div', 'fo-sub', this._time(b.start) + ' – ' + this._time(b.end) + (b.state === 'done' ? ' · done' : b.state === 'skipped' ? ' · set aside' : b.state === 'active' ? ' · running' : '')));
    row.appendChild(t);
    if (b.state === 'planned') {
      row.append(this._btn('Start', 'play', async () => { await FocusOS.start(b.id); }, true),
        this._btn('Skip', 'skip', async () => { await FocusOS.skip(b.id); }));
    } else if (b.state === 'skipped' && b.end > now) {
      row.appendChild(this._btn('Put back', 'undo', async () => { FocusOS.restore(b.id); }));
    }
    return row;
  },

  _goalCard(g, now) {
    const P = FocusOSPlanner;
    const card = this._el('div', 'fo-row');
    card.style.flexWrap = 'wrap';
    const top = this._el('div', 'fo-grow');
    const p = P.goalProgress(g, FocusOS.blocks());
    top.append(
      this._el('div', 'fo-name', g.title + (g.status === 'done' ? ' (finished)' : '')),
      this._el('div', 'fo-sub', 'Due ' + this._date(g.deadline) + ' · ' + this._hours(p.doneMin) + ' of ' + this._hours(g.estimateMin) + (g.autoStart ? ' · auto-start on' : '')));
    const bar = this._el('div', 'fo-bar'); const fill = document.createElement('i'); fill.style.width = Math.round(p.fraction * 100) + '%'; bar.appendChild(fill);
    top.appendChild(bar);
    card.appendChild(top);

    if (g.status === 'active') {
      card.append(
        this._btn('Plan blocks', 'calendar', async () => {
          const r = await FocusOS.propose(g.id);
          this._proposals[g.id] = r;
          this.paint();
        }),
        this._btn('', 'edit', async () => { this.form(g); }, false, 'Edit goal'),
        this._btn(p.remainingMin === 0 ? 'Finish goal' : '', 'check', async () => { FocusOS.completeGoal(g.id); }, false, 'Mark the goal finished'),
        this._btn('', 'trash', async () => {
          const ok = await window.vexConfirm({ title: 'Remove this goal?', message: '"' + g.title + '" and its planned blocks are removed.', okLabel: 'Remove', danger: true });
          if (ok) await FocusOS.removeGoal(g.id);
        }, false, 'Remove goal'));
      const prop = FocusOS.proposed(g.id);
      if (prop.length) card.appendChild(this._proposalBox(g, prop));
      else if (this._proposals[g.id]) card.appendChild(this._noteBox(this._proposals[g.id]));
    } else {
      card.appendChild(this._btn('Reopen', 'undo', async () => { FocusOS.reopenGoal(g.id); }));
    }
    return card;
  },

  _noteText(r) {
    const bits = [];
    if (r.reason === 'nothing-left') bits.push('All the planned time is already done.');
    else if (r.reason === 'deadline-passed') bits.push('The deadline has passed. Edit the goal to move it.');
    else if (r.shortfallMin > 0) bits.push((r.blocks.length ? 'Only room for ' + this._hours(r.plannedMin) + ' before the deadline; ' : 'No free room before the deadline; ') + this._hours(r.shortfallMin) + ' would not fit. A later deadline, fewer hours or a longer work day would help.');
    const left = [];
    if (r.sources) {
      if (r.sources.calendar === false) left.push('your calendar');
      if (r.sources.reminders === false) left.push('your reminders');
    }
    if (left.length) bits.push('Planned without ' + left.join(' or ') + ' (not available here).');
    for (const w of r.warnings || []) bits.push(w);
    if (r.calibratedBlockMin) bits.push('Blocks are ' + r.calibratedBlockMin + ' minutes: how long you really stay with something in this workspace (Focus block length).');
    return bits.join(' ');
  },
  _noteBox(r) {
    const w = this._el('div', 'fo-note', this._noteText(r) || 'Nothing to propose.');
    w.style.flexBasis = '100%';
    return w;
  },
  _proposalBox(g, prop) {
    const wrap = this._el('div');
    wrap.style.flexBasis = '100%';
    wrap.appendChild(this._el('div', 'fo-sub', 'Proposed — nothing is booked until you confirm:'));
    for (const b of prop) wrap.appendChild(this._el('div', 'fo-sub', this._date(b.start) + ' · ' + this._time(b.start) + ' – ' + this._time(b.end)));
    const note = this._proposals[g.id] ? this._noteText(this._proposals[g.id]) : '';
    if (note) wrap.appendChild(this._el('div', 'fo-note', note));
    const row = this._el('div'); row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    row.append(this._btn('Confirm ' + prop.length + ' block' + (prop.length === 1 ? '' : 's'), 'check', async () => { await FocusOS.confirmGoal(g.id); delete this._proposals[g.id]; }, true),
      this._btn('Discard', 'x', async () => { await FocusOS.discard(g.id); delete this._proposals[g.id]; }));
    wrap.appendChild(row);
    return wrap;
  },

  // ---- new goal / edit goal ---------------------------------------------------------------
  async newGoal() {
    if (!document.getElementById(this.ID)) this.open();
    const text = await window.vexPrompt({ title: 'New goal', label: 'What should be done, and by when?', value: '', placeholder: 'ship the release by Friday, 6 hours', okLabel: 'Continue' });
    if (text === null || !String(text).trim()) return;
    const p = FocusOSPlanner.parseGoalText(text);
    const st = FocusOS.settings();
    this.form({
      title: p.title || String(text).trim(),
      deadline: p.deadlineDay != null ? FocusOSPlanner.deadlineAt(p.deadlineDay, st.workTo) : null,
      estimateMin: p.estimateMin || 120,
      flowId: '', budget: null, quiet: false, autoStart: false, remind: false,
    }, true);
  },

  form(g, creating) {
    const body = document.querySelector('#' + this.ID + ' #fo-body');
    if (!body) return;
    this._formOpen = true;
    body.textContent = '';
    const P = FocusOSPlanner;
    const f = this._el('div', 'fo-form');
    const row = (label, ...els) => { const l = this._el('label'); l.append(document.createTextNode(label), ...els); f.appendChild(l); return l; };
    const input = (type, value, attrs) => { const i = document.createElement('input'); i.type = type; if (value != null) i.value = value; Object.entries(attrs || {}).forEach(([k, v]) => i.setAttribute(k, v)); return i; };

    const title = input('text', g.title || '', { 'aria-label': 'Goal title', maxlength: '120' });
    const dayVal = g.deadline ? P.dayKey(g.deadline) : '';
    const due = input('date', dayVal, { 'aria-label': 'Due date' });
    const hours = input('number', Math.round(((g.estimateMin || 120) / 60) * 10) / 10, { min: '0.25', max: '100', step: '0.25', 'aria-label': 'Hours of work' });
    hours.style.width = '80px';
    row('Goal', title);
    row('Due', due);
    row('Hours of work', hours);

    const flows = (typeof FocusFlows !== 'undefined' && typeof FocusFlows._load === 'function') ? FocusFlows._load() : [];
    const flow = document.createElement('select'); flow.setAttribute('aria-label', 'Focus flow');
    flow.appendChild(new Option('None', ''));
    for (const fl of flows) flow.appendChild(new Option(fl.name || fl.id, fl.id));
    flow.value = g.flowId || '';
    row('Focus flow while a block runs', flow);
    if (!flows.length) f.appendChild(this._el('div', 'fo-note', 'No focus flows yet. Make one in Focus Flows and it appears here.'));

    let catBoxes = [];
    const budgetMin = input('number', g.budget ? g.budget.minutes : 15, { min: '1', max: '1440', 'aria-label': 'Minutes allowed' });
    budgetMin.style.width = '70px';
    if (typeof DistractionBudget !== 'undefined' && Array.isArray(DistractionBudget.CATEGORIES)) {
      const l = this._el('label'); l.appendChild(document.createTextNode('Limit these kinds of site while a block runs:'));
      f.appendChild(l);
      const cl = this._el('label');
      catBoxes = DistractionBudget.CATEGORIES.map(c => {
        const cb = input('checkbox'); cb.checked = !!(g.budget && g.budget.categories.includes(c)); cb.value = c;
        const s = this._el('span', null, (DistractionBudget.LABELS && DistractionBudget.LABELS[c]) || c);
        const w = this._el('label'); w.append(cb, s); cl.appendChild(w); return cb;
      });
      f.appendChild(cl);
      row('to', budgetMin, document.createTextNode('minutes a day'));
    }

    const quiet = input('checkbox'); quiet.checked = !!g.quiet;
    const hasQuiet = !!(window.vex && window.vex.quiet);
    row('Hold notifications while a block runs' + (hasQuiet ? '' : ' (quiet hours are not in this build)'), quiet).querySelector('input').disabled = !hasQuiet;
    const remind = input('checkbox'); remind.checked = !!g.remind;
    row('Remind me when a block is due', remind);
    const auto = input('checkbox'); auto.checked = !!g.autoStart;
    row('Start blocks by themselves when their time comes', auto);
    f.appendChild(this._el('div', 'fo-note', 'Off unless you turn it on. Blocks never start while a game is running.'));

    const actions = this._el('div'); actions.style.cssText = 'display:flex;gap:6px;margin-top:10px';
    actions.append(
      this._btn(creating ? 'Add goal' : 'Save', 'check', async () => {
        if (!due.value) throw new Error('Pick the day it is due');
        const [y, mo, da] = due.value.split('-').map(Number);
        const deadline = P.deadlineAt(new Date(y, mo - 1, da).getTime(), FocusOS.settings().workTo);
        const cats = catBoxes.filter(c => c.checked).map(c => c.value);
        const fields = {
          title: title.value, deadline, estimateMin: Math.round(Number(hours.value) * 60),
          flowId: flow.value, quiet: quiet.checked && hasQuiet, autoStart: auto.checked, remind: remind.checked,
          budget: cats.length ? { categories: cats, minutes: Number(budgetMin.value), mode: 'nudge' } : null,
        };
        if (creating) { const ng = FocusOS.addGoal(fields); this._formOpen = false; this.paint(); await FocusOS.propose(ng.id).then(r => { this._proposals[ng.id] = r; this.paint(); }); }
        else { FocusOS.updateGoal(g.id, fields); this._formOpen = false; this.paint(); }
      }, true),
      this._btn('Cancel', 'x', async () => { this._formOpen = false; this.paint(); }));
    f.appendChild(actions);
    body.appendChild(f);
    title.focus({ preventScroll: true });
  },

  // ---- Settings group, injected at run time ---------------------------------------------------
  group({ id, title, intro }) {
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return null;
    let g = document.getElementById(id);
    if (!g) {
      g = this._el('div', 'setting-group'); g.id = id;
      g.appendChild(this._el('label', 'setting-label', title));
      if (intro) { const p = this._el('div', null, intro); p.style.cssText = 'font-size:12px;color:var(--text-muted);margin:2px 0 8px'; g.appendChild(p); }
      g.appendChild(this._el('div', 'focus-os-body'));
      const about = document.getElementById('settings-version');
      const last = about && about.closest('.setting-group');
      if (last && last.parentElement === root) root.insertBefore(g, last); else root.appendChild(g);
    }
    return g.querySelector('.focus-os-body');
  },

  mountSettings() {
    const body = this.group({ id: 'settings-focus-os', title: 'Focus OS (goals and work blocks)', intro: 'State a goal and Vex proposes work blocks around your calendar and reminders. You confirm them and start them; nothing runs on its own unless you turn on auto-start for a goal.' });
    if (!body || body.dataset.ready) return body;
    body.dataset.ready = '1';
    const st = () => FocusOS.settings();
    const save = (patch, after) => { try { FocusOS.setSettings(patch); if (after) after(); } catch (err) { this._fail(err); show(); } };
    const field = (label, el) => { const l = this._el('label'); l.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0;flex-wrap:wrap'; l.append(document.createTextNode(label), el); body.appendChild(l); return l; };
    const input = (type, attrs) => { const i = document.createElement('input'); i.type = type; i.className = 'set-input'; Object.entries(attrs || {}).forEach(([k, v]) => i.setAttribute(k, v)); return i; };

    const from = input('time', { 'aria-label': 'Work day start' });
    const to = input('time', { 'aria-label': 'Work day end' });
    const len = input('number', { min: '10', max: '180', 'aria-label': 'Block length in minutes' });
    const brk = input('number', { min: '0', max: '60', 'aria-label': 'Break in minutes' });
    const per = input('number', { min: '1', max: '10', 'aria-label': 'Blocks per day' });
    const meals = input('text', { 'aria-label': 'Meal windows', placeholder: '12:00-13:00, 18:30-19:30' });
    for (const i of [len, brk, per]) i.style.width = '70px';
    meals.style.width = '240px';
    field('Work day', from); body.lastChild.append(document.createTextNode('to'), to);
    field('Block length (minutes)', len);
    field('Break between blocks (minutes)', brk);
    field('Most blocks per day, per goal', per);
    field('Keep these times clear', meals);

    const cb = (label, key) => {
      const l = this._el('label'); l.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0;cursor:pointer';
      const i = document.createElement('input'); i.type = 'checkbox'; i.style.cursor = 'pointer';
      i.addEventListener('change', () => save({ [key]: i.checked }));
      l.append(i, document.createTextNode(label)); body.appendChild(l); return i;
    };
    const briefCb = cb('Show today\'s blocks in the Morning Brief', 'brief');
    const weeklyCb = cb('Add the blocks to the weekly review', 'weekly');
    const open = this._btn('Open Focus OS', 'target', () => this.open());
    open.style.marginTop = '6px';
    body.appendChild(open);

    const show = () => {
      const s = st();
      from.value = s.workFrom; to.value = s.workTo; len.value = s.blockMin; brk.value = s.breakMin; per.value = s.maxPerDay;
      meals.value = s.meals.map(m => m.from + '-' + m.to).join(', ');
      briefCb.checked = s.brief !== false; weeklyCb.checked = s.weekly !== false;
    };
    from.addEventListener('change', () => save({ workFrom: from.value }));
    to.addEventListener('change', () => save({ workTo: to.value }));
    len.addEventListener('change', () => save({ blockMin: Number(len.value) }));
    brk.addEventListener('change', () => save({ breakMin: Number(brk.value) }));
    per.addEventListener('change', () => save({ maxPerDay: Number(per.value) }));
    meals.addEventListener('change', () => {
      const parts = meals.value.split(',').map(x => x.trim()).filter(Boolean).map(x => { const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(x); if (!m) return { from: x, to: '' }; return { from: m[1].padStart(5, '0'), to: m[2].padStart(5, '0') }; });
      save({ meals: parts });
    });
    show();
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.FocusOSUI = FocusOSUI;
  // Wire up once the page is there. A test sets __FOCUS_OS_NO_AUTOINIT__ and
  // drives FocusOS itself.
  if (typeof document !== 'undefined' && !window.__FOCUS_OS_NO_AUTOINIT__) {
    const go = () => {
      try { if (typeof FocusOS !== 'undefined') FocusOS.init().catch(err => console.error('[FocusOS] init failed:', err.message)); } catch (err) { console.error('[FocusOS] init failed:', err.message); }
      try { FocusOSUI.mountSettings(); } catch (err) { console.error('[FocusOS] settings group failed:', err.message); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(go, 1500));
    else setTimeout(go, 1500);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusOSUI };
