// === Meeting links and the join strip (T3-047) ===================================
//
// "Where was the link?" is asked at five to nine, in three places: the calendar
// invitation, a mail, a Discord message. This gathers the call links from the
// places Vex ALREADY holds, and five minutes before a meeting shows one thin
// strip with a "Join in browser" button.
//
// What it reads, and only when it is used:
//   - your subscribed calendars and reminders (MeetingPrep reads them already);
//   - the kept panel notifications (js/panel-capture.js), when that is on;
//   - mail, only when you press "Look in my recent mail": the newest messages of
//     the accounts you added, read-only through the mail client you already use;
//   - links you paste, with a time if you give one.
//
// What it never does: it never opens a link by itself. The strip only offers; the
// tab opens when YOU press Join, so a call is never joined for you and no one sees
// you arrive uninvited. Nothing is posted, replied to or sent.
const MeetingLinks = {
  KEY: 'vex.meetingLinks',
  MAX_LINKS: 30,
  LEAD_CHOICES: [2, 5, 10],
  GRACE_MS: 10 * 60000,
  EVERY_MS: 30 * 1000,
  MAIL_ACCOUNT_LIMIT: 3,
  MAIL_MESSAGES: 12,
  // Video-call hosts. A Discord invite or event is a join link; a plain channel link is not guessed to be one.
  HOSTS: /(^|\.)(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si|around\.co|discord\.gg|app\.slack\.com)$/i,

  _now() { return Date.now(); },

  // ---- state ----------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, lead: 5, links: [], dismissed: {} }, 'meeting links');
    return {
      on: s.on !== false,
      lead: this.LEAD_CHOICES.includes(s.lead) ? s.lead : 5,
      links: Array.isArray(s.links) ? s.links.filter(l => l && typeof l.url === 'string' && typeof l.id === 'string') : [],
      dismissed: s.dismissed && typeof s.dismissed === 'object' && !Array.isArray(s.dismissed) ? s.dismissed : {},
    };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:meeting-links'); },
  enabled() { return this.state().on; },
  setEnabled(on) {
    const s = this.state(); s.on = !!on; this._save(s);
    if (on) this.start(); else this.stop();
  },
  lead() { return this.state().lead; },
  setLead(n) {
    if (!this.LEAD_CHOICES.includes(n)) throw new Error('The strip shows ' + this.LEAD_CHOICES.join(', ') + ' minutes before');
    const s = this.state(); s.lead = n; this._save(s);
  },

  // ---- pure: finding call links ------------------------------------------------------------
  isCallLink(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (/(^|\.)discord\.com$/i.test(u.hostname)) return /^\/events\//.test(u.pathname);
    if (/(^|\.)discord\.gg$/i.test(u.hostname)) return true;
    if (/^app\.slack\.com$/i.test(u.hostname)) return /\/huddle\//.test(u.pathname);
    return this.HOSTS.test(u.hostname);
  },
  callLinks(text) { return CommsStore.links(text, 20).filter(u => this.isCallLink(u)); },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  // ---- gathering -------------------------------------------------------------------------------------
  // The links in the kept panel notifications. -> [{ url, from, text, ts }]
  fromNotifications() {
    if (typeof PanelCapture === 'undefined' || !PanelCapture.enabled()) return [];
    const out = [];
    for (const n of PanelCapture.list({ includeMuted: true })) {
      for (const url of this.callLinks(n.title + ' ' + n.body)) out.push({ url, from: PanelCapture.label(n.source), text: CommsStore.line(n.title + (n.body ? ': ' + n.body : ''), 140), ts: n.ts });
    }
    return out;
  },

  // Recent mail, on request only. -> { found: [{ url, from, text, ts }], read: n }
  async fromMail() {
    if (typeof VexMail === 'undefined' || !window.vex || !window.vex.mail) throw new Error('Mail is not available here');
    const accounts = await VexMail.accounts();
    if (!Array.isArray(accounts) || !accounts.length) throw new Error('No mail account has been added');
    const found = [];
    let read = 0;
    for (const a of accounts.slice(0, this.MAIL_ACCOUNT_LIMIT)) {
      const list = await VexMail.inbox(a.id, this.MAIL_MESSAGES);
      const msgs = Array.isArray(list) ? list : (list && Array.isArray(list.messages) ? list.messages : []);
      for (const m of msgs.slice(0, this.MAIL_MESSAGES)) {
        const full = await VexMail.message(a.id, m.uid);
        read++;
        if (!full || full.tooLarge) continue;
        const text = full.text || (full.html ? VexMail.htmlToText(full.html) : '');
        for (const url of this.callLinks(text)) found.push({ url, from: 'Mail', text: CommsStore.line(full.subject || m.subject || '', 140), ts: Date.parse(m.date || full.date || '') || this._now() });
      }
    }
    return { found, read };
  },

  // ---- the saved list -----------------------------------------------------------------------------------
  links() { return this.state().links.slice().sort((a, b) => (a.at || Infinity) - (b.at || Infinity)); },
  add({ url, label = '', at = 0, from = 'you' } = {}) {
    CommsStore.needKept('A meeting link');
    const href = String(url == null ? '' : url).trim();
    if (!/^https?:\/\//i.test(href)) throw new Error('A meeting link starts with https://');
    try { new URL(href); } catch { throw new Error('That is not a web address'); }
    if (!this.isCallLink(href)) throw new Error('That does not look like a call link (Meet, Zoom, Teams, Webex, Whereby, Jitsi or a Discord invite or event)');
    if (at && (!Number.isFinite(at) || at < 0)) throw new Error('That is not a real time');
    const s = this.state();
    const same = s.links.find(l => l.url === href);
    if (same) { if (at) same.at = at; if (label) same.label = CommsStore.line(label, 80); this._save(s); return same; }
    if (s.links.length >= this.MAX_LINKS) throw new Error('At most ' + this.MAX_LINKS + ' links are kept. Remove one first.');
    const rec = { id: CommsStore.id('ml'), url: href, label: CommsStore.line(label, 80) || this.hostOf(href), at: at || 0, from: CommsStore.line(from, 30), addedAt: this._now() };
    s.links.unshift(rec);
    this._save(s);
    return rec;
  },
  remove(id) {
    const s = this.state();
    const next = s.links.filter(l => l.id !== id);
    if (next.length === s.links.length) return false;
    s.links = next; this._save(s);
    return true;
  },
  // Links older than a day with no time are cleared when you ask; nothing expires in the background.
  tidy(now = this._now()) {
    const s = this.state();
    const next = s.links.filter(l => (l.at ? now - l.at < 24 * 3600000 : now - l.addedAt < 7 * 24 * 3600000));
    const n = s.links.length - next.length;
    if (n) { s.links = next; this._save(s); }
    return n;
  },

  // ---- what is due ----------------------------------------------------------------------------------------
  // Pure. items: [{ key, title, at, url, from }] -> those within `leadMin` before, or up to GRACE after, not dismissed.
  due(items, now, leadMin, dismissed = {}) {
    return items.filter(i => Number.isFinite(i.at) && i.at - now <= leadMin * 60000 && now - i.at <= this.GRACE_MS && !dismissed[i.key]).sort((a, b) => a.at - b.at);
  },
  async candidates(now = this._now()) {
    const s = this.state();
    const out = [];
    for (const l of s.links) if (l.at) out.push({ key: 'saved:' + l.id, title: l.label, at: l.at, url: l.url, from: l.from });
    if (typeof MeetingPrep !== 'undefined' && typeof MeetingPrep._events === 'function') {
      const events = await MeetingPrep._events(now - this.GRACE_MS, now + s.lead * 60000 + this.EVERY_MS);
      for (const e of events) {
        if (e.allDay || !Number.isFinite(e.start)) continue;
        const url = this.callLinks([e.url, e.location, e.description, e.summary].filter(Boolean).join('\n'))[0];
        if (url) out.push({ key: 'cal:' + MeetingPrep.keyOf(e), title: e.summary, at: e.start, url, from: e.calendar || 'Calendar' });
      }
    }
    return out;
  },
  dismiss(key) {
    const s = this.state();
    s.dismissed[key] = this._now();
    for (const [k, t] of Object.entries(s.dismissed)) if (this._now() - t > 2 * 24 * 3600000) delete s.dismissed[k];
    this._save(s);
  },

  // ---- the strip ---------------------------------------------------------------------------------------------
  // Opens the link: only ever from the button.
  join(url) {
    if (!this.isCallLink(url)) throw new Error('That is not a call link');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    TabManager.createTab(url, true);
  },

  _strip: null,
  showStrip(item) {
    if (typeof document === 'undefined') return null;
    this.hideStrip();
    const s = document.createElement('div');
    s.className = 'vex-join-strip';
    s.setAttribute('role', 'region');
    s.setAttribute('aria-label', 'Meeting starting: ' + item.title);
    s.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:10px;max-width:min(560px,94vw);padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:999px;box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.4));font-size:12.5px';
    const mins = Math.round((item.at - this._now()) / 60000);
    const label = document.createElement('span');
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0';
    label.textContent = item.title + (mins > 0 ? ' in ' + mins + ' min' : mins === 0 ? ' now' : ' started ' + (-mins) + ' min ago');
    const join = document.createElement('button');
    join.type = 'button'; join.className = 'btn-primary'; join.textContent = 'Join in browser';
    join.addEventListener('click', () => { try { this.join(item.url); this.dismiss(item.key); this.hideStrip(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn-secondary'; x.textContent = 'Not now'; x.setAttribute('aria-label', 'Dismiss the join strip');
    x.addEventListener('click', () => { this.dismiss(item.key); this.hideStrip(); });
    s.append(label, join, x);
    document.body.appendChild(s);
    if (typeof VexLayer !== 'undefined') VexLayer.track(s, { tier: 'panel', id: 'meeting-links', keep: true });
    this._strip = { el: s, key: item.key };
    return s;
  },
  hideStrip() { if (this._strip) { this._strip.el.remove(); this._strip = null; } },

  // One look: show the strip for the soonest due meeting that has a link. -> the item shown or null.
  async tick(now = this._now()) {
    if (!this.enabled() || CommsStore.privateWindow()) { this.hideStrip(); return null; }
    const s = this.state();
    const items = this.due(await this.candidates(now), now, s.lead, s.dismissed);
    const first = items[0] || null;
    if (!first) { this.hideStrip(); return null; }
    if (this._strip && this._strip.key === first.key) return first;
    if (typeof VexAttention !== 'undefined') VexAttention.request({ feature: 'meeting-links', urgency: 'asked', id: first.key });
    this.showStrip(first);
    return first;
  },

  start() {
    if (this._job || !this.enabled()) return;
    if (typeof VexJobs === 'undefined') throw new Error('Meeting links need VexJobs');
    this._job = VexJobs.every('Meeting join strip', this.EVERY_MS, () => this.tick().catch(err => window.VexProblems?.note('Meeting links', 'Could not look for a meeting to join', err)), { when: 'background', feature: 'meeting-links' });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } this.hideStrip(); },
};

if (typeof window !== 'undefined') {
  window.MeetingLinks = MeetingLinks;
  if (typeof document !== 'undefined') {
    const go = () => { try { MeetingLinks.start(); } catch (err) { console.error('[MeetingLinks]', err); window.VexProblems?.note('Meeting links', 'The join strip could not start', err); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingLinks };
