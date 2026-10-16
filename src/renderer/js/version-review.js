// === Version review: rate the version you are running ========================
//
// When an update is announced (the update cover opens), or once on the first
// start after an update, Vex asks - once per version - how the version you are
// running went: 1 to 5 for speed, stability, design, features, AI, privacy and
// games/battery, a few "what you experienced" tags, and an optional comment
// (500 characters at most).
//
// It NEVER touches the update. The card is shown fire-and-forget from the
// 'vex:update-cover' event (js/update-notifier.js dispatches it and does not
// wait); the update proceeds whether the card is answered, closed or ignored.
// "Not now" and "Never ask again" are always there.
//
// How it speaks: through the Attention Budget as an 'asked' item, but it still
// honours AttentionState: in Game mode, a meeting, Focus, quiet hours, the
// wind-down or the quiet switch it waits in the Attention Inbox instead.
//
// XP: a finished review earns the 'feedback' action of VexLevels (js/fun/levels.js)
// and the medals feedback-first / feedback-5, ONCE per version, and nothing for
// an empty review (it needs a rating or a comment of 10 characters or more).
// The amount never depends on how good or bad the rating is.
//
// Storage (this device only; none of it is synced):
//   vex.reviews        the reviews: [{ version, date, ratings, chips, comment, sent? }], newest last, 50 at most
//   vex.reviews.prefs  { on, never, send, relayUrl }
//   vex.reviews.state  { offered, rewarded, lastRun, installId }
//
// Sending is OFF by default. It needs the switch, a relay address (https, set in
// Settings; empty means local only) and a one-time consent that lists exactly
// what is sent. What is sent is built in src/main/feedback-relay.js (buildPayload).
const VersionReview = {
  FEATURE: 'version-review',
  REVIEWS_KEY: 'vex.reviews',
  PREFS_KEY: 'vex.reviews.prefs',
  STATE_KEY: 'vex.reviews.state',
  CONSENT_ID: 'version-review-send',
  MAX_REVIEWS: 50,
  MAX_COMMENT: 500,
  MIN_COMMENT_XP: 10,
  XP_KIND: 'feedback',
  DEFAULTS: { on: true, never: false, send: false, relayUrl: '' },

  CATEGORIES: [
    { id: 'speed', label: 'Speed' },
    { id: 'stability', label: 'Stability' },
    { id: 'design', label: 'Design' },
    { id: 'features', label: 'Features' },
    { id: 'ai', label: 'AI' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'games', label: 'Games and battery' },
  ],
  CHIPS: [
    { id: 'bug', label: 'I saw a bug' },
    { id: 'slow', label: 'It felt slow' },
    { id: 'crash', label: 'It crashed' },
    { id: 'loved', label: 'I loved a feature' },
    { id: 'missing', label: 'Something is missing' },
    { id: 'smooth', label: 'It ran smoothly' },
  ],

  _now() { return Date.now(); },

  // ---- pure helpers ---------------------------------------------------------
  cmpVersion(a, b) {
    const pa = String(a).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  },

  // Cleans a draft into { ratings, chips, comment }. Throws on a value that is
  // not valid (a rating outside 1 to 5, an unknown tag, a comment that is too
  // long); it does NOT judge whether the review is empty (see isMeaningful).
  normalize(draft) {
    const d = draft && typeof draft === 'object' ? draft : {};
    const ratings = {};
    const given = d.ratings && typeof d.ratings === 'object' ? d.ratings : {};
    for (const k of Object.keys(given)) {
      if (!this.CATEGORIES.some(c => c.id === k)) throw new Error('Unknown rating category: ' + k);
      const n = given[k];
      if (n === null || n === undefined) continue;
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('A rating is a whole number from 1 to 5');
      ratings[k] = n;
    }
    const chips = [];
    for (const c of Array.isArray(d.chips) ? d.chips : []) {
      if (!this.CHIPS.some(x => x.id === c)) throw new Error('Unknown tag: ' + String(c).slice(0, 20));
      if (!chips.includes(c)) chips.push(c);
    }
    let comment = typeof d.comment === 'string' ? d.comment.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
    if (Array.from(comment).length > this.MAX_COMMENT) throw new Error('The comment is longer than ' + this.MAX_COMMENT + ' characters');
    return { ratings, chips, comment };
  },

  // A review that counts: at least one category rated, or a comment of 10+
  // characters. Tags alone do not make a review.
  isMeaningful(n) {
    return Object.keys(n.ratings).length > 0 || n.comment.trim().length >= this.MIN_COMMENT_XP;
  },

  average(review) {
    const v = Object.values(review.ratings || {});
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  },

  // Plain text of one or more reviews, for "Copy as text".
  formatText(reviews) {
    const label = (id, list) => (list.find(x => x.id === id) || { label: id }).label;
    return reviews.map(r => {
      const lines = ['Vex ' + r.version + ' (' + String(r.date || '').slice(0, 10) + ')'];
      for (const c of this.CATEGORIES) if (r.ratings && r.ratings[c.id]) lines.push('  ' + c.label + ': ' + r.ratings[c.id] + '/5');
      if (r.chips && r.chips.length) lines.push('  Experienced: ' + r.chips.map(c => label(c, this.CHIPS)).join(', '));
      if (r.comment) lines.push('  Comment: ' + r.comment);
      return lines.join('\n');
    }).join('\n\n');
  },

  // What the consent dialog says. It lists EXACTLY the fields of the payload.
  consentText(relayUrl) {
    return 'When you save a review, Vex will send this to your relay (' + (relayUrl || 'no address set') + '):\n\n'
      + '  - an anonymous random id made on this computer (you can reset it in Settings),\n'
      + '  - the Vex version you reviewed,\n'
      + '  - your ratings,\n'
      + '  - the tags you picked,\n'
      + '  - your comment, if you wrote one.\n\n'
      + 'Never sent: your history, pages or addresses, accounts, hardware ids, anything derived from your network address, or any other setting. The request shows in the list of what left this computer. You can turn sending off at any time.';
  },

  // ---- storage ------------------------------------------------------------------
  _json(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (err) { throw new Error('The saved "' + key + '" is not readable', { cause: err }); }
  },

  prefs() {
    const v = this._json(this.PREFS_KEY, {});
    const out = { ...this.DEFAULTS };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of ['on', 'never', 'send']) if (typeof v[k] === 'boolean') out[k] = v[k];
      if (typeof v.relayUrl === 'string') out.relayUrl = v.relayUrl;
    }
    return out;
  },
  savePrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (next.relayUrl) next.relayUrl = this.checkRelayUrl(next.relayUrl);
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    return next;
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { this.savePrefs({ on: !!on }); },

  // https only, an origin plus an optional path, no credentials, query or fragment.
  // Empty means "local only". Mirrors main/feedback-relay.js, which checks it again.
  checkRelayUrl(href) {
    const raw = String(href == null ? '' : href).trim();
    if (!raw) return '';
    if (raw.length > 300) throw new Error('That address is too long');
    let u;
    try { u = new URL(raw); } catch { throw new Error('That is not a web address'); }
    if (u.protocol !== 'https:') throw new Error('Only https addresses are used');
    if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
    if (u.search || u.hash) throw new Error('The address must not have a query or a fragment');
    return u.origin + u.pathname.replace(/\/+$/, '');
  },

  state() {
    const v = this._json(this.STATE_KEY, {});
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return { offered: map(o.offered), rewarded: map(o.rewarded), lastRun: typeof o.lastRun === 'string' ? o.lastRun : '', installId: typeof o.installId === 'string' ? o.installId : '' };
  },
  _saveState(s) { localStorage.setItem(this.STATE_KEY, JSON.stringify(s)); },

  list() {
    const v = this._json(this.REVIEWS_KEY, []);
    return Array.isArray(v) ? v.filter(r => r && typeof r.version === 'string') : [];
  },
  _saveList(list) { localStorage.setItem(this.REVIEWS_KEY, JSON.stringify(list.slice(-this.MAX_REVIEWS))); },
  forVersion(version) { return this.list().find(r => r.version === version) || null; },
  forget(version) {
    const list = this.list();
    const next = list.filter(r => r.version !== version);
    if (next.length === list.length) return false;
    this._saveList(next);
    this._changed();
    return true;
  },
  forgetAll() {
    localStorage.removeItem(this.REVIEWS_KEY);
    this._changed();
  },

  // The anonymous id: random, made here, not derived from anything. Resetting
  // forgets it; the next send makes a new one.
  installId() {
    const s = this.state();
    if (s.installId) return s.installId;
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('A random id cannot be made here');
    const b = c.getRandomValues(new Uint8Array(16));
    s.installId = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    this._saveState(s);
    return s.installId;
  },
  resetInstallId() {
    const s = this.state();
    s.installId = '';
    this._saveState(s);
  },

  // The list of reviews changed (a literal name, so the event contract test sees who sends it).
  _changed(detail) {
    try { document.dispatchEvent(new CustomEvent('vex:version-review-changed', { detail })); }
    catch (err) { VexProblems?.note('Version review', 'Could not announce a change', err); }
  },
  _emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail })); }
    catch (err) { VexProblems?.note('Version review', 'Could not announce ' + name, err); }
  },

  // ---- saving a review and the reward -----------------------------------------------
  // Saves (replacing an earlier review of the same version), rewards once per
  // version, and sends when sending is on. Throws for an empty review.
  async submit(draft, { version } = {}) {
    if (typeof version !== 'string' || !version) throw new Error('A review needs the version it is about');
    const n = this.normalize(draft);
    if (!this.isMeaningful(n)) throw new Error('Rate at least one thing, or write a few words (' + this.MIN_COMMENT_XP + ' characters), to save a review');
    const review = { version, date: new Date(this._now()).toISOString(), ratings: n.ratings, chips: n.chips, comment: n.comment };
    const list = this.list().filter(r => r.version !== version);
    list.push(review);
    this._saveList(list);
    const xp = this.reward(version);
    let sent = { state: 'local' };
    if (this.sendReady()) {
      try { await this.send(review); sent = { state: 'sent' }; }
      catch (err) { sent = { state: 'failed', error: err.message }; }
    }
    this._changed({ version });
    return { review, xp, sent };
  },

  // One reward per version, and none for a version already rewarded. Returns
  // { gained, level, leveledUp } from the levels module, or { gained: 0, why }.
  reward(version) {
    const s = this.state();
    if (s.rewarded[version]) return { gained: 0, why: 'already-rewarded' };
    s.rewarded[version] = this._now();
    this._saveState(s);
    const signal = (detail) => this._emit('vex:medal-signal', detail);
    signal({ id: 'feedback-first' });
    const count = Object.keys(s.rewarded).length;
    if (count >= 5) signal({ id: 'feedback-5' });
    else signal({ id: 'feedback-5', n: count, of: 5 });
    let res = null;
    if (typeof VexLevels !== 'undefined' && typeof VexLevels.award === 'function') res = VexLevels.award(this.XP_KIND, 1);
    else this._emit('vex:fun-action', { kind: this.XP_KIND, count: 1 });
    return res ? { gained: res.gained, level: res.level, leveledUp: res.leveledUp } : { gained: 0, why: 'levels-off-or-daily-cap' };
  },

  // ---- sending (optional) -------------------------------------------------------------
  sendReady() {
    const p = this.prefs();
    if (!p.send || !p.relayUrl) return false;
    return typeof VexConsent !== 'undefined' && VexConsent.granted(this.CONSENT_ID);
  },
  async send(review) {
    const p = this.prefs();
    if (!p.send) throw new Error('Sending is off');
    if (!p.relayUrl) throw new Error('No relay address is set');
    if (typeof VexConsent === 'undefined' || !VexConsent.granted(this.CONSENT_ID)) throw new Error('Sending was not agreed to');
    if (!window.vex || typeof window.vex.feedbackSend !== 'function') throw new Error('Sending is not available in this window');
    // Only these fields are handed over; main builds and checks the rest again.
    const payload = { installId: this.installId(), version: review.version, ratings: review.ratings, chips: review.chips, comment: review.comment };
    await window.vex.feedbackSend(p.relayUrl, payload);
    const list = this.list();
    const mine = list.find(r => r.version === review.version);
    if (mine) { mine.sent = this._now(); this._saveList(list); }
  },
  // Asks the one-time consent (vexConfirm, via VexConsent) and turns sending on.
  // -> true when sending is now on.
  async enableSending() {
    const p = this.prefs();
    if (!p.relayUrl) throw new Error('Set the relay address first');
    if (typeof VexConsent === 'undefined') throw new Error('Consents are not available');
    // Turning sending on is a fresh choice: an earlier "Keep them here" must not lock the switch.
    if (VexConsent.status(this.CONSENT_ID) === 'declined') VexConsent.revoke(this.CONSENT_ID);
    const ok = await VexConsent.ask(this.CONSENT_ID, { title: 'Send your reviews?', message: this.consentText(p.relayUrl), yes: 'Send my reviews', no: 'Keep them here' });
    if (!ok) return false;
    this.savePrefs({ send: true });
    return true;
  },
  disableSending() { this.savePrefs({ send: false }); },

  // ---- when to ask ---------------------------------------------------------------------
  async currentVersion() {
    if (!window.vex || typeof window.vex.getAppVersion !== 'function') throw new Error('The Vex version is not available');
    const v = await window.vex.getAppVersion();
    if (typeof v !== 'string' || !v) throw new Error('The Vex version is not available');
    return v;
  },

  // -> { shown, why }. shown: the card is up; why: 'inbox' when it waits there.
  async maybeOffer({ version, reason = 'update' } = {}) {
    if (window.VexTabPolicy?.isPrivateWindow) return { shown: false, why: 'private-window' };
    if (!this.enabled()) return { shown: false, why: 'off' };
    if (this.prefs().never) return { shown: false, why: 'never' };
    const v = version || await this.currentVersion();
    const s = this.state();
    if (s.offered[v]) return { shown: false, why: 'already-offered' };
    if (typeof VexAttention === 'undefined' || typeof AttentionState === 'undefined') throw new Error('The review card needs the Attention Budget (js/vex-attention.js, js/attention-state.js)');
    if (VexAttention.isMuted(this.FEATURE)) return { shown: false, why: 'muted' };
    // Marked before it is shown, so the same version is never asked twice.
    s.offered[v] = { at: this._now(), reason };
    this._saveState(s);
    if (AttentionState.get().quiet) {
      VexAttention.suggest({ feature: this.FEATURE, id: v, label: 'Version review', title: 'How is Vex ' + v + ' working for you?', body: 'A short review. It never delays an update.', action: { label: 'Review', key: 'open' } });
      return { shown: false, why: 'inbox' };
    }
    const d = VexAttention.request({ feature: this.FEATURE, urgency: 'asked', id: v });
    if (!d.allow) return { shown: false, why: 'refused' };
    this.showCard({ version: v });
    return { shown: true, why: reason };
  },

  // The first start after an update: ask about the version that was running.
  async startupCheck() {
    const current = await this.currentVersion();
    const s = this.state();
    const prev = s.lastRun;
    if (prev !== current) { s.lastRun = current; this._saveState(s); }
    if (prev && this.cmpVersion(current, prev) > 0) return this.maybeOffer({ version: prev, reason: 'after-update' });
    return { shown: false, why: 'no-update' };
  },

  // Ctrl+K / Settings: the person asked, so it opens whatever the history says.
  async openNow() {
    if (!this.enabled()) {
      window.showToast?.('Version review is off. Settings > Version review turns it on.', 'info', 4000);
      return null;
    }
    const v = await this.currentVersion();
    return this.showCard({ version: v, focus: true });
  },

  // ---- the card -------------------------------------------------------------------------
  showCard({ version, focus = false } = {}) {
    document.getElementById('vr-overlay')?.remove();
    const icon = (name, size) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : '');
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const prior = this.forVersion(version);
    const draft = { ratings: { ...(prior ? prior.ratings : {}) }, chips: [...(prior ? prior.chips : [])], comment: prior ? prior.comment : '' };

    const overlay = mk('div', 'vex-dialog-overlay vr-overlay');
    overlay.id = 'vr-overlay';
    const card = mk('div', 'vex-dialog vr-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'vr-title');
    card.setAttribute('aria-describedby', 'vr-sub');
    const head = mk('div', 'vr-head');
    const ic = mk('span', 'vr-head-icon'); ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = icon('star', 22);
    const heads = mk('div', 'vr-heads');
    const title = mk('h2', 'vex-dialog-title vr-title', 'How is Vex ' + version + ' working for you?'); title.id = 'vr-title';
    const sub = mk('p', 'vr-sub', 'Rate what you used. Skip anything you did not. Your review stays on this computer' + (this.sendReady() ? ' and is sent to the relay you set.' : '.') + ' Finishing one earns a little XP, once per version, whatever you rate.');
    sub.id = 'vr-sub';
    heads.append(title, sub);
    head.append(ic, heads);
    card.appendChild(head);

    const rows = mk('div', 'vr-rows');
    for (const c of this.CATEGORIES) {
      const row = mk('div', 'vr-row');
      const name = mk('span', 'vr-name', c.label); name.id = 'vr-name-' + c.id;
      const group = mk('div', 'vr-stars');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-labelledby', name.id);
      const stars = [];
      const paint = () => {
        const cur = draft.ratings[c.id] || 0;
        stars.forEach((b, i) => {
          const on = i + 1 <= cur;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(i + 1 === cur));
          b.tabIndex = (cur ? i + 1 === cur : i === 0) ? 0 : -1;
        });
      };
      const choose = (n) => { if (draft.ratings[c.id] === n) delete draft.ratings[c.id]; else draft.ratings[c.id] = n; paint(); error.textContent = ''; };
      for (let n = 1; n <= 5; n++) {
        const b = mk('button', 'vr-star'); b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', c.label + ': ' + n + ' of 5');
        b.innerHTML = icon('star', 20);
        b.addEventListener('click', () => choose(n));
        b.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const next = Math.min(5, Math.max(1, n + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1)));
          draft.ratings[c.id] = next; paint(); stars[next - 1].focus();
        });
        stars.push(b); group.appendChild(b);
      }
      row.append(name, group);
      rows.appendChild(row);
      paint();
    }
    card.appendChild(rows);

    const chipsLabel = mk('div', 'vr-label', 'What did you experience?'); chipsLabel.id = 'vr-chips-label';
    const chips = mk('div', 'vr-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-labelledby', 'vr-chips-label');
    for (const c of this.CHIPS) {
      const b = mk('button', 'vr-chip', c.label); b.type = 'button';
      const paint = () => { const on = draft.chips.includes(c.id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
      b.addEventListener('click', () => { const i = draft.chips.indexOf(c.id); if (i >= 0) draft.chips.splice(i, 1); else draft.chips.push(c.id); paint(); });
      paint(); chips.appendChild(b);
    }
    card.append(chipsLabel, chips);

    const cl = mk('label', 'vr-label', 'Anything to add? (optional)'); cl.setAttribute('for', 'vr-comment');
    const ta = mk('textarea', 'vr-comment'); ta.id = 'vr-comment'; ta.rows = 3; ta.maxLength = this.MAX_COMMENT; ta.value = draft.comment;
    const count = mk('div', 'vr-count'); count.setAttribute('aria-live', 'polite');
    const paintCount = () => { count.textContent = Array.from(ta.value).length + ' / ' + this.MAX_COMMENT; };
    ta.addEventListener('input', () => { draft.comment = ta.value; paintCount(); error.textContent = ''; });
    paintCount();
    card.append(cl, ta, count);

    const error = mk('p', 'vr-error'); error.setAttribute('role', 'alert');
    card.appendChild(error);

    const close = () => { overlay.remove(); };
    const actions = mk('div', 'vr-actions');
    const btn = (text, ic2, cls, fn) => {
      const b = mk('button', 'vr-btn ' + cls); b.type = 'button';
      if (ic2) { const s = mk('span', 'vr-btn-icon'); s.innerHTML = icon(ic2, 14); b.appendChild(s); }
      b.appendChild(mk('span', '', text));
      b.addEventListener('click', fn);
      return b;
    };
    const save = btn(this.sendReady() ? 'Save and send' : 'Save review', 'check', 'primary', async () => {
      save.disabled = true;
      try {
        const r = await this.submit(draft, { version });
        close();
        let msg = 'Thanks. Your review of Vex ' + version + ' is saved.';
        if (r.xp.gained) msg += ' +' + r.xp.gained + ' XP.';
        if (r.sent.state === 'failed') window.showToast?.(msg + ' It could not be sent: ' + r.sent.error, 'error', 7000);
        else window.showToast?.(msg, 'success', 4000);
      } catch (err) {
        error.textContent = err.message;
        save.disabled = false;
      }
    });
    const later = btn('Not now', 'x', 'secondary', close);
    const never = btn('Never ask again', '', 'quiet', () => {
      try {
        this.savePrefs({ never: true });
        close();
        window.showToast?.('Vex will not ask about versions again. Settings > Version review turns it back on.', 'info', 5000);
      } catch (err) { error.textContent = err.message; }
    });
    actions.append(save, later, never);
    card.appendChild(actions);

    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(); } });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    if (typeof VexFocusTrap !== 'undefined' && typeof VexFocusTrap.adopt === 'function') VexFocusTrap.adopt(card, { label: 'Version review' });
    // Unasked, the card does not grab the keyboard from the update cover under
    // it; asked for, the first star takes it.
    if (focus) card.querySelector('.vr-star')?.focus();
    return overlay;
  },

  // ---- Settings -----------------------------------------------------------------------------
  async _copy(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(text);
  },

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.(err.message, 'error');
    const redraw = () => this.render(body);
    body.appendChild(el('p', 'setting-info', 'When an update is out, and once after you update, Vex asks how the version you ran went: ratings, a few tags and an optional comment. Answering earns a little XP, once per version, and never delays an update. Your reviews stay here unless you turn sending on.'));

    const toggle = (labelText, checked, onChange) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', labelText);
      input.addEventListener('change', async () => {
        try { await onChange(input.checked); }
        catch (err) { input.checked = !input.checked; fail(err); }
        redraw();
      });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', labelText), lab);
      body.appendChild(row);
    };
    const p = this.prefs();
    toggle('Ask me to review each version', p.on && !p.never, (on) => { this.savePrefs(on ? { on: true, never: false } : { never: true }); });

    const sendInfo = el('p', 'setting-info', 'Sending is off unless you set a relay address (https) and agree. Nothing is sent to anyone by default.');
    body.appendChild(sendInfo);
    const urlRow = el('div', 'setting-row');
    const url = document.createElement('input');
    url.type = 'url'; url.className = 'set-input'; url.value = p.relayUrl; url.placeholder = 'https://your-relay.example.workers.dev (empty: keep reviews here)';
    url.setAttribute('aria-label', 'Review relay address');
    url.addEventListener('change', () => {
      try { this.savePrefs({ relayUrl: url.value, send: url.value.trim() ? this.prefs().send : false }); }
      catch (err) { fail(err); url.value = this.prefs().relayUrl; }
      redraw();
    });
    urlRow.append(el('span', '', 'Relay address'), url);
    body.appendChild(urlRow);
    toggle('Send my reviews to that relay', p.send && !!p.relayUrl, async (on) => {
      if (on) { if (!(await this.enableSending())) throw new Error('Sending stays off'); }
      else this.disableSending();
    });
    const idRow = el('div', 'setting-row');
    const reset = el('button', 'btn-secondary', 'Reset my anonymous id'); reset.type = 'button';
    reset.addEventListener('click', () => { try { this.resetInstallId(); window.showToast?.('A new anonymous id will be made the next time a review is sent', 'info', 4000); } catch (err) { fail(err); } });
    idRow.appendChild(reset);
    body.appendChild(idRow);

    const head = el('div', 'setting-row');
    const mine = this.list().slice().reverse();
    head.appendChild(el('span', 'setting-label-text', 'Your reviews (' + mine.length + ')'));
    const act = (text, fn) => { const b = el('button', 'btn-secondary', text); b.type = 'button'; b.addEventListener('click', async () => { try { await fn(); } catch (err) { fail(err); } }); return b; };
    head.append(
      act('Review this version', () => this.openNow()),
      act('Copy all as text', async () => { await this._copy(this.formatText(this.list().slice().reverse())); window.showToast?.('Copied', 'success', 2000); }),
      act('Forget all', async () => { if (await window.vexConfirm({ title: 'Forget all your reviews?', message: 'They are removed from this computer. Anything already sent to a relay stays there.', okLabel: 'Forget all', danger: true })) { this.forgetAll(); redraw(); } }),
    );
    body.appendChild(head);
    if (!mine.length) body.appendChild(el('p', 'setting-info', 'No reviews yet.'));
    for (const r of mine) {
      const card = el('div', 'vr-item');
      const avg = this.average(r);
      card.appendChild(el('div', 'vr-item-head', 'Vex ' + r.version + '  ·  ' + String(r.date || '').slice(0, 10) + (avg ? '  ·  ' + avg.toFixed(1) + ' of 5' : '') + (r.sent ? '  ·  sent' : '')));
      const detail = [];
      for (const c of this.CATEGORIES) if (r.ratings && r.ratings[c.id]) detail.push(c.label + ' ' + r.ratings[c.id]);
      if (detail.length) card.appendChild(el('div', 'vr-item-line', detail.join(', ')));
      if (r.chips && r.chips.length) card.appendChild(el('div', 'vr-item-line', r.chips.map(c => (this.CHIPS.find(x => x.id === c) || { label: c }).label).join(', ')));
      if (r.comment) card.appendChild(el('div', 'vr-item-line', r.comment));
      const row = el('div', 'vr-item-actions');
      row.append(
        act('Copy as text', async () => { await this._copy(this.formatText([r])); window.showToast?.('Copied', 'success', 2000); }),
        act('Forget', async () => { if (await window.vexConfirm({ title: 'Forget this review?', message: 'Your review of Vex ' + r.version + ' is removed from this computer.', okLabel: 'Forget', danger: true })) { this.forget(r.version); redraw(); } }),
      );
      card.appendChild(row);
      body.appendChild(card);
    }
  },

  init() {
    if (this._wired) return;
    this._wired = true;
    if (typeof VexConsent !== 'undefined') VexConsent.register(this.CONSENT_ID, { version: 1, label: 'Send version reviews' });
    // The update cover announces itself here and does not wait for the answer.
    document.addEventListener('vex:update-cover', (e) => {
      const cur = e && e.detail && typeof e.detail.current === 'string' ? e.detail.current : undefined;
      this.maybeOffer({ version: cur, reason: 'update' }).catch(err => VexProblems?.note('Version review', 'Could not offer the review', err));
    });
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key, row) => {
        if (key !== 'open') throw new Error('Unknown version review action ' + key);
        return this.showCard({ version: row && row.sub ? row.sub : undefined, focus: true });
      });
    }
    if (typeof VexSettingsGroups !== 'undefined') {
      VexSettingsGroups.register({ id: 'version-review', title: 'Version review', keywords: 'feedback rate rating review update xp survey', render: (body) => this.render(body) });
    }
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({ id: 'review-version', label: 'Review this version', hint: 'Rate the version of Vex you are running', icon: 'star', action: () => { this.openNow().catch(fail => window.showToast?.(fail.message, 'error')); } });
    }
    // The fallback: the first start after an update, a little after launch.
    if (this.enabled() && !window.VexTabPolicy?.isPrivateWindow) {
      setTimeout(() => this.startupCheck().catch(err => VexProblems?.note('Version review', 'The start-up check failed', err)), 20000);
    }
  },
};

if (typeof window !== 'undefined') window.VersionReview = VersionReview;
if (typeof module !== 'undefined' && module.exports) module.exports = { VersionReview };
