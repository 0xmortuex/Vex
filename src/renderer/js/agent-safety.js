// === Vex Agent safety rules (task runner + page recorder) ===
//
// Everything that decides whether an automated step may happen lives here, as
// plain functions with no DOM and no model, so it can be tested on its own and
// so the task runner (agent-task-runner.js) and the page recorder
// (page-recorder.js) cannot disagree about what is dangerous.
//
//   - off by default; one global kill switch that also stops every run
//   - a step either READS (navigate, read, scroll, search...) or WRITES (type,
//     choose, click). Writes are confirmed one by one, every time.
//   - never a password, card number, one-time code or autofill secret: not
//     typed, not read, not recorded
//   - never a private, Tor or routed tab, never a page on the user's exclude
//     list, never a download or install
//   - a hard step budget and a time budget
//
// Stored in localStorage: 'vex.agentTask.enabled', 'vex.agentTask.prefs'.
// Public API: AgentSafety, AgentBudget.

// The two field tests are standalone functions with no outer references: the
// recorder and the task runner inject their source into the guest page, so the
// page and Vex apply literally the same rule.
function agentIsSensitiveField(d) {
  d = d || {};
  var type = String(d.type || '').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;
  var ac = String(d.autocomplete || '').toLowerCase();
  if (/(^|\s)(cc-[a-z-]+|one-time-code|current-password|new-password|username|webauthn)($|\s)/.test(ac)) return true;
  var hint = [d.name, d.id, d.label, d.placeholder, d.ariaLabel].map(function (x) { return String(x || ''); }).join(' ').toLowerCase();
  if (/\bpass(word|code|phrase)?\b|\bpwd\b|\bpin\b|\botp\b|one[- _]?time|verification[- _]?code|security[- _]?code|\b2fa\b|\bmfa\b|\bcvv\b|\bcvc\b|\bcsc\b|card[- _]?(number|no|num)|cc[- _]?(num|number|exp|csc|cvc)|expir|\biban\b|routing[- _]?number|account[- _]?number|\bssn\b|social[- _]?security|secret|api[- _]?key|token/.test(hint)) return true;
  return false;
}

function agentLooksLikeSecretValue(text) {
  var s = String(text == null ? '' : text);
  var digits = s.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digits)) {
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = digits.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    if (sum % 10 === 0) return true;
  }
  // A whole value that is a 6-8 digit code reads as a one-time code.
  if (/^\d{6,8}$/.test(s.trim())) return true;
  return false;
}

class AgentBudget {
  // maxSteps / maxMs are hard limits. now() is injectable for tests.
  constructor({ maxSteps = 25, maxMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxSteps = Math.max(1, Math.floor(maxSteps));
    this.maxMs = Math.max(1000, Math.floor(maxMs));
    this.now = now;
    this.used = 0;
    this.startedAt = null;
    this._pausedAt = null;
    this._pausedTotal = 0;
  }
  start() { if (this.startedAt == null) this.startedAt = this.now(); }
  // Time spent paused or waiting for a person to answer is not the agent's.
  pause() { if (this._pausedAt == null) this._pausedAt = this.now(); }
  resume() { if (this._pausedAt != null) { this._pausedTotal += this.now() - this._pausedAt; this._pausedAt = null; } }
  elapsed() {
    if (this.startedAt == null) return 0;
    const end = this._pausedAt != null ? this._pausedAt : this.now();
    return Math.max(0, end - this.startedAt - this._pausedTotal);
  }
  // → '' when one more step may run, else the reason it may not.
  check() {
    if (this.used >= this.maxSteps) return 'The step budget of ' + this.maxSteps + ' steps is used up';
    if (this.elapsed() >= this.maxMs) return 'The time budget of ' + Math.round(this.maxMs / 60000) + ' minutes is used up';
    return '';
  }
  consume() { this.used++; }
}

const AgentSafety = {
  ENABLED_KEY: 'vex.agentTask.enabled',
  PREFS_KEY: 'vex.agentTask.prefs',
  DEFAULT_STEPS: 25,
  MAX_STEPS_CAP: 50,
  DEFAULT_MINUTES: 10,
  MAX_MINUTES_CAP: 30,

  // What a plan may contain. Anything else is refused outright.
  READ_OPS: ['search', 'read_url', 'navigate', 'read_page', 'scroll', 'find', 'wait', 'summarize'],
  WRITE_OPS: ['type', 'select', 'click'],

  isSensitiveField: agentIsSensitiveField,
  looksLikeSecretValue: agentLooksLikeSecretValue,
  // Source of both field tests, to be placed in the guest page.
  guestHelpers() { return agentIsSensitiveField.toString(); },

  // Never let a card number or a code reach a log, a prompt or a notification.
  redact(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (agentLooksLikeSecretValue(m) ? '[card number removed]' : m));
    s = s.replace(/\b(code|otp|pin|passcode|password)\b([^\d\n]{0,24})\d{4,8}\b/gi, '$1$2[removed]');
    return s;
  },

  classifyOp(op) {
    if (this.READ_OPS.includes(op)) return 'read';
    if (this.WRITE_OPS.includes(op)) return 'write';
    return null;
  },

  // --- on / off / kill ----------------------------------------------------
  _listeners: new Set(),
  _store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } },
  _privateWindow() { return !!(typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  available() { return !this._privateWindow(); },
  enabled() {
    if (!this.available()) return false;
    const st = this._store();
    try { return !!st && st.getItem(this.ENABLED_KEY) === 'on'; } catch { return false; }
  },
  setEnabled(on) {
    if (this._privateWindow()) throw new Error('The Vex agent is not available in a private window');
    const st = this._store();
    if (!st) throw new Error('The setting could not be saved');
    st.setItem(this.ENABLED_KEY, on ? 'on' : 'off');
    if (!on) this._fire('Switched off in Settings');
    return !!on;
  },
  // The red button: turn the feature off AND stop everything that is running,
  // including scheduled page-script runs. Turning it on again is a deliberate
  // act in Settings.
  kill(reason) {
    const st = this._store();
    try { if (st) st.setItem(this.ENABLED_KEY, 'off'); } catch { /* the stop below still happens */ }
    this._fire(reason || 'Kill switch pressed');
  },
  onKill(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _fire(reason) {
    for (const fn of [...this._listeners]) {
      try { fn(reason); } catch (err) { console.error('[AgentSafety] a kill listener failed:', err); }
    }
    try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:agent-kill', { detail: { reason } })); } catch { /* no document */ }
  },

  // --- preferences ----------------------------------------------------------
  prefs() {
    const out = { maxSteps: this.DEFAULT_STEPS, maxMinutes: this.DEFAULT_MINUTES, useCloud: false };
    const st = this._store();
    let raw = null;
    try { raw = st ? JSON.parse(st.getItem(this.PREFS_KEY) || 'null') : null; } catch { raw = null; }
    if (raw && typeof raw === 'object') {
      const n = Math.floor(Number(raw.maxSteps));
      if (n >= 1) out.maxSteps = Math.min(n, this.MAX_STEPS_CAP);
      const m = Math.floor(Number(raw.maxMinutes));
      if (m >= 1) out.maxMinutes = Math.min(m, this.MAX_MINUTES_CAP);
      out.useCloud = raw.useCloud === true;
    }
    return out;
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...(patch || {}) };
    const st = this._store();
    if (!st) throw new Error('The setting could not be saved');
    st.setItem(this.PREFS_KEY, JSON.stringify({ maxSteps: next.maxSteps, maxMinutes: next.maxMinutes, useCloud: next.useCloud === true }));
    return this.prefs();
  },

  // Local model unless the person's existing choice is already cloud AND they
  // ticked "use cloud" for the agent. status is AIRouter.getOllamaStatus().
  chooseBackend(prefs, status) {
    if (prefs && prefs.useCloud === true && status && status.forceCloud === true) return 'cloud';
    return 'local';
  },

  // --- where the agent may go ----------------------------------------------
  DOWNLOAD_EXT: /\.(exe|msi|msix|dmg|pkg|deb|rpm|apk|ipa|iso|zip|rar|7z|tar|gz|tgz|bz2|xz|bat|cmd|ps1|vbs|jar|scr|appimage|crx|xpi)(\?|#|$)/i,
  NAV_BLOCK_EXT: /\.(pdf|docx?|xlsx?|pptx?|csv)(\?|#|$)/i,

  // → '' when the address may be visited, else why not.
  urlRefusal(url, { forNavigation = false } = {}) {
    let u;
    try { u = new URL(String(url || '')); } catch { return 'That is not a valid address'; }
    if (!/^https?:$/.test(u.protocol)) return 'Only http and https pages are used';
    if (u.username || u.password) return 'Addresses with a login inside are not used';
    if (this.DOWNLOAD_EXT.test(u.pathname + u.search)) return 'That address is a file download, and the agent never downloads or installs files';
    if (forNavigation && this.NAV_BLOCK_EXT.test(u.pathname)) return 'That address is a document the browser would download, and the agent never downloads files';
    let pa = null;
    try { pa = typeof VexPrivateAddress !== 'undefined' ? VexPrivateAddress : (typeof require === 'function' ? require('./private-address.js') : null); } catch { pa = null; }
    if (pa && pa.isPrivateHost(u.hostname)) return 'Pages on this machine or the local network are not used';
    if (typeof Recall !== 'undefined' && Recall && typeof Recall.isExcluded === 'function' && Recall.isExcluded(u.href)) return 'This site is on your exclude list';
    return '';
  },

  // Why the agent may not act in this tab ('' = it may).
  tabRefusal(webview, url) {
    if (this._privateWindow()) return 'The Vex agent is not available in a private window';
    if (!webview) return 'There is no page to work in';
    const p = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (!p || typeof p.canReadWebview !== 'function' || !p.canReadWebview(webview)) return 'The agent never works in private, Tor or routed tabs';
    return this.urlRefusal(url);
  },

  // A field the step wants to type into or read.
  // probe = what the guest reported about the element.
  fieldRefusal(probe, value) {
    if (!probe) return '';
    if (agentIsSensitiveField(probe)) return 'That is a password, payment, one-time-code or autofill field. The agent never types or reads those: do it yourself';
    if (value != null && agentLooksLikeSecretValue(value)) return 'That value looks like a card number or a one-time code, which the agent never types';
    return '';
  },

  // A click or choice. probe: { submits, formActionOrigin, pageOrigin, href, download }.
  clickRefusal(probe) {
    if (!probe) return '';
    if (agentIsSensitiveField(probe)) return 'That control belongs to a password, payment or one-time-code field';
    if (probe.formHasSensitive === true) return 'That button belongs to a form with a password, payment or one-time-code field. Sign in or pay yourself';
    if (probe.download === true) return 'That link downloads a file, and the agent never downloads or installs files';
    if (probe.href) {
      const why = this.urlRefusal(probe.href);
      if (why) return why;
    }
    return '';
  },

  // A click that would post a form to a different site needs its own, fresh
  // confirmation even when the person already allowed the step.
  crossOriginPost(probe) {
    if (!probe || !probe.submits || !probe.formActionOrigin || !probe.pageOrigin) return '';
    return probe.formActionOrigin !== probe.pageOrigin ? probe.formActionOrigin : '';
  },
};

if (typeof window !== 'undefined') { window.AgentSafety = AgentSafety; window.AgentBudget = AgentBudget; }
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentSafety, AgentBudget, agentIsSensitiveField, agentLooksLikeSecretValue };
