// === Six thousand unread, sorted ===========================================
//
// An inbox with thousands of unread messages is not a list, it is a wall. The
// useful question is not "what is newest" but "which of these actually want
// something from me" — and that is answerable without reading anyone's mail:
// who it is from, what the subject says, and whether it was sent to you or to
// a hundred thousand people.
//
// Three piles:
//   needs you    a person, a thread, a question
//   worth a look something that is not bulk but asks nothing
//   bulk         newsletters, notifications, receipts, sales
//
// Vex's inbox is read-only on purpose (src/main/mail.js opens the mailbox with
// EXAMINE and reads bodies with PEEK), so nothing here archives anything. What
// it does is group the bulk by who sent it, so archiving a thousand of them in
// your webmail is four clicks instead of four hundred.
const InboxTriage = {
  // Addresses that exist so you cannot reply to them.
  NO_REPLY: /(^|[.\-_+])(no-?reply|do-?not-?reply|donotreply|notifications?|noreply|mailer-daemon|bounce|postmaster|automated|alerts?)([.\-_+]|@)/i,
  // Subjects that announce themselves as bulk.
  BULK_SUBJECT: /\b(newsletter|digest|unsubscribe|weekly (?:round-?up|update)|your (?:receipt|invoice|order|statement)|sale|% off|deal of|black friday|webinar|survey|new in|top picks|recommended for you|verify your|confirm your email|password reset|security (?:alert|code)|one-?time code|sign-?in (?:code|attempt))\b/i,
  // Subjects that suggest a person waiting on you.
  ASKS: /\?|\b(can you|could you|would you|please|when (?:can|will|are)|any update|following up|reminder|deadline|by (?:monday|tuesday|wednesday|thursday|friday|today|tomorrow)|let me know|thoughts|review|approve|sign)\b/i,
  THREAD: /^\s*(re|fwd|fw|aw|wg)\s*:/i,

  domain(address) {
    const at = String(address || '').split('@')[1];
    return at ? at.toLowerCase().replace(/^mail\./, '') : '';
  },

  // Which pile, and why — the reason is shown, because a pile nobody
  // understands is a pile nobody trusts.
  classify(message) {
    const from = (message && message.from) || {};
    const address = String(from.address || '');
    const subject = String(message.subject || '');
    if (message.flagged) return { pile: 'needs', why: 'you flagged it' };
    if (this.NO_REPLY.test(address)) return { pile: 'bulk', why: 'sent from an address that takes no replies' };
    if (this.BULK_SUBJECT.test(subject)) return { pile: 'bulk', why: 'reads like a newsletter or a notice' };
    if (this.THREAD.test(subject)) return { pile: 'needs', why: 'part of a thread you are in' };
    if (this.ASKS.test(subject)) return { pile: 'needs', why: 'the subject asks something' };
    if (!address) return { pile: 'look', why: 'no sender to judge by' };
    return { pile: 'look', why: 'a person, but it asks nothing' };
  },

  // The whole inbox, sorted. Read mail is left out of "needs you": something
  // you have already opened is not waiting for you in the same way.
  sort(messages, { unreadOnly = true } = {}) {
    const piles = { needs: [], look: [], bulk: [] };
    for (const m of messages || []) {
      if (unreadOnly && m.seen && !m.flagged) continue;
      const { pile, why } = this.classify(m);
      piles[pile].push({ ...m, why });
    }
    for (const key of Object.keys(piles)) piles[key].sort((a, b) => (b.date || 0) - (a.date || 0));
    return piles;
  },

  // Bulk, grouped by who keeps sending it — the list you actually act on.
  senders(bulk) {
    const by = new Map();
    for (const m of bulk || []) {
      const key = this.domain((m.from || {}).address) || ((m.from || {}).name || 'unknown');
      const at = by.get(key) || { sender: key, name: (m.from || {}).name || key, count: 0, newest: 0 };
      at.count++;
      at.newest = Math.max(at.newest, m.date || 0);
      by.set(key, at);
    }
    return [...by.values()].sort((a, b) => b.count - a.count || b.newest - a.newest);
  },

  // One line summing the inbox up.
  summary(piles) {
    const needs = piles.needs.length;
    const bulk = piles.bulk.length;
    if (!needs && !bulk && !piles.look.length) return 'Nothing unread.';
    const parts = [];
    parts.push(needs ? needs + ' want' + (needs === 1 ? 's' : '') + ' something from you' : 'nothing waiting on you');
    if (piles.look.length) parts.push(piles.look.length + ' worth a look');
    if (bulk) parts.push(bulk + ' bulk');
    return parts.join(', ') + '.';
  },

  // --- the dialog ----------------------------------------------------------

  // Mail lives behind the same read-only bridge the Mail sheet uses, and
  // answers { ok, value } like the rest of it.
  async _call(promise) {
    const r = await promise;
    if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer');
    return r.value;
  },
  accounts() { return this._call(window.vex.mail.accounts()); },
  inbox(id) { return this._call(window.vex.mail.inbox(id, 100)); },

  _row(m, esc) {
    const who = esc(((m.from || {}).name || (m.from || {}).address || 'Someone'));
    const when = m.date ? new Date(m.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    return `
      <div data-uid="${m.uid}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;cursor:pointer">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject || '(no subject)')}</div>
          <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${who} · ${esc(m.why)}</div>
        </div>
        <div style="font-size:10.5px;color:var(--text-muted)">${esc(when)}</div>
      </div>`;
  },

  async open() {
    document.querySelector('.vex-triage-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-triage-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Inbox triage"
           style="width:min(620px,92vw);max-height:76vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13.5px;font-weight:650;color:var(--text)">What your inbox actually wants</div>
          <div data-summary style="font-size:10.5px;color:var(--text-muted)">Reading the newest hundred…</div>
        </div>
        <div data-body style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Vex's inbox is read-only, so nothing here is moved or archived — the bulk list opens your webmail with that sender searched, where you can clear it in one go.
        </div>
      </div>`;

    const bodyEl = overlay.querySelector('[data-body]');
    const summaryEl = overlay.querySelector('[data-summary]');
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);

    let accounts;
    try { accounts = await this.accounts(); }
    catch (err) { summaryEl.textContent = err.message; return overlay; }
    if (!accounts || !accounts.length) {
      summaryEl.textContent = '';
      bodyEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Add your mail account in the Mail panel first.</div>';
      return overlay;
    }

    let inbox;
    try { inbox = await this.inbox(accounts[0].id); }
    catch (err) { summaryEl.textContent = err.message; return overlay; }

    const piles = this.sort(inbox.messages || []);
    summaryEl.textContent = this.summary(piles) + ' Of ' + (inbox.unseen || 0) + ' unread in all.';
    const section = (title, items) => items.length
      ? `<div style="padding:8px 9px 2px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(title)}</div>${items.map(m => this._row(m, esc)).join('')}`
      : '';
    const bulkBy = this.senders(piles.bulk);
    bodyEl.innerHTML = section('Wants something from you', piles.needs)
      + section('Worth a look', piles.look)
      + (bulkBy.length
        ? `<div style="padding:10px 9px 2px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Bulk, by sender</div>`
          + bulkBy.map(s => `
            <div data-sender="${esc(s.sender)}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;cursor:pointer">
              <div style="flex:1;min-width:0;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${s.count} unread → clear in webmail</div>
            </div>`).join('')
        : '');

    const account = accounts[0];
    const byUid = new Map((inbox.messages || []).map(m => [String(m.uid), m]));
    bodyEl.querySelectorAll('[data-uid]').forEach(row => {
      // Replying is the whole point of this pile, and Vex's inbox cannot
      // reply — so a message opens where it can be answered.
      row.addEventListener('click', () => {
        close();
        TabManager.createTab(this.webmailMessage(account, byUid.get(row.dataset.uid) || {}), true);
      });
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
    });
    bodyEl.querySelectorAll('[data-sender]').forEach(row => {
      row.addEventListener('click', () => {
        close();
        TabManager.createTab(this.webmailSearch(account, row.dataset.sender), true);
      });
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
    });
    return overlay;
  },

  // That one message, in the webmail, by the id the mail itself carries —
  // exact, and it works however old the message is.
  webmailMessage(account, message) {
    const address = String((account && account.email) || '');
    const id = String((message && message.messageId) || '').replace(/^<|>$/g, '');
    if (/@(yahoo|ymail|rocketmail)\./i.test(address)) return 'https://mail.yahoo.com/d/search/keyword=' + encodeURIComponent(String(message.subject || ''));
    if (/@(icloud|me|mac)\./i.test(address)) return 'https://www.icloud.com/mail/';
    if (id) return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent('rfc822msgid:' + id);
    return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(String(message.subject || ''));
  },

  // The webmail search that shows everything from that sender, where it can be
  // selected and archived in one go.
  webmailSearch(account, sender) {
    const address = String((account && account.email) || '');
    const query = 'from:' + sender + ' is:unread';
    if (/@(yahoo|ymail|rocketmail)\./i.test(address)) return 'https://mail.yahoo.com/d/search/keyword=' + encodeURIComponent('from:' + sender);
    if (/@(icloud|me|mac)\./i.test(address)) return 'https://www.icloud.com/mail/';
    return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(query);
  },
};

if (typeof window !== 'undefined') window.InboxTriage = InboxTriage;
if (typeof module !== 'undefined' && module.exports) module.exports = { InboxTriage };
