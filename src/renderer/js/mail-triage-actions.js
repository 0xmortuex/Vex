// === One-tap mail triage and draft replies ===================================
//
// js/inbox-triage.js sorts the inbox into "wants something from you", "worth a
// look" and bulk. This adds what you can do to a message from that list
// without opening it:
//
//   Done     hide it in Vex's triage list (a local mark)
//   Snooze   hide it until a time you choose; it returns in the next brief
//   Mark     keep it at the top of the list
//   Reply    a short reply drafted by your LOCAL AI, for you to edit and send
//
// Honest limits, because they matter:
//   * Vex's mailbox access is read-only on purpose (src/main/mail.js opens the
//     inbox with EXAMINE). Done and Snooze therefore change only what Vex
//     shows; the message stays unread and in the inbox on the server.
//   * Vex never sends mail. A reply draft is shown in a box you can edit; the
//     button hands it to your own mail program (a mailto: link) or copies it.
//   * The draft is written by the local model only (Ollama on this PC). No
//     cloud model is asked, and if the local model is not running the draft
//     fails with that reason instead of falling back.
//
// Local state lives under 'vex.mailTriage' and is not synced.
const MailTriage = {
  KEY: 'vex.mailTriage',
  MAX: 1000,
  BODY_CHARS: 3000,

  isEnabled() { return typeof BriefActions === 'undefined' || BriefActions.isOn('mail'); },

  // ---- local marks --------------------------------------------------------
  keyOf(accountId, m) {
    const id = String((m && m.messageId) || '').replace(/^<|>$/g, '');
    return String(accountId) + '|' + (id || 'uid:' + (m && m.uid));
  },
  _read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  },
  _write(map) {
    const keys = Object.keys(map);
    if (keys.length > this.MAX) keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0)).slice(0, keys.length - this.MAX).forEach(k => { delete map[k]; });
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); }
    catch (err) { throw new Error('The mark could not be saved: ' + err.message); }
  },
  state(accountId, m) { return this._read()[this.keyOf(accountId, m)] || null; },
  _set(accountId, m, s, now = Date.now()) {
    const map = this._read();
    map[this.keyOf(accountId, m)] = { s, at: now };
    this._write(map);
  },
  done(accountId, m, now) { this._set(accountId, m, 'done', now); },
  mark(accountId, m, now) { this._set(accountId, m, 'marked', now); },
  clear(accountId, m) {
    const map = this._read();
    delete map[this.keyOf(accountId, m)];
    this._write(map);
    if (typeof VexSnooze !== 'undefined') VexSnooze.removeRef('mail', this.keyOf(accountId, m));
  },
  snooze(accountId, m, when, now = Date.now()) {
    if (typeof VexSnooze === 'undefined') throw new Error('Snooze is not loaded');
    const f = (m && m.from) || {};
    return VexSnooze.add('mail', {
      title: (m.subject || '(no subject)') + ' - ' + (f.name || f.address || 'someone'),
      url: this.webmailUrl(m), ref: this.keyOf(accountId, m),
    }, when, now);
  },
  webmailUrl(m) { return (m && m._webmail) || ''; },

  isHidden(accountId, m, now = Date.now()) {
    const s = this.state(accountId, m);
    if (s && s.s === 'done') return true;
    return typeof VexSnooze !== 'undefined' && VexSnooze.isPending('mail', this.keyOf(accountId, m), now);
  },
  // Messages still on the list; marked ones first.
  visible(accountId, messages, now = Date.now()) {
    const map = this._read();
    const keep = (messages || []).filter(m => !this.isHidden(accountId, m, now));
    const marked = (m) => (map[this.keyOf(accountId, m)] || {}).s === 'marked' ? 0 : 1;
    return keep.map((m, i) => ({ m, i })).sort((a, b) => (marked(a.m) - marked(b.m)) || (a.i - b.i)).map(x => x.m);
  },

  needsReply(m) {
    return typeof InboxTriage !== 'undefined' && InboxTriage.classify(m).pile === 'needs'
      && !(InboxTriage.NO_REPLY.test(String(((m && m.from) || {}).address || '')));
  },

  // ---- the draft ----------------------------------------------------------
  buildPrompt(msg) {
    const text = String(msg.text || '').replace(/\r/g, '').trim().slice(0, this.BODY_CHARS);
    return 'Write a short reply to this email, 2 to 5 sentences, in plain words, in the language of the email. '
      + 'Do not invent facts, dates or commitments; where the sender needs an answer you cannot know, say you will get back to them. '
      + 'No subject line and no signature name.\n\n'
      + 'From: ' + String(msg.from || '') + '\nSubject: ' + String(msg.subject || '') + '\n\n' + text;
  },
  // A model's answer as plain reply text: it may arrive as {"reply": "..."}.
  plainReply(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (s.startsWith('{')) {
      try { const o = JSON.parse(s); s = String(o.reply || o.text || o.message || o.draft || '').trim(); } catch { /* prose that starts with a brace */ }
    }
    return s.slice(0, 4000);
  },
  PERSONA: {
    systemPrompt: 'You draft short email replies for the user to edit and send themselves. Write only the body of the reply. Never invent facts. Answer as JSON: {"reply": "the reply text"}',
    temperature: 0.4,
  },
  async draft(accountId, m) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI is not loaded');
    if (!window.vex || !window.vex.mail) throw new Error('Mail is not available here');
    const r = await window.vex.mail.message(accountId, m.uid);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The message could not be read');
    const msg = r.value;
    if (msg.tooLarge) throw new Error('This message is too large to draft a reply from');
    const text = msg.text || (typeof VexMail !== 'undefined' ? VexMail.htmlToText(msg.html) : '');
    if (!String(text).trim()) throw new Error('This message has no text to answer');
    // 'local' is one named backend: no routing, and no falling back to the cloud.
    const res = await AIRouter.callOn('local', 'chat', { message: this.buildPrompt({ ...msg, text }), persona: this.PERSONA });
    const reply = this.plainReply(res && (res.result || res.text || res.message));
    if (!reply) throw new Error('The local AI returned nothing');
    return { model: (res && res.model) || '', reply, subject: /^\s*re\s*:/i.test(msg.subject || '') ? msg.subject : 'Re: ' + (msg.subject || ''), to: this.addressOf(m), webmail: msg.webmail || '' };
  },
  addressOf(m) { const a = String(((m && m.from) || {}).address || ''); return /^[^\s@<>]+@[^\s@<>]+$/.test(a) ? a : ''; },

  // The box: edit, then copy or hand to your own mail program. Nothing is sent.
  async showDraft(account, m) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.querySelector('.vex-draft-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'vex-draft-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.4);display:grid;place-items:center';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Draft reply" style="width:min(560px,92vw);display:flex;flex-direction:column;gap:8px;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45))">
        <div style="font-size:13.5px;font-weight:650;color:var(--text)">Draft reply</div>
        <div data-meta style="font-size:11px;color:var(--text-muted)">${esc((m.from || {}).name || (m.from || {}).address || '')} · ${esc(m.subject || '')}</div>
        <textarea data-text rows="9" aria-label="Reply text" class="set-input" style="width:100%;box-sizing:border-box;resize:vertical" placeholder="Writing with your local AI..." disabled></textarea>
        <div data-status style="font-size:11px;color:var(--text-muted)">Written by your local AI. Vex does not send anything: edit it, then open it in your mail program.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button type="button" class="btn-secondary" data-again>Write again</button>
          <button type="button" class="btn-secondary" data-copy style="display:inline-flex;align-items:center;gap:5px">${VexIcons.svg('copy', { size: 12 })} Copy</button>
          <button type="button" class="btn-primary" data-open style="display:inline-flex;align-items:center;gap:5px" disabled>${VexIcons.svg('mail', { size: 12 })} Open in my mail program</button>
          <button type="button" class="btn-secondary" data-close>Close</button>
        </div>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id: 'mail-triage-actions' });
    const ta = overlay.querySelector('[data-text]');
    const status = overlay.querySelector('[data-status]');
    const openBtn = overlay.querySelector('[data-open]');
    let info = null;
    const generate = async () => {
      ta.disabled = true; openBtn.disabled = true; ta.value = '';
      status.textContent = 'Writing with your local AI...';
      try {
        info = await this.draft(account.id, m);
        if (!overlay.isConnected) return;
        ta.value = info.reply; ta.disabled = false; openBtn.disabled = false; ta.focus();
        status.textContent = 'Written by your local AI. Vex does not send anything: edit it, then open it in your mail program.';
        overlay.querySelector('.vex-prov-chip')?.remove();
        if (typeof VexProvenance !== 'undefined') status.after(VexProvenance.chip({ kind: 'local', model: info.model, read: 'the message you are answering' }));
      } catch (err) {
        if (!overlay.isConnected) return;
        status.textContent = err.message;
        ta.disabled = false;
      }
    };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('[data-again]').addEventListener('click', generate);
    overlay.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); window.showToast?.('Reply copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    openBtn.addEventListener('click', async () => {
      try {
        if (typeof window.vex.composeMail !== 'function') throw new Error('Handing a draft to a mail program is not available here');
        const r = await window.vex.composeMail(info.subject, ta.value, info.to || undefined);
        if (r && r.ok === false) throw new Error(r.error || 'Your mail program did not open');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    await generate();
    return overlay;
  },

  // ---- the triage dialog's rows -------------------------------------------
  // Buttons for one row. Rendered by InboxTriage._row.
  rowButtons(m, esc) {
    if (!this.isEnabled()) return '';
    const b = (act, icon, label) => `<button type="button" class="btn-secondary" data-triage="${act}" aria-label="${esc(label)}" title="${esc(label)}" style="padding:3px 6px;display:inline-flex">${VexIcons.svg(icon, { size: 12 })}</button>`;
    return `<span style="display:inline-flex;gap:4px;flex-shrink:0">`
      + (this.needsReply(m) ? b('reply', 'edit', 'Draft a reply') : '')
      + b('mark', 'star', 'Mark') + b('snooze', 'clock', 'Snooze') + b('done', 'check', 'Done (hide in Vex)') + `</span>`;
  },

  // Wire a row's buttons. `after` redraws the list; `account`/`m` are the row's.
  wireRow(row, account, m, after) {
    row.querySelectorAll('[data-triage]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const act = btn.dataset.triage;
          if (act === 'done') { this.done(account.id, m); window.showToast?.('Hidden in Vex. The mail itself is unchanged.'); }
          else if (act === 'mark') this.mark(account.id, m);
          else if (act === 'snooze') {
            const mm = { ...m, _webmail: (typeof InboxTriage !== 'undefined' && InboxTriage.webmailMessage(account, m)) || '' };
            const at = await VexSnooze.ask('Snooze this mail until when?');
            if (at == null) return;
            this.snooze(account.id, mm, at);
            window.showToast?.('Snoozed. It comes back in your brief.');
          } else if (act === 'reply') { await this.showDraft(account, m); return; }
          if (typeof after === 'function') after();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
    });
  },

  // ---- the brief ----------------------------------------------------------
  section: {
    id: 'mail-triage',
    title: 'Mail that needs a reply',
    icon: 'mail',
    order: 25,
    ttlMs: 5 * 60000,
    maxItems: 5,
    defaultOn: false,
    optIn: true,
    isEnabled() { return MailTriage.isEnabled(); },
    // Only accounts the person chose for the Morning Brief's mail section.
    async build(ctx = {}) {
      if (typeof VexBrief === 'undefined' || !window.vex || !window.vex.mail || typeof InboxTriage === 'undefined') return null;
      const chosen = VexBrief.prefs().mailAccounts || [];
      if (!chosen.length) return { hint: 'Choose a mail account under Morning Brief settings to see mail that needs a reply.' };
      const accounts = await InboxTriage.accounts();
      const now = ctx.now || Date.now();
      const items = [];
      let needs = 0;
      for (const a of accounts.filter(x => chosen.includes(x.id))) {
        const inbox = await InboxTriage.inbox(a.id);
        const piles = InboxTriage.sort(MailTriage.visible(a.id, inbox.messages || [], now));
        needs += piles.needs.length;
        for (const m of piles.needs) {
          if (items.length >= 5) break;
          items.push({ text: m.subject || '(no subject)', sub: ((m.from || {}).name || (m.from || {}).address || '') + ' · ' + m.why, url: InboxTriage.webmailMessage(a, m) || '', badge: 'reply' });
        }
      }
      if (!items.length) return null;
      return { summary: needs + (needs === 1 ? ' message wants' : ' messages want') + ' a reply.', items, note: 'Triage and draft replies: Ctrl+K, "What My Inbox Actually Wants".' };
    },
  },
};

if (typeof window !== 'undefined') window.MailTriage = MailTriage;
if (typeof module !== 'undefined' && module.exports) module.exports = { MailTriage };
