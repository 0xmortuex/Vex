// === Autopilot: one stream of what needs you ================================
//
// Mail, GitHub events, reminders, watched pages and releases are five lists in
// five places. This is one: ranked by what wants you (js/autopilot-rank.js),
// grouped "needs you now", "today" and "FYI", and every row has the few things
// Vex can really do about it from here:
//
//   Open       the message in its webmail, the run, the page
//   Snooze     hide it until this evening or tomorrow morning
//   Done       hide it IN VEX. Nothing is changed anywhere else.
//   Remind me  a Vex reminder, with the link
//   Draft      a reply written by the LOCAL model for you to edit. Never sent.
//
// The one decision this keeps: Vex's mail is READ-ONLY (src/main/mail.js opens
// the mailbox with EXAMINE and reads with PEEK). There is no archive, delete or
// send on the server, and "Done" says plainly that it hides the row in Vex.
//
// Sources are read the way their own panels read them: mail through the same
// read-only bridge as the Inbox sorter (off until the person turns it on),
// GitHub through the events GitHubWatch already announces, reminders through
// the reminder service, watched pages and release radar through PageWatch.
// Nothing new is fetched from the network.
//
// Other branches (snooze-anything, mail triage) are not merged yet, so each is
// used only when it is there (typeof guards) and Autopilot works without it.
const VexAutopilot = {
  KEY: 'vex.autopilot',
  MAX_EVENTS: 60,
  MAIL_CACHE_MS: 5 * 60000,
  KEEP_MS: 60 * 86400000,
  _mail: null,           // { at, items, bulk, error }

  // ---- stored state ----------------------------------------------------------
  _blank() { return { v: 1, prefs: { mail: false }, done: {}, snoozed: {}, opened: {}, events: [], model: AutopilotRank.newModel() }; },
  state() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    const s = this._blank();
    if (!raw || typeof raw !== 'object') return s;
    const map = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    s.prefs = { mail: raw.prefs && raw.prefs.mail === true };
    s.done = map(raw.done); s.snoozed = map(raw.snoozed); s.opened = map(raw.opened);
    s.events = Array.isArray(raw.events) ? raw.events.filter(e => e && typeof e.id === 'string').slice(0, this.MAX_EVENTS) : [];
    s.model = raw.model && raw.model.keys ? raw.model : AutopilotRank.newModel();
    return s;
  },
  _save(s) {
    const cut = Date.now() - this.KEEP_MS;
    for (const field of ['done', 'opened']) for (const [k, at] of Object.entries(s[field])) if (!(at > cut)) delete s[field][k];
    for (const [k, until] of Object.entries(s.snoozed)) if (!(until > cut)) delete s.snoozed[k];
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); return true; }
    catch (err) { window.VexProblems?.note('Autopilot', 'Could not save what you dealt with', err); return false; }
  },
  setMail(on) {
    const s = this.state();
    s.prefs.mail = !!on;
    this._mail = null;
    this._save(s);
  },
  forgetLearning() { const s = this.state(); s.model = AutopilotRank.newModel(); this._save(s); },

  // ---- GitHub events: announced once, so kept here ---------------------------
  recordGitHub(detail, now = Date.now()) {
    if (!detail || !detail.text) return null;
    const text = String(detail.text).slice(0, 200);
    const s = this.state();
    if (s.events.some(e => e.text === text && now - e.at < 6 * 3600000)) return null;
    const e = { id: 'gh:' + this._hash(text) + ':' + Math.floor(now / 60000), kind: 'github', text, at: now, url: /^https?:\/\//i.test(String(detail.url || '')) ? String(detail.url) : '' };
    s.events.unshift(e);
    s.events = s.events.slice(0, this.MAX_EVENTS);
    this._save(s);
    return e;
  },
  _hash(text) { let h = 5381; for (const c of String(text)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); },

  // ---- sources ----------------------------------------------------------------
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  collectGitHub(s, now) {
    const out = [];
    for (const e of s.events) {
      if (now - e.at > 14 * 86400000) continue;
      const repo = (/\b([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)\b/.exec(e.text) || [])[1] || '';
      out.push({
        id: e.id, kind: 'github', title: e.text, sub: repo || 'GitHub', ts: e.at, url: e.url,
        keys: repo ? ['repo:' + repo.toLowerCase()] : [],
        flags: { failed: /\b(failed|timed out)\b/i.test(e.text), release: /\bnew release\b/i.test(e.text) },
      });
    }
    return out;
  },

  async collectReminders(now) {
    const api = window.vex && window.vex.reminders;
    if (!api || typeof api.list !== 'function') return [];
    const list = await api.list();
    const out = [];
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || (r.kind && r.kind !== 'reminder' && r.kind !== 'review') || r.ackedAt) continue;
      const fired = !!r.firedAt && (!r.repeat || r.firedAt > (r.lastFiredAt || 0) - 1);
      const soon = r.at && r.at - now <= 36 * 3600000;
      if (!fired && !soon) continue;
      out.push({
        id: 'rem:' + r.id + ':' + (r.firedAt || r.at || 0), kind: 'reminder', title: String(r.message || 'Reminder'),
        sub: fired ? 'went off ' + this._ago(now - r.firedAt) : 'reminder, ' + this._when(r.at, now),
        ts: r.firedAt || r.at || now, dueAt: r.at || null, url: r.url || '', keys: [],
        flags: { fired }, ref: { reminderId: r.id },
      });
    }
    return out;
  },

  collectWatches(now) {
    if (typeof PageWatch === 'undefined' || typeof PageWatch.list !== 'function') return [];
    const out = [];
    for (const w of PageWatch.list()) {
      if (!PageWatch.isUnseen(w)) continue;
      const radar = w.source === 'radar:patch-notes';
      const host = this._host(w.url);
      out.push({
        id: (radar ? 'rel:' : 'watch:') + w.id + ':' + w.lastChangedAt, kind: radar ? 'release' : 'watch',
        title: String(w.title || w.url), sub: radar ? 'new patch notes' : (host ? host + ' changed' : 'page changed'),
        ts: w.lastChangedAt, url: w.url, keys: host ? ['host:' + host] : [],
        flags: { changed: true, hit: w.kind === 'number' && w.target != null }, ref: { watchId: w.id },
      });
    }
    return out;
  },

  // Mail: headers only, through the read-only bridge, and only once the person
  // turned it on. Bulk is left out of the stream and only counted.
  async collectMail(s, now, force) {
    if (!s.prefs.mail || !(window.vex && window.vex.mail) || typeof InboxTriage === 'undefined') return { items: [], bulk: 0 };
    if (!force && this._mail && now - this._mail.at < this.MAIL_CACHE_MS) return this._mail;
    const call = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer'); return r.value; };
    const accounts = (await call(window.vex.mail.accounts())).slice(0, 3);
    const items = [];
    let bulk = 0;
    const failed = [];
    for (const account of accounts) {
      let inbox;
      try { inbox = await call(window.vex.mail.inbox(account.id, 50)); }
      catch (err) { failed.push((account.email || account.name || 'account') + ': ' + err.message); continue; }
      for (const m of inbox.messages || []) {
        if (m.seen && !m.flagged) continue;
        const { pile, why } = InboxTriage.classify(m);
        if (pile === 'bulk') { bulk++; continue; }
        const address = String((m.from || {}).address || '').toLowerCase();
        const domain = InboxTriage.domain(address);
        items.push({
          id: 'mail:' + account.id + ':' + (m.uid || m.messageId), kind: 'mail',
          title: String(m.subject || '(no subject)'), sub: String((m.from || {}).name || address || 'Someone'),
          ts: m.date || now, url: InboxTriage.webmailMessage(account, m) || '',
          keys: [address ? 'sender:' + address : '', domain ? 'domain:' + domain : ''].filter(Boolean),
          flags: { needs: pile === 'needs', flagged: !!m.flagged }, mailWhy: why,
          ref: { accountId: account.id, uid: m.uid, message: { uid: m.uid, messageId: m.messageId, subject: m.subject, from: m.from, date: m.date, seen: m.seen, flagged: m.flagged }, address, webmail: !!account.webmail },
        });
      }
    }
    this._mail = { at: now, items, bulk, error: failed.length ? failed.join('; ') : '' };
    return this._mail;
  },

  // Everything, ranked. problems: sources that could not be read, said not hidden.
  async stream({ now = Date.now(), force = false } = {}) {
    const s = this.state();
    const problems = [];
    let items = [];
    items = items.concat(this.collectGitHub(s, now));
    try { items = items.concat(await this.collectReminders(now)); } catch (err) { problems.push('Reminders: ' + err.message); }
    try { items = items.concat(this.collectWatches(now)); } catch (err) { problems.push('Watched pages: ' + err.message); }
    let bulk = 0;
    try {
      const m = await this.collectMail(s, now, force);
      items = items.concat(m.items);
      bulk = m.bulk || 0;
      if (m.error) problems.push('Mail: ' + m.error);
    } catch (err) { problems.push('Mail: ' + err.message); }
    const groups = AutopilotRank.rank(items, {
      now, model: s.model,
      hidden: (it) => !!s.done[it.id] || (s.snoozed[it.id] && s.snoozed[it.id] > now),
    });
    // The seen and snoozed rows are counted, never silently lost.
    groups.snoozed = Object.values(s.snoozed).filter(u => u > now).length;
    groups.bulk = bulk;
    groups.problems = problems;
    groups.mailOn = s.prefs.mail;
    return groups;
  },

  // ---- doing something about a row -------------------------------------------
  _learn(item, event) {
    const s = this.state();
    s.model = AutopilotRank.learn(s.model, item.keys || [], event);
    this._save(s);
  },
  open(item) {
    if (!item.url) throw new Error('This one has no page to open');
    const s = this.state();
    s.opened[item.id] = Date.now();
    s.model = AutopilotRank.learn(s.model, item.keys || [], 'open');
    this._save(s);
    if (typeof TabManager !== 'undefined' && typeof TabManager.createTab === 'function') TabManager.createTab(item.url, true);
    else throw new Error('Tabs are not available here');
  },
  // Hide it in Vex, and say where else Vex agrees: the page watch is marked
  // seen, a fired reminder acknowledged. The mail server is never touched.
  async done(item) {
    const s = this.state();
    const opened = !!s.opened[item.id];
    s.done[item.id] = Date.now();
    s.model = AutopilotRank.learn(s.model, item.keys || [], opened ? 'act' : 'dismiss');
    this._save(s);
    const ref = item.ref || {};
    if (item.kind === 'mail' && typeof MailTriage !== 'undefined' && typeof MailTriage.done === 'function' && ref.accountId) {
      try { MailTriage.done(ref.accountId, ref.message); } catch (err) { window.VexProblems?.note('Autopilot', 'Mail triage did not take the Done', err); }
    }
    if ((item.kind === 'watch' || item.kind === 'release') && ref.watchId && typeof PageWatch !== 'undefined') PageWatch.markSeen(ref.watchId);
    if (item.kind === 'reminder' && ref.reminderId && window.vex && window.vex.reminders && typeof window.vex.reminders.ack === 'function') {
      await window.vex.reminders.ack(ref.reminderId);
    }
  },
  undoDone(item) { const s = this.state(); delete s.done[item.id]; this._save(s); },
  // when: 'hour' | 'evening' | 'tomorrow'. → the time it comes back.
  snoozeUntil(when, now = Date.now()) {
    const d = new Date(now);
    if (when === 'hour') return now + 3600000;
    if (when === 'evening') { d.setHours(18, 0, 0, 0); if (d.getTime() <= now + 15 * 60000) d.setDate(d.getDate() + 1); return d.getTime(); }
    if (when === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); }
    throw new Error('Snooze for an hour, this evening or tomorrow morning');
  },
  snooze(item, when, now = Date.now()) {
    const at = this.snoozeUntil(when, now);
    const s = this.state();
    s.snoozed[item.id] = at;
    this._save(s);
    // The snooze list of the Morning Brief, where it is there (not merged yet).
    if (typeof VexSnooze !== 'undefined' && typeof VexSnooze.add === 'function') {
      try {
        if (item.kind === 'mail' && item.ref) VexSnooze.add('mail', { title: item.title, url: item.url, ref: (typeof MailTriage !== 'undefined' && MailTriage.keyOf) ? MailTriage.keyOf(item.ref.accountId, item.ref.message) : item.id }, at, now);
        else if (item.url) VexSnooze.add('page', { title: item.title, url: item.url, ref: item.url }, at, now);
      } catch (err) { window.VexProblems?.note('Autopilot', 'The brief\'s snooze list did not take it', err); }
    }
    return at;
  },
  async remind(item, when = 'tomorrow', now = Date.now()) {
    const api = window.vex && window.vex.reminders;
    if (!api || typeof api.create !== 'function') throw new Error('Reminders are not available here');
    const at = this.snoozeUntil(when, now);
    const extra = /^https?:\/\//i.test(item.url || '') ? { url: item.url } : {};
    const r = await api.create(item.title, at, extra);
    if (r && r.ok === false) throw new Error(r.error || 'The reminder could not be made');
    this._learn(item, 'act');
    return at;
  },

  // A reply written by the local model for the person to edit. It is never
  // sent: the result is text in a box, to copy or hand to a mail program.
  buildPrompt(msg) {
    const text = String(msg.text || '').replace(/\r/g, '').trim().slice(0, 4000);
    return 'Write a short reply to this email, 2 to 5 sentences, in plain words, in the language of the email. '
      + 'Do not invent facts, dates or commitments; where the sender needs an answer you cannot know, say you will get back to them. '
      + 'No subject line and no signature name.\n\n'
      + 'From: ' + String(msg.from || '') + '\nSubject: ' + String(msg.subject || '') + '\n\n' + text;
  },
  plainReply(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (s.startsWith('{')) {
      try { const o = JSON.parse(s); s = String(o.reply || o.text || o.message || o.draft || '').trim(); } catch { /* prose that starts with a brace */ }
    }
    return s.slice(0, 4000);
  },
  async draft(item) {
    if (item.kind !== 'mail' || !item.ref) throw new Error('A reply can only be drafted for a message');
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI is not loaded');
    if (!window.vex || !window.vex.mail) throw new Error('Mail is not available here');
    const r = await window.vex.mail.message(item.ref.accountId, item.ref.uid);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The message could not be read');
    const msg = r.value;
    if (msg.tooLarge) throw new Error('This message is too large to draft a reply from');
    const text = msg.text || (typeof VexMail !== 'undefined' && VexMail.htmlToText ? VexMail.htmlToText(msg.html) : '');
    if (!String(text).trim()) throw new Error('This message has no text to answer');
    // 'local' is one named backend: no routing, and no falling back to a cloud model.
    const res = await AIRouter.callOn('local', 'chat', {
      message: this.buildPrompt({ ...msg, text }),
      persona: { systemPrompt: 'You draft short email replies for the user to edit and send themselves. Write only the body of the reply. Never invent facts. Answer as JSON: {"reply": "the reply text"}', temperature: 0.4 },
    });
    const reply = this.plainReply(res && (res.result || res.text || res.message));
    if (!reply) throw new Error('The local AI returned nothing');
    this._learn(item, 'act');
    return { reply, subject: /^\s*re\s*:/i.test(msg.subject || '') ? msg.subject : 'Re: ' + (msg.subject || ''), to: item.ref.address || '' };
  },

  // ---- wording -----------------------------------------------------------------
  _ago(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 2) return 'just now';
    if (m < 90) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 36) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  },
  _when(at, now) {
    if (!at) return '';
    const d = new Date(at);
    const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (at < now) return 'was ' + hm;
    return d.toDateString() === new Date(now).toDateString() ? 'today ' + hm : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hm;
  },

  // ---- the Morning Brief section ----------------------------------------------
  // build() answers display data only (js/brief.js): the top of the stream.
  async briefPayload(now = Date.now()) {
    const g = await this.stream({ now });
    const top = g.now.concat(g.today).slice(0, 5);
    const items = top.map(i => ({
      text: i.title, sub: i.sub + (i.why && i.why.length ? ' · ' + i.why[0] : ''), url: i.url || '',
      badge: i.tier === 'now' ? 'Now' : '', when: this._ago(now - (i.ts || now)),
    }));
    return {
      summary: AutopilotRank.summary(g),
      items,
      note: g.mailOn ? '' : 'Mail is not included. Turn it on in Autopilot to rank your unread mail too.',
      action: { label: 'Open Autopilot', cmd: { type: 'autopilot-open' } },
    };
  },
  registerWithBrief() {
    if (typeof VexBrief === 'undefined' || typeof VexBrief.register !== 'function' || this._briefRegistered) return false;
    const me = this;
    VexBrief.register({
      id: 'autopilot', title: 'Needs you', icon: 'sparkles', order: 5, defaultOn: true, ttlMs: 60000, maxItems: 5,
      build(ctx) { return me.briefPayload(ctx && ctx.now); },
    });
    this._briefRegistered = true;
    return true;
  },

  // ---- the panel -----------------------------------------------------------------
  _css() {
    if (document.getElementById('vex-autopilot-style')) return;
    const st = document.createElement('style');
    st.id = 'vex-autopilot-style';
    st.textContent = `
.vex-autopilot-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);display:grid;place-items:start center;padding-top:7vh}
.vex-autopilot{width:min(700px,94vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,.45));overflow:hidden;color:var(--text)}
.vex-autopilot header{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px}
.vex-autopilot header .ap-title{font-size:13.5px;font-weight:650}
.vex-autopilot header .ap-sum{font-size:11px;color:var(--text-muted)}
.vex-autopilot .ap-body{overflow-y:auto;padding:6px;flex:1}
.vex-autopilot .ap-group{padding:10px 9px 3px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}
.vex-autopilot .ap-row{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px}
.vex-autopilot .ap-row:hover,.vex-autopilot .ap-row:focus-within{background:var(--vex-hover-fill,var(--surface))}
.vex-autopilot .ap-kind{flex:0 0 auto;width:20px;height:20px;color:var(--text-muted);display:grid;place-items:center}
.vex-autopilot .ap-main{flex:1;min-width:0}
.vex-autopilot .ap-t{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vex-autopilot .ap-s{font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vex-autopilot .ap-acts{display:flex;gap:2px;flex:0 0 auto}
.vex-autopilot .ap-acts button,.vex-autopilot .ap-btn{background:none;border:1px solid transparent;border-radius:6px;padding:4px 6px;color:var(--text-muted);cursor:pointer;font:inherit;font-size:11.5px;display:inline-flex;align-items:center;gap:4px}
.vex-autopilot .ap-acts button:hover,.vex-autopilot .ap-btn:hover{color:var(--text);border-color:var(--border)}
.vex-autopilot .ap-acts button:disabled{opacity:.35;cursor:default}
.vex-autopilot .ap-menu{position:absolute;z-index:2;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:4px;box-shadow:0 8px 24px var(--vex-shadow-color,rgba(0,0,0,.4))}
.vex-autopilot .ap-menu button{display:block;width:100%;text-align:left;white-space:nowrap}
.vex-autopilot .ap-draft{margin:4px 9px 8px 38px;padding:8px;border:1px solid var(--border);border-radius:8px}
.vex-autopilot .ap-draft textarea{width:100%;min-height:110px;box-sizing:border-box;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px;font:inherit;font-size:12px}
.vex-autopilot footer{padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)}
.vex-autopilot .ap-problem{margin:6px 9px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:11.5px;color:var(--text-muted)}
.vex-autopilot .ap-empty{padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)}`;
    document.head.appendChild(st);
  },
  _icon(name, size = 14) { return (typeof VexIcons !== 'undefined' && VexIcons.svg) ? VexIcons.svg(name, { size }) : ''; },
  KIND_ICON: { mail: 'mail', github: 'git', reminder: 'bell', watch: 'eye', release: 'rocket' },

  _row(item, esc) {
    const why = item.why && item.why.length ? ' · ' + item.why.slice(0, 2).join(', ') : '';
    const canOpen = !!item.url;
    const mailOnly = item.kind === 'mail' ? `<button data-act="draft" title="Draft a reply with the local AI (never sent)" aria-label="Draft a reply">${this._icon('edit')}</button>` : '';
    return `
      <div class="ap-row" data-id="${esc(item.id)}" role="group" aria-label="${esc(item.title)}">
        <span class="ap-kind" aria-hidden="true">${this._icon(this.KIND_ICON[item.kind] || 'sparkles')}</span>
        <div class="ap-main">
          <div class="ap-t">${esc(item.title)}</div>
          <div class="ap-s">${esc(item.sub)}${esc(why)}</div>
        </div>
        <div class="ap-acts">
          <button data-act="open" ${canOpen ? '' : 'disabled'} title="${canOpen ? 'Open' : 'Nothing to open for this one'}" aria-label="Open">${this._icon('external')}</button>
          <button data-act="snooze" title="Snooze" aria-label="Snooze" aria-haspopup="menu">${this._icon('clock')}</button>
          <button data-act="remind" title="Remind me tomorrow morning" aria-label="Remind me">${this._icon('bell')}</button>
          ${mailOnly}
          <button data-act="done" title="Done: hides it in Vex. Nothing is changed anywhere else." aria-label="Done, hide in Vex">${this._icon('check')}</button>
        </div>
      </div>`;
  },

  // The panel itself. Named showPanel because open(item) opens a row.
  async showPanel() {
    this._css();
    document.querySelector('.vex-autopilot-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-autopilot-overlay';
    overlay.innerHTML = `
      <div class="vex-autopilot" role="dialog" aria-modal="true" aria-label="Autopilot">
        <header>
          <div style="flex:1;min-width:0"><div class="ap-title">Autopilot</div><div class="ap-sum" data-sum>Looking…</div></div>
          <label class="ap-btn" title="Include your unread mail. Vex reads only the sender and subject, read-only." style="cursor:pointer"><input type="checkbox" data-mail> Mail</label>
          <button class="ap-btn" data-refresh aria-label="Refresh">${this._icon('refresh')}</button>
          <button class="ap-btn" data-close aria-label="Close">${this._icon('x')}</button>
        </header>
        <div class="ap-body" data-body></div>
        <footer data-foot>Done hides an item inside Vex only. Vex's mail access is read-only, so nothing is archived, deleted or sent on your mail server.</footer>
      </div>`;
    const bodyEl = overlay.querySelector('[data-body]');
    const sumEl = overlay.querySelector('[data-sum]');
    const mailBox = overlay.querySelector('[data-mail]');
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    mailBox.checked = this.state().prefs.mail;

    let items = new Map();
    const render = async (force) => {
      sumEl.textContent = 'Looking…';
      let g;
      try { g = await this.stream({ force }); }
      catch (err) { sumEl.textContent = err.message; return; }
      items = new Map();
      for (const k of ['now', 'today', 'fyi']) for (const it of g[k]) items.set(it.id, it);
      sumEl.textContent = AutopilotRank.summary(g);
      const section = (title, list) => list.length ? `<div class="ap-group">${esc(title)}</div>${list.map(i => this._row(i, esc)).join('')}` : '';
      const problems = g.problems.map(p => `<div class="ap-problem">${esc(p)}</div>`).join('');
      const notes = [];
      if (g.bulk) notes.push(`${g.bulk} bulk message${g.bulk === 1 ? ' is' : 's are'} left out; the inbox sorter groups them by sender.`);
      if (g.snoozed) notes.push(`${g.snoozed} snoozed, back later.`);
      if (!g.mailOn) notes.push('Mail is not included. Tick Mail to rank your unread mail too.');
      const any = g.now.length + g.today.length + g.fyi.length;
      bodyEl.innerHTML = problems
        + (any ? section('Needs you now', g.now) + section('Today', g.today) + section('FYI', g.fyi) : `<div class="ap-empty">Nothing is waiting on you.</div>`)
        + (notes.length ? `<div class="ap-problem">${notes.map(esc).join(' ')}</div>` : '');
    };

    mailBox.addEventListener('change', async () => { this.setMail(mailBox.checked); await render(true); });
    overlay.querySelector('[data-refresh]').addEventListener('click', () => render(true));

    // One listener for every row's buttons.
    bodyEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      const item = row && items.get(row.dataset.id);
      if (!item) return;
      const act = btn.dataset.act;
      try {
        if (act === 'open') { this.open(item); return; }
        if (act === 'done') {
          await this.done(item);
          row.remove();
          this._offerUndo(item, () => render(false));
          return;
        }
        if (act === 'remind') { await this.remind(item, 'tomorrow'); window.showToast?.('Vex will remind you tomorrow morning'); return; }
        if (act === 'snooze') { this._snoozeMenu(btn, item, () => render(false)); return; }
        if (act === 'draft') { await this._draftBox(row, item, btn, esc); return; }
      } catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
    });

    await render(false);
    return overlay;
  },

  // Hiding a mail or a GitHub event is all Done does, so it can be put back
  // exactly. A watched page marked seen or a reminder acknowledged is a change
  // in its own list, said plainly instead of offering an Undo that would lie.
  _offerUndo(item, after) {
    const hidesOnly = item.kind === 'mail' || item.kind === 'github';
    if (hidesOnly && typeof VexUndo !== 'undefined' && typeof VexUndo.offer === 'function') {
      VexUndo.offer({
        message: 'Hidden in Vex. The original is unchanged.',
        undo: () => {
          this.undoDone(item);
          if (item.kind === 'mail' && typeof MailTriage !== 'undefined' && typeof MailTriage.clear === 'function' && item.ref) MailTriage.clear(item.ref.accountId, item.ref.message);
          return after();
        },
      });
    } else {
      window.showToast?.(item.kind === 'reminder' ? 'Reminder acknowledged.' : 'Marked as seen.', 'info', 3000);
    }
    document.dispatchEvent(new CustomEvent('vex:autopilot-done', { detail: { id: item.id } }));
  },

  _snoozeMenu(anchor, item, after) {
    document.querySelector('.vex-autopilot .ap-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'ap-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = [['hour', 'In an hour'], ['evening', 'This evening'], ['tomorrow', 'Tomorrow morning']]
      .map(([k, label]) => `<button class="ap-btn" role="menuitem" data-when="${k}">${label}</button>`).join('');
    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(menu);
    menu.style.right = '0'; menu.style.top = '100%';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-when]');
      if (!b) return;
      try {
        this.snooze(item, b.dataset.when);
        window.showToast?.('Snoozed. It comes back then.');
        menu.remove();
        after();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    const away = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', away, true); } };
    setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    menu.querySelector('button').focus();
  },

  async _draftBox(row, item, btn, esc) {
    row.nextElementSibling?.classList?.contains('ap-draft') && row.nextElementSibling.remove();
    btn.disabled = true;
    const holder = document.createElement('div');
    holder.className = 'ap-draft';
    holder.innerHTML = '<div class="ap-s">Writing a draft with the AI on this computer…</div>';
    row.after(holder);
    let d;
    try { d = await this.draft(item); }
    catch (err) { holder.remove(); btn.disabled = false; throw err; }
    btn.disabled = false;
    holder.innerHTML = `
      <div class="ap-s" style="margin-bottom:4px">Draft for you to edit. Vex never sends it.</div>
      <textarea aria-label="Draft reply">${esc(d.reply)}</textarea>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="ap-btn" data-copy>${this._icon('copy')} Copy</button>
        <button class="ap-btn" data-compose>${this._icon('mail')} Open in my mail program</button>
        <button class="ap-btn" data-discard>${this._icon('x')} Discard</button>
      </div>`;
    const ta = holder.querySelector('textarea');
    holder.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); window.showToast?.('Reply copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    holder.querySelector('[data-compose]').addEventListener('click', async () => {
      try {
        if (typeof window.vex.composeMail !== 'function') throw new Error('Handing a draft to a mail program is not available here');
        const r = await window.vex.composeMail(d.subject, ta.value);
        if (r && r.ok === false) throw new Error(r.error || 'The mail program did not open');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    holder.querySelector('[data-discard]').addEventListener('click', () => holder.remove());
  },
};

if (typeof document !== 'undefined') {
  // GitHub watch events are announced once; Autopilot keeps them.
  document.addEventListener('vex:github-watch', (e) => {
    try { VexAutopilot.recordGitHub(e.detail); }
    catch (err) { window.VexProblems?.note('Autopilot', 'Could not keep a GitHub event', err); }
  });
  // Opened from a brief item or anywhere that cannot reach the object.
  document.addEventListener('vex:autopilot-open', () => { VexAutopilot.showPanel().catch(err => window.showToast?.(err.message, 'error')); });
}
if (typeof window !== 'undefined') {
  window.VexAutopilot = VexAutopilot;
  try { VexAutopilot.registerWithBrief(); } catch (err) { window.VexProblems?.note('Autopilot', 'Could not join the Morning Brief', err); }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAutopilot };
