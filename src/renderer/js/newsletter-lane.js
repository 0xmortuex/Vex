// === Newsletter lane (T2-029) ================================================
//
// Newsletters in the mail accounts you already added to Vex, gathered in one lane
// instead of the inbox: by sender, with a one-click "read later" (the message's
// webmail page goes into Read Later), an "Open unsubscribe page" button and a weekly
// digest. A message counts as a newsletter when its sender sends a List-Unsubscribe
// header (read from the mail server, read-only) or when you marked the sender as one.
//
// Read-only, as the whole Mail bridge is (src/main/mail.js: EXAMINE and PEEK):
//   * mail subjects and sender names are read from accounts you chose, only while the
//     lane is open or, if you switched the weekly digest on, once a week;
//   * "Unsubscribe" only OPENS the sender's own https page in a tab: you do the
//     clicking, and Vex sends no mail and no request to it of its own;
//   * the digest is a note on this computer; a weekly nudge goes to the Attention
//     Inbox (never a toast), and is skipped while you are gaming.
const NewsletterLane = {
  STATE_KEY: 'vex.newsletters',
  PREFS_KEY: 'vex.newsletters.prefs',
  WINDOW_DAYS: 7,
  WEEK_MS: 7 * 24 * 3600 * 1000,

  // ---- state --------------------------------------------------------------------
  _read(key, def) { const raw = localStorage.getItem(key); if (raw === null) return def; const v = JSON.parse(raw); return v && typeof v === 'object' ? v : def; },
  prefs() { const p = this._read(this.PREFS_KEY, {}); return { enabled: p.enabled !== false, weekly: p.weekly === true }; },
  _savePrefs(p) { localStorage.setItem(this.PREFS_KEY, JSON.stringify(p)); },
  enabled() { return this.prefs().enabled; },
  setEnabled(on) { this._savePrefs({ ...this.prefs(), enabled: !!on }); this._job(); },
  weekly() { return this.prefs().weekly; },
  setWeekly(on) { this._savePrefs({ ...this.prefs(), weekly: !!on }); this._job(); },
  state() { const s = this._read(this.STATE_KEY, {}); return { followed: s.followed || {}, ignored: s.ignored || {}, lastDigest: Number(s.lastDigest) || 0 }; },
  _saveState(s) { localStorage.setItem(this.STATE_KEY, JSON.stringify(s)); },
  follow(key, name) { const s = this.state(); delete s.ignored[key]; s.followed[key] = { name: String(name || key).slice(0, 80), at: Date.now() }; this._saveState(s); },
  ignore(key) { const s = this.state(); delete s.followed[key]; s.ignored[key] = Date.now(); this._saveState(s); },
  forget(key) { const s = this.state(); delete s.followed[key]; delete s.ignored[key]; this._saveState(s); },

  // ---- pure --------------------------------------------------------------------
  senderKey(m) {
    const from = (m && m.from) || {};
    const addr = String(from.address || '').toLowerCase();
    if (addr) return addr;                       // one sender = one address (a news@ and a deals@ differ)
    return String(from.name || '').toLowerCase() || 'unknown';
  },
  isNewsletter(m, state) {
    const key = this.senderKey(m);
    if (state.ignored[key]) return false;
    return !!(m && m.unsubscribe) || !!state.followed[key];
  },
  // Newsletters of the last `days` days grouped by sender, most first.
  rollup(messages, state, now = Date.now(), days = this.WINDOW_DAYS) {
    const since = now - days * 24 * 3600 * 1000;
    const by = new Map();
    for (const m of messages || []) {
      if (!this.isNewsletter(m, state)) continue;
      if ((m.date || 0) < since) continue;
      const key = this.senderKey(m);
      const at = by.get(key) || { key, name: (m.from && (m.from.name || m.from.address)) || key, count: 0, unread: 0, newest: 0, subjects: [], unsubscribe: '', messages: [] };
      at.count++;
      if (!m.seen) at.unread++;
      if ((m.date || 0) >= at.newest) { at.newest = m.date || 0; if (m.unsubscribe) at.unsubscribe = m.unsubscribe; }
      at.subjects.push(String(m.subject || '(no subject)'));
      at.messages.push(m);
      by.set(key, at);
    }
    for (const s of by.values()) s.messages.sort((a, b) => (b.date || 0) - (a.date || 0));
    return [...by.values()].sort((a, b) => b.count - a.count || b.newest - a.newest);
  },
  digestText(senders, now = Date.now()) {
    const total = senders.reduce((n, s) => n + s.count, 0);
    const day = new Date(now).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = ['Newsletters, week to ' + day + ': ' + total + ' from ' + senders.length + ' sender' + VexPlural.s(senders.length) + '.', ''];
    for (const s of senders) {
      lines.push('## ' + s.name + ' (' + s.count + ')');
      for (const sub of s.subjects.slice(0, 8)) lines.push('- ' + sub);
      lines.push('');
    }
    return lines.join('\n').trim();
  },
  // Only an https page the server's own header named is ever opened.
  safeUnsubscribe(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : '';
  },

  // ---- mail (read-only) ----------------------------------------------------------
  async collect() {
    if (typeof InboxTriage === 'undefined') throw new Error('The mail bridge is not loaded');
    const accounts = await InboxTriage.accounts();
    if (!accounts || !accounts.length) throw new Error('No mail account is set up. Add one in the Mail sheet first.');
    const out = [];
    for (const account of accounts) {
      const box = await InboxTriage.inbox(account.id);
      for (const m of box.messages || []) out.push({ ...m, account });
    }
    return out;
  },

  // ---- actions ---------------------------------------------------------------------
  readLater(m) {
    if (typeof ReadLater === 'undefined') throw new Error('Read Later is not available');
    const url = InboxTriage.webmailMessage(m.account, m);
    if (!url) throw new Error('This account has no webmail page to open');
    if (ReadLater.items.some(i => i.url === url && !i.read)) { window.showToast?.('Already in Read Later'); return; }
    ReadLater.items.unshift({ id: window.vexId ? window.vexId('rl') : 'rl_' + Date.now(), url, title: m.subject || '(no subject)', at: Date.now(), read: false, newsletter: true });
    ReadLater.save();
    window.showToast?.('Saved for later');
  },
  openUnsubscribe(s) {
    const url = this.safeUnsubscribe(s.unsubscribe);
    if (!url) throw new Error('This sender gave no web page to unsubscribe on. Use the webmail search to find its message.');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    TabManager.createTab(url, true);
  },
  saveDigest(senders) {
    if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
    AgentTools.saveNote('Newsletter digest ' + new Date().toISOString().slice(0, 10), this.digestText(senders), undefined, { origin: 'newsletter' });
    const st = this.state(); st.lastDigest = Date.now(); this._saveState(st);
  },

  // ---- the lane -----------------------------------------------------------------------
  async open() {
    const { body, close } = window.PageExport._sheet('Newsletter lane', 'vex-newsletters-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = btn; b.textContent = label; b.addEventListener('click', async () => { try { await fn(); } catch (err) { say(err.message || String(err)); } }); return b; };
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'padding:8px 14px;font-size:11.5px;color:var(--text-muted)';
    const say = (m) => { status.textContent = m; };
    const list = document.createElement('div');
    list.style.cssText = 'padding:0 14px 10px';
    body.append(list, status);
    say('Reading the newest messages from your accounts (read-only)…');
    let all;
    try { all = await this.collect(); } catch (err) { say(err.message || String(err)); return close; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('newsletter-lane');
    const draw = () => {
      list.textContent = '';
      const senders = this.rollup(all, this.state());
      say(senders.length ? this.digestText(senders).split('\n')[0] : 'No newsletters in the last week.');
      if (senders.length) {
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;gap:8px;padding:8px 0';
        top.append(mk('Save weekly digest as a note', () => { this.saveDigest(senders); say('Digest saved to Notes.'); }));
        list.append(top);
      }
      for (const s of senders) {
        const box = document.createElement('div');
        box.style.cssText = 'border-top:1px solid var(--border);padding:8px 0';
        const h = document.createElement('div');
        h.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
        const name = document.createElement('strong'); name.style.cssText = 'flex:1;font-size:12.5px;color:var(--text)'; name.textContent = s.name + '  ' + s.count + (s.unread ? ' (' + s.unread + ' unread)' : '');
        h.append(name,
          mk('Open unsubscribe page', async () => this.openUnsubscribe(s)),
          mk('Not a newsletter', () => { this.ignore(s.key); draw(); }));
        box.append(h);
        for (const m of s.messages.slice(0, 5)) {
          const r = document.createElement('div');
          r.style.cssText = 'display:flex;gap:8px;align-items:center;margin:3px 0';
          const t = document.createElement('span'); t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text)'; t.textContent = m.subject || '(no subject)';
          r.append(t, mk('Read later', async () => this.readLater(m)));
          box.append(r);
        }
        list.append(box);
      }
      // Senders that look like newsletters by their subject but sent no unsubscribe header.
      const st = this.state();
      const maybe = [];
      const seen = new Set();
      for (const m of all) {
        const key = this.senderKey(m);
        if (seen.has(key) || st.followed[key] || st.ignored[key] || m.unsubscribe) continue;
        if (typeof InboxTriage !== 'undefined' && InboxTriage.classify(m).pile === 'bulk') { seen.add(key); maybe.push(m); }
      }
      if (maybe.length) {
        const more = document.createElement('div');
        more.style.cssText = 'border-top:1px solid var(--border);padding:8px 0';
        const t = document.createElement('div'); t.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-bottom:4px'; t.textContent = 'Bulk senders without an unsubscribe header. Add the ones that are newsletters:';
        more.append(t);
        for (const m of maybe.slice(0, 12)) {
          const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;align-items:center;margin:3px 0';
          const n = document.createElement('span'); n.style.cssText = 'flex:1;font-size:12px;color:var(--text)'; n.textContent = (m.from && (m.from.name || m.from.address)) || 'unknown';
          r.append(n, mk('Add to the lane', () => { this.follow(this.senderKey(m), (m.from && m.from.name) || ''); draw(); }));
          more.append(r);
        }
        list.append(more);
      }
    };
    draw();
    return close;
  },

  // ---- the weekly nudge (opt-in) ---------------------------------------------------------
  async weeklyCheck(now = Date.now()) {
    if (!this.enabled() || !this.weekly()) return null;
    const st = this.state();
    if (now - st.lastDigest < this.WEEK_MS) return null;
    const senders = this.rollup(await this.collect(), st, now);
    st.lastDigest = now;
    this._saveState(st);
    if (!senders.length || typeof VexAttention === 'undefined') return null;
    const total = senders.reduce((n, s) => n + s.count, 0);
    return VexAttention.suggest({ feature: 'newsletter-lane', id: 'week-' + new Date(now).toISOString().slice(0, 10), title: total + ' newsletters this week from ' + senders.length + ' senders', body: 'Open the Newsletter lane to read them later or unsubscribe.', action: { label: 'Open', key: 'newsletter-lane' } });
  },
  _job() {
    if (typeof VexJobs === 'undefined') return;
    if (this.enabled() && this.weekly()) {
      if (!this._jobHandle) this._jobHandle = VexJobs.every('Newsletter lane', 6 * 3600 * 1000, () => this.weeklyCheck().catch(err => window.VexProblems?.note('Newsletter lane', 'Could not check this week', err)), { when: 'background', feature: 'newsletter-lane' });
    } else if (this._jobHandle) { this._jobHandle.stop(); this._jobHandle = null; }
  },
  start() {
    this._job();
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('newsletter-lane', () => this.open());
  },
};

if (typeof window !== 'undefined') window.NewsletterLane = NewsletterLane;
if (typeof module !== 'undefined' && module.exports) module.exports = { NewsletterLane };
