// === Page automation recorder ===
//
// Do a job on a site once - click, type, scroll - and Vex writes it down as a
// page-actions script (js/page-actions.js) bound to that exact origin. Then it
// can be replayed on demand, dry-run to see what it WOULD do, or put on the
// existing scheduler ("download this report every Monday").
//
// What keeps it safe:
//   - recording and replay need page actions turned on, and never happen in a
//     private window or a private, Tor or routed tab, or on an excluded site
//   - password / payment / one-time-code / autofill fields are recorded as
//     `ask selector: ...` ("ask me"): the value never leaves the page and is
//     never written to the script; the replay waits for you to fill it
//   - a script is bound to one origin (page-actions enforces it)
//   - a SCHEDULED run does no click or typing unless you approved that exact
//     text for unattended runs; editing the script drops the approval (it is a
//     fingerprint of the source, and PageActions.update clears it as well)
//   - a script with an "ask me" step never runs unattended
//   - three failures in a row pause its schedule and tell you
//   - the global kill switch (AgentSafety.kill) stops runs and its schedules
//
// A recording is of ONE page: if the page does a full navigation, the steps up
// to there are kept and recording ends (a script runs inside one document).
//
// Stored: scripts in 'vex.pageActions' (PageActions), run log in
// 'vex.pageRecorder.runs', failure state in 'vex.pageRecorder.state'. Local
// only; not part of Vex Sync.
// Public API: PageRecorder.

const _RecSafety = (typeof AgentSafety !== 'undefined') ? AgentSafety : (typeof require === 'function' ? require('./agent-safety.js').AgentSafety : null);

const PageRecorder = {
  RUNS_KEY: 'vex.pageRecorder.runs',
  STATE_KEY: 'vex.pageRecorder.state',
  KILLED_KEY: 'vex.pageRecorder.killed',
  MAX_RUNS: 200,
  MAX_FAILS: 3,
  MAX_EVENTS: 200,
  RUN_TIMEOUT_MS: 2 * 60 * 1000,

  _rec: null,
  _active: new Map(),     // scriptId -> AbortController of a scheduled run

  // --- turning events into a script (pure) ---------------------------------
  _q(text) { return '"' + String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; },

  // events: [{t:'click', text, unique, selector} | {t:'type', selector, value, desc}
  //          | {t:'ask', selector} | {t:'scroll', to:'top'|'bottom'|'heading', text}]
  // → { source, steps, asks, truncated }
  eventsToSource(events, { maxSteps = 40, maxSource = 4000, safety = _RecSafety } = {}) {
    const lines = [];
    const push = (l) => lines.push(l);
    let asks = 0, truncated = false;
    const list = Array.isArray(events) ? events : [];
    // Collapse: a typing burst keeps the last value; repeated scrolls keep one.
    const prepared = [];
    for (const ev of list) {
      if (!ev || typeof ev !== 'object') continue;
      const prev = prepared[prepared.length - 1];
      if (ev.t === 'type' && prev && prev.t === 'type' && prev.selector === ev.selector) { prepared[prepared.length - 1] = ev; continue; }
      if (ev.t === 'ask' && prev && prev.t === 'ask' && prev.selector === ev.selector) continue;
      if (ev.t === 'scroll' && prev && prev.t === 'scroll' && prev.to === ev.to && prev.text === ev.text) continue;
      prepared.push(ev);
    }
    const sel = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
    prepared.forEach((ev, i) => {
      let line = null;
      if (ev.t === 'click') {
        const text = String(ev.text || '').replace(/\s+/g, ' ').trim();
        if (text && text.length <= 60 && ev.unique !== false) line = 'click ' + this._q(text);
        else if (sel(ev.selector)) line = 'click selector: ' + sel(ev.selector);
      } else if (ev.t === 'type' && sel(ev.selector)) {
        // The page said it is fine, and Vex checks again: by the field's own
        // description and by what the value looks like.
        const secret = safety.isSensitiveField(ev.desc || {}) || safety.looksLikeSecretValue(ev.value);
        if (secret) { line = 'ask selector: ' + sel(ev.selector); asks++; }
        else line = 'type selector: ' + sel(ev.selector) + ' = ' + this._q(String(ev.value == null ? '' : ev.value).slice(0, 300));
      } else if (ev.t === 'ask' && sel(ev.selector)) {
        line = 'ask selector: ' + sel(ev.selector); asks++;
      } else if (ev.t === 'scroll') {
        if (ev.to === 'top') line = 'scroll top';
        else if (ev.to === 'bottom') line = 'scroll bottom';
        else if (ev.to === 'heading' && String(ev.text || '').trim()) line = 'scroll to ' + this._q(String(ev.text).trim().slice(0, 80));
      }
      if (!line) return;
      push(line);
      // Let the page react before the next step.
      if (ev.t === 'click' && i < prepared.length - 1) push('wait 600');
    });
    let out = [], steps = 0, size = 0;
    for (const l of lines) {
      const isStep = !/^#/.test(l);
      if ((isStep && steps >= maxSteps) || size + l.length + 1 > maxSource) { truncated = true; break; }
      out.push(l); size += l.length + 1; if (isStep) steps++;
    }
    // A trailing wait does nothing.
    while (out.length && /^wait /.test(out[out.length - 1])) { out.pop(); steps--; }
    return { source: out.join('\n'), steps, asks, truncated };
  },

  // A small stable fingerprint of the script text (not a secret; an identity).
  fingerprint(source) {
    const s = String(source == null ? '' : source).replace(/\r\n/g, '\n').trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fp' + h.toString(16).padStart(8, '0') + '-' + s.length;
  },

  // Steps that change a page (a click, typed text, an "ask me") as opposed to
  // looking at it (scroll, wait, hide).
  isWriteStep(step) { return !!step && (step.op === 'click' || step.op === 'type' || step.op === 'ask'); },

  // → '' when a script may run unattended, else why not.
  unattendedRefusal(script, parse) {
    const parsed = parse(script.source);
    if (parsed.errors.length || !parsed.steps.length) return 'The script has an error';
    if (parsed.steps.some(s => s.op === 'ask')) return 'It has an "ask me" step (a password or code), which only you can fill';
    const writes = parsed.steps.filter(s => this.isWriteStep(s));
    if (writes.length && script.scheduleApproval !== this.fingerprint(script.source)) {
      return 'It clicks or types, and you have not approved that for unattended runs (or the script was edited since)';
    }
    return '';
  },

  // --- the guest side ----------------------------------------------------------
  recorderCode({ trustedOnly = true } = {}) {
    return `(function(){
  if (window.__vexRec && window.__vexRec.on) return 'already';
  var isSensitive = ${_RecSafety.guestHelpers()};
  var rec = window.__vexRec = { on: true, events: [] };
  var trustedOnly = ${trustedOnly ? 'true' : 'false'};
  var push = function(e){ if (rec.events.length < ${this.MAX_EVENTS}) rec.events.push(e); };
  var esc = function(s){ return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\\w-])/g, '\\\\$1'); };
  var norm = function(s){ return String(s||'').replace(/\\s+/g,' ').trim(); };
  var textOf = function(el){ return norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || ''); };
  var visible = function(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var labelOf = function(el){
    var t = ''; try { if (el.labels && el.labels[0]) t = el.labels[0].innerText || el.labels[0].textContent || ''; } catch (e) {}
    return norm(t);
  };
  var path = function(el){
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    var tid = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (tid) return '[' + (el.getAttribute('data-testid') ? 'data-testid' : 'data-test') + '="' + String(tid).replace(/"/g, '') + '"]';
    var nm = el.getAttribute('name');
    if (nm) { var q = el.tagName.toLowerCase() + '[name="' + String(nm).replace(/"/g, '') + '"]'; if (document.querySelectorAll(q).length === 1) return q; }
    var parts = [], cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 5) {
      var tag = cur.tagName.toLowerCase(), idx = 1, sib = cur;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) idx++;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      if (cur.id && document.querySelectorAll('#' + esc(cur.id)).length === 1) { parts[0] = '#' + esc(cur.id); break; }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  var isTextField = function(el){
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (tag !== 'INPUT') return false;
    return !/^(button|submit|checkbox|radio|image|reset|file|color|range)$/i.test(el.type || 'text');
  };
  var desc = function(el){ return { type: el.getAttribute('type') || '', name: el.getAttribute('name') || '', id: el.id || '', autocomplete: el.getAttribute('autocomplete') || '', label: labelOf(el), placeholder: el.getAttribute('placeholder') || '', ariaLabel: el.getAttribute('aria-label') || '' }; };
  var onClick = function(e){
    if (trustedOnly && !e.isTrusted) return;
    var t = e.target; if (!t || !t.closest) return;
    var el = t.closest('a,button,[role=button],[role=tab],[role=menuitem],input[type=button],input[type=submit],input[type=checkbox],input[type=radio],summary,label') || t;
    if (isTextField(el)) return;
    var text = textOf(el).slice(0, 80);
    var same = 0;
    if (text) {
      var all = document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],input[type=button],input[type=submit],summary,label');
      for (var i = 0; i < all.length; i++) if (visible(all[i]) && textOf(all[i]).toLowerCase().indexOf(text.toLowerCase()) !== -1) same++;
    }
    push({ t: 'click', text: text, unique: same === 1, selector: path(el) });
  };
  var onChange = function(e){
    if (trustedOnly && !e.isTrusted) return;
    var el = e.target; if (!el || !el.tagName || !isTextField(el)) return;
    var d = desc(el);
    // A secret field's value is not even read.
    if (isSensitive(d)) { push({ t: 'ask', selector: path(el) }); return; }
    push({ t: 'type', selector: path(el), value: el.isContentEditable ? el.textContent : el.value, desc: d });
  };
  var timer = null;
  var onScroll = function(){
    clearTimeout(timer);
    timer = setTimeout(function(){
      var y = window.scrollY || document.documentElement.scrollTop || 0, h = document.documentElement.scrollHeight, vh = window.innerHeight || 800;
      if (y <= 10) return push({ t: 'scroll', to: 'top' });
      if (y + vh >= h - 10) return push({ t: 'scroll', to: 'bottom' });
      var heads = document.querySelectorAll('h1,h2,h3,h4,h5,h6'), best = null, bestD = 1e9;
      for (var i = 0; i < heads.length; i++) {
        var r = heads[i].getBoundingClientRect(), txt = textOf(heads[i]);
        if (!txt || r.bottom < -vh * 0.2 || r.top > vh * 0.8) continue;
        var dist = Math.abs(r.top - vh * 0.2);
        if (dist < bestD) { bestD = dist; best = txt; }
      }
      if (best) push({ t: 'scroll', to: 'heading', text: best.slice(0, 80) });
    }, 500);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  window.addEventListener('scroll', onScroll, true);
  rec.off = function(){
    rec.on = false; clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    window.removeEventListener('scroll', onScroll, true);
  };
  return 'ok';
})()`;
  },
  drainCode() { return '(function(){ var r = window.__vexRec; if (!r) return []; var e = r.events; r.events = []; return e; })()'; },
  stopCode() { return '(function(){ var r = window.__vexRec; if (!r) return []; var e = r.events; r.events = []; if (r.off) r.off(); delete window.__vexRec; return e; })()'; },

  // --- storage -----------------------------------------------------------------
  _get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; } },
  _set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { throw new Error('The recorder could not save: ' + ((err && err.message) || err)); } },
  runs(scriptId) { const all = this._get(this.RUNS_KEY, []); const list = Array.isArray(all) ? all : []; return scriptId ? list.filter(r => r.scriptId === scriptId) : list; },
  _logRun(entry) {
    const list = this.runs();
    list.unshift({ id: 'rr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), ...entry });
    if (list.length > this.MAX_RUNS) list.length = this.MAX_RUNS;
    this._set(this.RUNS_KEY, list);
    return list[0];
  },
  clearRuns() { const old = this.runs(); this._set(this.RUNS_KEY, []); return old; },
  state(id) { const all = this._get(this.STATE_KEY, {}); return (all && all[id]) || { fails: 0, paused: false }; },
  _setState(id, patch) { const all = this._get(this.STATE_KEY, {}) || {}; all[id] = { ...(all[id] || { fails: 0, paused: false }), ...patch }; this._set(this.STATE_KEY, all); return all[id]; },
  killed() { try { return localStorage.getItem(this.KILLED_KEY) === '1'; } catch { return false; } },
  rearm() { try { localStorage.removeItem(this.KILLED_KEY); } catch { /* nothing to clear */ } },

  _script(id) {
    const s = PageActions.scripts().find(x => x.id === id);
    if (!s) throw new Error('That script no longer exists');
    return s;
  },
  _tasksFor(scriptId) {
    if (typeof Scheduler === 'undefined') return [];
    return Scheduler.getAllTasks().filter(t => t.action && t.action.type === 'pageScript' && t.action.scriptId === scriptId);
  },

  // --- failure handling ----------------------------------------------------------
  // Called with the outcome of every SCHEDULED run. Three in a row pause the
  // script's schedules and say so.
  recordOutcome(scriptId, ok, error) {
    const st = this.state(scriptId);
    if (ok) { this._setState(scriptId, { fails: 0, lastError: '' }); return { paused: st.paused === true }; }
    const fails = (st.fails || 0) + 1;
    const pause = fails >= this.MAX_FAILS;
    this._setState(scriptId, { fails, lastError: String(error || '').slice(0, 200), paused: st.paused === true || pause });
    if (pause && st.paused !== true) {
      for (const t of this._tasksFor(scriptId)) { try { Scheduler.setEnabled(t.id, false); } catch (err) { console.error('[PageRecorder] could not pause a schedule:', err); } }
      let name = 'A recorded page script';
      try { name = '"' + this._script(scriptId).name + '"'; } catch { /* deleted meanwhile */ }
      this._notify(name + ' paused', 'It failed ' + this.MAX_FAILS + ' times in a row (' + String(error || '').slice(0, 120) + '). Fix it or run it once yourself, then resume it in Settings.');
    }
    return { paused: pause || st.paused === true };
  },
  resume(scriptId) {
    this._setState(scriptId, { fails: 0, paused: false, lastError: '' });
    for (const t of this._tasksFor(scriptId)) { try { Scheduler.setEnabled(t.id, true); } catch (err) { console.error('[PageRecorder] could not resume a schedule:', err); } }
  },
  _notify(title, body) {
    if (typeof Scheduler !== 'undefined' && typeof Scheduler._notify === 'function') return Scheduler._notify(title, body);
    if (typeof window !== 'undefined') window.showToast?.(title + ': ' + body, 'error');
  },

  // --- running ----------------------------------------------------------------
  _activeWebview() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = tab && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    return { tab, wv };
  },
  _evaluate(lines) { return { bad: lines.filter(l => !/: ok( \(|$)/.test(l)) }; },

  // Look, do nothing: find every element and say what would happen.
  async dryRun(id) {
    this._requireOn();
    const s = this._script(id);
    const { tab, wv } = this._activeWebview();
    const lines = await PageActions._runOn(s, tab, wv, false, { dry: true, quiet: true });
    const { bad } = this._evaluate(lines);
    this._logRun({ scriptId: id, name: s.name, mode: 'dry', ok: bad.length === 0, lines, error: bad.join('; ').slice(0, 300) });
    return { ok: bad.length === 0, lines };
  },

  // On demand, in the open tab. The person is here; a script that clicks or
  // types is shown to them first.
  async run(id) {
    this._requireOn();
    const s = this._script(id);
    const parsed = PageActions.parse(s.source);
    const writes = parsed.steps.filter(x => this.isWriteStep(x));
    if (writes.length) {
      const list = parsed.steps.filter(x => this.isWriteStep(x)).slice(0, 8).map(x => '- ' + x.op + ' ' + (x.by === 'text' ? '"' + x.value + '"' : x.value) + (x.op === 'type' ? ' = "' + x.text + '"' : '')).join('\n');
      const ok = await window.vexConfirm({ title: 'Run "' + s.name + '"?', message: 'It will act on ' + s.origin + ' as you:\n' + list + (writes.length > 8 ? '\n...and ' + (writes.length - 8) + ' more' : ''), okLabel: 'Run it' });
      if (!ok) return { ok: false, lines: ['Cancelled'], cancelled: true };
    }
    const { tab, wv } = this._activeWebview();
    const lines = await PageActions._runOn(s, tab, wv, false, { quiet: true });
    const { bad } = this._evaluate(lines);
    this._logRun({ scriptId: id, name: s.name, mode: 'manual', ok: bad.length === 0, lines, error: bad.join('; ').slice(0, 300) });
    if (bad.length === 0) this._setState(id, { fails: 0 });
    window.showToast?.(s.name + ': ' + (bad.length ? bad.join('; ') : 'done'), bad.length ? 'error' : undefined);
    return { ok: bad.length === 0, lines };
  },

  _requireOn() {
    if (!PageActions.available()) throw new Error('Page actions are not available in a private window');
    if (!PageActions.enabled()) throw new Error('Page actions are turned off (Settings › Page actions)');
  },

  // The scheduled path. Everything that can stop it stops it BEFORE a page is
  // touched; anything that goes wrong afterwards throws so the scheduler marks
  // the run failed, and three of those in a row pause the schedule.
  async runScheduled(scriptId, ctx = {}) {
    const refuse = (msg, countsAsFailure) => {
      this._logRun({ scriptId, name: this._safeName(scriptId), mode: 'scheduled', ok: false, lines: [], error: msg });
      if (countsAsFailure) this.recordOutcome(scriptId, false, msg);
      throw new Error(msg);
    };
    if (this.killed()) refuse('The kill switch was pressed; scheduled page scripts are held until you allow them again', false);
    if (!PageActions.available() || !PageActions.enabled()) refuse('Page actions are turned off', false);
    let s;
    try { s = this._script(scriptId); } catch (err) { throw err; }
    if (this.state(scriptId).paused) refuse('This script is paused after repeated failures', false);
    const why = this.unattendedRefusal(s, (src) => PageActions.parse(src));
    if (why) refuse(why, false);
    const startUrl = s.startUrl || (s.origin + '/');
    const startWhy = _RecSafety.urlRefusal(startUrl);
    if (startWhy) refuse(startWhy, false);

    const controller = new AbortController();
    this._active.set(scriptId, controller);
    if (ctx.controller && ctx.controller.signal) ctx.controller.signal.addEventListener('abort', () => controller.abort(), { once: true });
    let tab = null;
    try {
      tab = TabManager.createTab(startUrl, false);
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv) throw new Error('Could not create the background tab');
      if (window.VexLifecycle && typeof window.VexLifecycle.ready === 'function') await window.VexLifecycle.ready(wv, controller.signal);
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('The script took longer than ' + Math.round(this.RUN_TIMEOUT_MS / 60000) + ' minutes')), this.RUN_TIMEOUT_MS));
      const aborted = new Promise((_, rej) => controller.signal.addEventListener('abort', () => rej(new Error('Stopped by the kill switch')), { once: true }));
      const current = TabManager.tabs.find(t => t.id === tab.id) || tab;
      const lines = await Promise.race([PageActions._runOn(s, current, wv, true, { noAsk: true, quiet: true }), timeout, aborted]);
      const { bad } = this._evaluate(lines);
      if (bad.length) throw new Error(bad.join('; ').slice(0, 300));
      this._logRun({ scriptId, name: s.name, mode: 'scheduled', ok: true, lines, error: '' });
      this.recordOutcome(scriptId, true);
      return s.name + ': ' + lines.length + ' step' + VexPlural.s(lines.length) + ' done';
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (controller.signal.aborted && this.killed()) {
        this._logRun({ scriptId, name: s.name, mode: 'scheduled', ok: false, lines: [], error: msg });
        throw err;
      }
      this._logRun({ scriptId, name: s.name, mode: 'scheduled', ok: false, lines: [], error: msg });
      this.recordOutcome(scriptId, false, msg);
      throw err;
    } finally {
      this._active.delete(scriptId);
      if (tab) { try { TabManager.closeTab(tab.id); } catch { /* already gone */ } }
    }
  },
  _safeName(id) { try { return this._script(id).name; } catch { return ''; } },

  // The kill switch: held until the person allows scheduled runs again.
  onKill(reason) {
    try { localStorage.setItem(this.KILLED_KEY, '1'); } catch { /* the aborts below still happen */ }
    for (const c of this._active.values()) { try { c.abort(); } catch { /* already finished */ } }
    if (this._rec) this.cancelRecording().catch(() => {});
    if (typeof Scheduler !== 'undefined') {
      for (const t of Scheduler.getAllTasks()) {
        if (t.action && t.action.type === 'pageScript' && t.enabled) { try { Scheduler.setEnabled(t.id, false); } catch (err) { console.error('[PageRecorder] could not hold a schedule:', err); } }
      }
    }
  },

  // --- approval + scheduling --------------------------------------------------------
  async approveUnattended(id) {
    const s = this._script(id);
    const parsed = PageActions.parse(s.source);
    if (parsed.steps.some(x => x.op === 'ask')) throw new Error('A script with an "ask me" step cannot run unattended');
    const writes = parsed.steps.filter(x => this.isWriteStep(x));
    const list = writes.slice(0, 10).map(x => '- ' + x.op + ' ' + (x.by === 'text' ? '"' + x.value + '"' : x.value) + (x.op === 'type' ? ' = "' + x.text + '"' : '')).join('\n') || '(nothing: it only scrolls and waits)';
    const ok = await window.vexConfirm({
      title: 'Let "' + s.name + '" act without you?',
      message: 'When it runs on a schedule it will do this on ' + s.origin + ', as you, with no one watching:\n' + list + (writes.length > 10 ? '\n...and ' + (writes.length - 10) + ' more' : '') + '\n\nIf you edit the script this approval is cancelled.',
      okLabel: 'Approve these steps',
    });
    if (!ok) return false;
    const state = PageActions._load();
    const target = state.scripts.find(x => x.id === id);
    if (!target) throw new Error('That script no longer exists');
    target.scheduleApproval = this.fingerprint(target.source);
    PageActions._save(state);
    return true;
  },

  // "every monday at 9" -> a Scheduler task running this script.
  createSchedule(id, when) {
    const s = this._script(id);
    if (typeof Scheduler === 'undefined' || typeof ScheduleWords === 'undefined') throw new Error('The scheduler is not available');
    const schedule = ScheduleWords.parse(when);
    const refusal = this.unattendedRefusal(s, (src) => PageActions.parse(src));
    // Scheduling is allowed before approval - the run will refuse and say why -
    // but a script that can NEVER run unattended is refused here.
    if (/"ask me"/.test(refusal)) throw new Error(refusal);
    const data = { name: 'Page script: ' + s.name, schedule, action: { type: 'pageScript', scriptId: id }, notifyOnFail: true, notifyOnComplete: false, catchUp: false };
    const errors = Scheduler.validate(data);
    if (errors.length) throw new Error(errors[0]);
    return Scheduler.createTask(data);
  },

  // --- recording --------------------------------------------------------------------
  recording() { return !!this._rec; },

  async start() {
    this._requireOn();
    if (this._rec) throw new Error('Already recording');
    if (this.killed()) throw new Error('The kill switch was pressed; allow page automation again in Settings first');
    const { tab, wv } = this._activeWebview();
    const why = PageActions.refusal(wv, tab && tab.url);
    if (why) throw new Error(why);
    const siteWhy = _RecSafety.urlRefusal(tab.url);
    if (siteWhy) throw new Error(siteWhy);
    const origin = PageActions.originOf(tab.url);
    const out = await wv.executeJavaScript(this.recorderCode());
    if (out !== 'ok' && out !== 'already') throw new Error('The page would not let recording start');
    const rec = { tabId: tab.id, wv, origin, startUrl: tab.url, events: [], timer: null, navigated: false };
    const onNav = (e) => { if (!e || e.isInPlace === true) return; rec.navigated = true; this.finishRecording().catch(err => window.showToast?.(err.message, 'error')); };
    rec.onNav = onNav;
    try { wv.addEventListener('did-navigate', onNav); } catch { /* a webview stand-in without events */ }
    rec.timer = setInterval(async () => {
      try { const ev = await wv.executeJavaScript(this.drainCode()); if (Array.isArray(ev)) rec.events.push(...ev); } catch { /* page navigating */ }
    }, 500);
    this._rec = rec;
    this._banner(true);
    return { origin };
  },

  async _closeRecording() {
    const rec = this._rec;
    if (!rec) return null;
    clearInterval(rec.timer);
    try { rec.wv.removeEventListener('did-navigate', rec.onNav); } catch { /* gone */ }
    try { const ev = await rec.wv.executeJavaScript(this.stopCode()); if (Array.isArray(ev)) rec.events.push(...ev); } catch { /* the page navigated away: what was drained is kept */ }
    this._rec = null;
    this._banner(false);
    return rec;
  },

  async cancelRecording() { await this._closeRecording(); },

  // Stop, turn the events into steps, and save as a page action.
  async finishRecording({ name } = {}) {
    const rec = await this._closeRecording();
    if (!rec) throw new Error('Nothing is being recorded');
    const built = this.eventsToSource(rec.events);
    if (!built.steps) { window.showToast?.('Nothing was recorded', 'error'); return null; }
    const finalName = name || (await window.vexPrompt({ title: 'Save this recording', message: built.steps + ' step' + VexPlural.s(built.steps) + ' on ' + rec.origin
      + (built.asks ? '. ' + built.asks + ' secret field' + (built.asks === 1 ? ' is' : 's are') + ' set to "ask me": you fill them at replay.' : '')
      + (built.truncated ? ' It was longer than a script can be, so it stops there.' : '')
      + (rec.navigated ? ' The page navigated, so the recording ends there.' : ''), label: 'Name', value: 'Recorded on ' + rec.origin.replace(/^https?:\/\//, ''), okLabel: 'Save' }));
    if (!finalName || !String(finalName).trim()) return null;
    const id = PageActions.add({ name: finalName, origin: rec.origin, source: built.source });
    const state = PageActions._load();
    const s = state.scripts.find(x => x.id === id);
    if (s) { s.startUrl = rec.startUrl; s.recorded = true; PageActions._save(state); }
    window.showToast?.('Saved "' + String(finalName).trim() + '" - try a dry run first');
    return id;
  },

  _banner(on) {
    if (typeof document === 'undefined') return;
    document.getElementById('vex-recorder-banner')?.remove();
    if (!on) return;
    const b = document.createElement('div');
    b.id = 'vex-recorder-banner';
    b.className = 'vex-recorder-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span class="vex-recorder-dot" aria-hidden="true"></span><span>Recording on ' + window.escapeHtml((this._rec && this._rec.origin) || '') + ' - password and code fields are never recorded</span>'
      + '<button type="button" class="btn-secondary-sm" data-act="stop">Stop and save</button><button type="button" class="btn-secondary-sm" data-act="cancel">Discard</button>';
    b.querySelector('[data-act=stop]').addEventListener('click', () => this.finishRecording().catch(err => window.showToast?.(err.message, 'error')));
    b.querySelector('[data-act=cancel]').addEventListener('click', () => this.cancelRecording().catch(err => window.showToast?.(err.message, 'error')));
    document.body.appendChild(b);
  },

  // --- Settings + Ctrl+K ------------------------------------------------------------------
  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    if (!PageActions.available()) { container.innerHTML = '<div class="muted" style="font-size:12px">Not available in a private window.</div>'; return; }
    const scripts = PageActions.scripts().filter(s => s.recorded);
    const on = PageActions.enabled();
    const icon = (n) => (window.VexIcons ? VexIcons.svg(n, { size: 14 }) : '');
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Do something once on a site and Vex saves it as a page action you can replay, dry-run, or schedule. Password and code fields are never recorded: they become "ask me". A scheduled run does no clicking or typing unless you approved those exact steps, and three failures in a row pause it.</p>
      ${on ? '' : '<div class="muted" style="font-size:12px;margin-bottom:8px">Turn on page actions (Settings › Page actions) first.</div>'}
      ${this.killed() ? '<div class="vex-rec-killed" role="alert" style="margin-bottom:8px">The kill switch was pressed: scheduled page scripts are held. <button type="button" class="btn-secondary-sm" data-act="rearm">Allow them again</button></div>' : ''}
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" data-act="record" ${on && !this._rec ? '' : 'disabled'}>${icon('target')} Record the open site</button>
        <button type="button" class="btn-secondary" data-act="kill">${icon('stop')} Stop all page automation now</button>
        <button type="button" class="btn-secondary" data-act="clearlog">Clear run log</button>
      </div>
      <div id="rec-list">${scripts.length ? scripts.map(s => {
        const st = this.state(s.id);
        const approved = s.scheduleApproval && s.scheduleApproval === this.fingerprint(s.source);
        const last = this.runs(s.id)[0];
        return `<div class="site-settings-row" data-id="${esc(s.id)}">
          <div class="site-settings-info">
            <div class="site-settings-host">${esc(s.name)}</div>
            <div class="site-settings-what">${esc(s.origin)} · ${approved ? 'approved for unattended runs' : 'asks before unattended writes'}${st.paused ? ' · PAUSED after ' + this.MAX_FAILS + ' failures' : ''}${last ? ' · last: ' + (last.ok ? 'ok' : 'failed') + ' (' + esc(last.mode) + ')' : ''}</div>
          </div>
          <button type="button" class="btn-secondary-sm" data-act="dry">Dry run</button>
          <button type="button" class="btn-secondary-sm" data-act="run">Run</button>
          <button type="button" class="btn-secondary-sm" data-act="approve">Approve unattended</button>
          <button type="button" class="btn-secondary-sm" data-act="schedule">Schedule</button>
          ${st.paused ? '<button type="button" class="btn-secondary-sm" data-act="resume">Resume</button>' : ''}
          <button type="button" class="btn-secondary-sm" data-act="log">Log</button>
        </div>`;
      }).join('') : '<div class="muted" style="font-size:12px">No recordings yet.</div>'}</div>`;
    const again = () => this.renderSettings(container);
    const guard = async (fn) => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } again(); };
    container.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      const row = el.closest('[data-id]');
      const id = row && row.dataset.id;
      el.addEventListener('click', () => guard(async () => {
        if (act === 'record') { const r = await this.start(); window.showToast?.('Recording on ' + r.origin); }
        else if (act === 'kill') { _RecSafety.kill('Stopped from page recorder settings'); window.showToast?.('All page automation stopped'); }
        else if (act === 'rearm') { this.rearm(); }
        else if (act === 'clearlog') {
          if (await window.vexConfirm({ title: 'Clear the run log?', message: 'This removes the results of every recorded run.', okLabel: 'Clear', danger: true })) this.clearRuns();
        } else if (act === 'dry') { const r = await this.dryRun(id); await window.vexConfirm({ title: 'Dry run: ' + (r.ok ? 'everything was found' : 'something is missing'), message: r.lines.join('\n') || 'Nothing to do', okLabel: 'OK', cancelLabel: 'Close' }); }
        else if (act === 'run') await this.run(id);
        else if (act === 'approve') { if (await this.approveUnattended(id)) window.showToast?.('Approved for unattended runs'); }
        else if (act === 'schedule') {
          const when = await window.vexPrompt({ title: 'When should it run?', message: 'In plain words: "every monday at 9", "every weekday at 8:30".', label: 'When', okLabel: 'Schedule' });
          if (when && when.trim()) { const t = this.createSchedule(id, when); window.showToast?.('Scheduled: ' + ScheduleWords.describe(t.schedule)); }
        } else if (act === 'resume') this.resume(id);
        else if (act === 'log') {
          const list = this.runs(id).slice(0, 10).map(r => new Date(r.at).toLocaleString() + ' · ' + r.mode + ' · ' + (r.ok ? 'ok' : 'FAILED: ' + r.error)).join('\n');
          await window.vexConfirm({ title: 'Run log', message: list || 'No runs yet', okLabel: 'OK', cancelLabel: 'Close' });
        }
      }));
    });
  },

  _registerCommands() {
    if (typeof window === 'undefined' || !window.VexModuleCommands) return;
    const list = [];
    if (PageActions.enabled()) {
      list.push(this._rec
        ? { id: 'pagerec:stop', label: 'Stop recording and save', hint: 'Save the recorded steps as a page action', icon: 'stop', action: () => this.finishRecording().catch(err => window.showToast?.(err.message, 'error')) }
        : { id: 'pagerec:start', label: 'Record page actions on this site', hint: 'Click, type and scroll once; replay it later', icon: 'target', action: () => this.start().then(r => window.showToast?.('Recording on ' + r.origin)).catch(err => window.showToast?.(err.message, 'error')) });
      for (const s of PageActions.scripts().filter(x => x.recorded)) {
        list.push({ id: 'pagerec:dry:' + s.id, label: 'Dry run recorded script: ' + s.name, hint: s.origin, icon: 'search', action: () => this.dryRun(s.id).then(r => window.showToast?.(s.name + ': ' + (r.ok ? 'everything was found' : r.lines.filter(l => !/: ok/.test(l)).join('; ')), r.ok ? undefined : 'error')).catch(err => window.showToast?.(err.message, 'error')) });
      }
    }
    VexModuleCommands.set('pagerec:', list);
  },

  init() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    if (_RecSafety && _RecSafety.onKill) _RecSafety.onKill((why) => this.onKill(why));
    if (window.VexSettingsGroups) VexSettingsGroups.register({ id: 'page-recorder', title: 'Page recorder — record and schedule boost scripts', render: (c) => this.renderSettings(c) });
    if (typeof Scheduler !== 'undefined' && Scheduler.ACTIONS) {
      Scheduler.ACTIONS.pageScript = {
        label: 'Replay a recorded page script',
        hint: 'Replays a script recorded with the page recorder, in a background tab. Schedule it from Settings › Page recorder.',
        validate: (a) => {
          if (!a || !a.scriptId) return ['Schedule a recorded script from Settings › Page recorder'];
          try { PageRecorder._script(a.scriptId); } catch { return ['That recorded script no longer exists']; }
          return [];
        },
        summary: (a) => 'Replay page script: ' + (PageRecorder._safeName(a && a.scriptId) || 'unknown'),
        async run(task, ctx) { return PageRecorder.runScheduled(task.action.scriptId, ctx); },
      };
    }
    this._registerCommands();
    document.addEventListener('vex:tab-settled', () => this._registerCommands());
  },
};

if (typeof window !== 'undefined') { window.PageRecorder = PageRecorder; if (typeof PageActions !== 'undefined') PageRecorder.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { PageRecorder };
