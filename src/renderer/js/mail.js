// === Mail — a read-only inbox ================================================
//
// The newest mail from your accounts, and each message as text. Nothing on
// the server changes: reading here does not mark mail read (src/main/mail.js
// opens the inbox read-only). Replying happens in the webmail — "Open in
// Gmail" goes straight to that message.
//
// Messages are shown as TEXT. Pictures and other remote content are never
// loaded, so a tracking pixel learns nothing; an HTML-only message is turned
// into its words with the browser's parser, where no script can run. Links
// open in a new tab.

const VexMail = {
  _state: { accountId: null, inbox: null, open: null },

  async _call(p) {
    const r = await p;
    if (!r || !r.ok) throw new Error((r && r.error) || 'Mail failed');
    return r.value;
  },
  accounts() { return this._call(window.vex.mail.accounts()); },
  inbox(id, limit) { return this._call(window.vex.mail.inbox(id, limit)); },
  message(id, uid) { return this._call(window.vex.mail.message(id, uid)); },

  // Which provider an address belongs to, for the sign-in help. Mirrors main.
  PROVIDER_HELP: {
    'gmail.com': 'Gmail needs an app password: Google Account › Security › 2-Step Verification › App passwords. Your normal password will not work.',
    'googlemail.com': 'Gmail needs an app password: Google Account › Security › 2-Step Verification › App passwords.',
    'yahoo.com': 'Yahoo needs an app password: Account Info › Account security › Generate app password.',
    'icloud.com': 'iCloud needs an app-specific password: appleid.apple.com › Sign-In and Security › App-Specific Passwords.',
    'me.com': 'iCloud needs an app-specific password: appleid.apple.com › Sign-In and Security › App-Specific Passwords.',
    'outlook.com': 'Outlook.com cannot be read here: Microsoft no longer lets mail programs sign in with a password. Open outlook.live.com in a tab instead.',
    'hotmail.com': 'Hotmail cannot be read here: Microsoft no longer lets mail programs sign in with a password. Open outlook.live.com in a tab instead.',
  },
  KNOWN: ['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com'],

  // An HTML-only message, as its words. DOMParser builds an inert document:
  // no script runs and nothing is fetched.
  htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script, style, head, noscript').forEach(n => n.remove());
    doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
    doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, h5, h6, blockquote').forEach(n => n.append('\n'));
    doc.querySelectorAll('a[href]').forEach(a => { const h = a.getAttribute('href'); if (/^https?:/i.test(h) && !a.textContent.includes(h)) a.append(' (' + h + ')'); });
    return (doc.body ? doc.body.textContent : '').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  // Escaped text with web links made clickable.
  linkify(text) {
    const esc = (s) => window.escapeHtml(String(s));
    const parts = String(text || '').split(/(https?:\/\/[^\s<>"')\]]+)/g);
    return parts.map((p, i) => (i % 2 ? `<a href="#" data-url="${esc(p)}" style="color:var(--primary)">${esc(p)}</a>` : esc(p))).join('');
  },

  when(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (now - d < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  },

  size(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; },

  // --- the sheet -------------------------------------------------------------------
  async open() {
    const { overlay, head, body, close } = window.PageExport._sheet('Mail', 'vex-mail-overlay');
    const box = head.closest('[role="dialog"]');
    if (box) { box.style.width = 'min(1000px,96vw)'; box.style.maxHeight = '86vh'; }
    this._ui = { overlay, head, body, close };
    const accounts = await this.accounts();
    if (!overlay.isConnected) return null;
    if (!accounts.length) this._drawSetup();
    else await this._drawInbox(accounts, this._state.accountId && accounts.some(a => a.id === this._state.accountId) ? this._state.accountId : accounts[0].id);
    return body;
  },

  _drawSetup(canCancel) {
    const { body } = this._ui;
    const field = 'font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)';
    body.innerHTML = `
      <form data-setup style="display:grid;gap:10px;padding:16px;max-width:520px">
        <div style="font-size:13px;color:var(--text)">Read your newest mail here. Reading in Vex never marks anything read or changes your mailbox; to reply, open the message in your webmail.</div>
        <label style="display:grid;gap:4px;font-size:12px;color:var(--text)">Email address<input data-email type="email" autocomplete="off" spellcheck="false" style="${field}"></label>
        <div data-help style="font-size:11.5px;color:var(--text-muted);min-height:15px"></div>
        <label style="display:grid;gap:4px;font-size:12px;color:var(--text)">App password<input data-pass type="password" autocomplete="off" style="${field}"></label>
        <div data-custom hidden style="display:grid;grid-template-columns:1fr 90px;gap:8px">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text)">IMAP server<input data-host type="text" placeholder="imap.example.com" spellcheck="false" style="${field}"></label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--text)">Port<input data-port type="number" value="993" min="1" max="65535" style="${field}"></label>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" style="font:inherit;font-size:12.5px;padding:7px 14px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Sign in</button>
          ${canCancel ? '<button data-back type="button" style="font:inherit;font-size:12.5px;padding:7px 12px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);cursor:pointer">Back</button>' : ''}
          <span data-status style="font-size:12px;color:var(--text-muted)"></span>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">The address and app password are kept on this PC, encrypted by Windows. Vex signs in once now to check them.</div>
      </form>`;
    const email = body.querySelector('[data-email]'), help = body.querySelector('[data-help]'), custom = body.querySelector('[data-custom]');
    email.addEventListener('input', () => {
      const domain = (email.value.split('@')[1] || '').trim().toLowerCase();
      help.textContent = this.PROVIDER_HELP[domain] || (domain.includes('.') && !this.KNOWN.includes(domain) ? 'Enter your provider\'s IMAP server below, and an app password if it issues them.' : '');
      custom.hidden = !(domain.includes('.') && !this.KNOWN.includes(domain) && !this.PROVIDER_HELP[domain]);
    });
    body.querySelector('[data-back]')?.addEventListener('click', () => this.open());
    body.querySelector('[data-setup]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = body.querySelector('[data-status]');
      const btn = body.querySelector('[type=submit]');
      btn.disabled = true; status.textContent = 'Signing in…';
      try {
        const account = { email: email.value.trim(), password: body.querySelector('[data-pass]').value };
        if (!custom.hidden) { account.host = body.querySelector('[data-host]').value.trim(); account.port = Number(body.querySelector('[data-port]').value) || 993; account.secure = account.port === 993; }
        const added = await this._call(window.vex.mail.add(account));
        body.querySelector('[data-pass]').value = '';
        window.showToast?.('Signed in to ' + added.email);
        await this._drawInbox(await this.accounts(), added.id);
      } catch (err) {
        btn.disabled = false; status.textContent = '';
        window.showToast?.(err.message, 'error');
        help.textContent = err.message;
      }
    });
    email.focus();
  },

  async _drawInbox(accounts, accountId) {
    const { head, body } = this._ui;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    this._state.accountId = accountId;
    head.querySelectorAll('[data-mailhead]').forEach(n => n.remove());
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `
      ${accounts.length > 1 ? `<select data-mailhead data-account aria-label="Account" style="font-size:11.5px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px 4px">${accounts.map(a => `<option value="${esc(a.id)}" ${a.id === accountId ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select>` : ''}
      <button data-mailhead data-refresh type="button" style="${btn}">Refresh</button>
      <button data-mailhead data-manage type="button" style="${btn}">Accounts</button>`);
    head.querySelector('[data-account]')?.addEventListener('change', (e) => this._drawInbox(accounts, e.target.value));
    head.querySelector('[data-refresh]').addEventListener('click', () => this._drawInbox(accounts, accountId));
    head.querySelector('[data-manage]').addEventListener('click', () => this._drawAccounts(accounts));

    body.innerHTML = `<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">Reading the inbox…</div>`;
    let inbox;
    try { inbox = await this.inbox(accountId, 50); }
    catch (err) { body.innerHTML = `<div style="padding:22px;font-size:12.5px;color:var(--danger,#e5534b)">${esc(err.message)}</div>`; return; }
    if (!this._ui.overlay.isConnected) return;
    this._state.inbox = inbox;
    body.innerHTML = `
      <div style="padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">${esc(inbox.account.email)} · <b style="color:var(--text)">${inbox.unseen}</b> unread of ${inbox.total}${inbox.account.webmail ? ` · <a href="#" data-webmail style="color:var(--primary)">Open ${esc(inbox.account.name)}</a>` : ''}</div>
      <div style="display:grid;grid-template-columns:minmax(260px,38%) 1fr;min-height:420px">
        <div data-list role="list" style="border-right:1px solid var(--border);overflow-y:auto;max-height:70vh"></div>
        <div data-reader style="overflow-y:auto;max-height:70vh;padding:14px 16px;font-size:12.5px;color:var(--text-muted)">Choose a message.</div>
      </div>`;
    body.querySelector('[data-webmail]')?.addEventListener('click', (e) => { e.preventDefault(); TabManager.createTab(inbox.account.webmail, true); this._ui.close(); });
    const list = body.querySelector('[data-list]');
    if (!inbox.messages.length) list.innerHTML = '<div style="padding:16px;font-size:12.5px;color:var(--text-muted)">The inbox is empty.</div>';
    for (const m of inbox.messages) {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'listitem');
      row.dataset.uid = m.uid;
      row.style.cssText = 'display:block;width:100%;text-align:left;font:inherit;padding:8px 12px;border:none;border-bottom:1px solid var(--border);background:none;cursor:pointer;color:var(--text)';
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:baseline">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:${m.seen ? 400 : 700}">${esc(m.from.name || m.from.address || 'Unknown sender')}</span>
          <span style="font-size:10.5px;color:var(--text-muted)">${esc(this.when(m.date))}</span>
        </div>
        <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${m.seen ? 'var(--text-muted)' : 'var(--text)'};font-weight:${m.seen ? 400 : 600}">${esc(m.subject || '(no subject)')}</div>`;
      row.addEventListener('click', () => {
        list.querySelectorAll('[data-uid]').forEach(r => { r.style.background = 'none'; });
        row.style.background = 'var(--surface)';
        this._read(accountId, m);
      });
      list.appendChild(row);
    }
  },

  async _read(accountId, m) {
    const reader = this._ui.body.querySelector('[data-reader]');
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    reader.innerHTML = 'Opening…';
    let msg;
    try { msg = await this.message(accountId, m.uid); }
    catch (err) { reader.innerHTML = `<span style="color:var(--danger,#e5534b)">${esc(err.message)}</span>`; return; }
    if (msg.tooLarge) {
      reader.innerHTML = `<div style="color:var(--text)">This message is ${esc(this.size(msg.size))} — too large to open here.</div>${msg.webmail ? '<button data-web type="button" style="margin-top:8px;font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);cursor:pointer">Open in webmail</button>' : ''}`;
      reader.querySelector('[data-web]')?.addEventListener('click', () => { TabManager.createTab(msg.webmail, true); this._ui.close(); });
      return;
    }
    const text = msg.text || this.htmlToText(msg.html);
    const name = this._state.inbox ? this._state.inbox.account.name : 'webmail';
    reader.innerHTML = `
      <div style="font-size:15px;font-weight:650;color:var(--text);margin-bottom:6px">${esc(msg.subject || '(no subject)')}</div>
      <div style="font-size:11.5px;color:var(--text-muted);line-height:1.5">From ${esc(msg.from)}<br>To ${esc(msg.to)}${msg.cc ? '<br>Cc ' + esc(msg.cc) : ''}<br>${esc(msg.date ? new Date(msg.date).toLocaleString() : '')}</div>
      ${msg.webmail ? `<div style="margin:10px 0"><button data-reply type="button" style="font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Reply in ${esc(name)}</button></div>` : ''}
      ${msg.attachments.length ? `<div style="font-size:11.5px;color:var(--text-muted);margin:8px 0">Attached: ${msg.attachments.map(a => esc(a.filename) + ' (' + esc(this.size(a.size)) + ')').join(', ')} — download them from ${esc(name)}.</div>` : ''}
      <div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.55;color:var(--text);border-top:1px solid var(--border);padding-top:10px;margin-top:6px">${text ? this.linkify(text) : '<span style="color:var(--text-muted)">This message has no text.</span>'}</div>
      <div style="font-size:10.5px;color:var(--text-muted);margin-top:12px">Shown as text: pictures and other remote content are not loaded, so nothing reports that you opened it. Reading here did not mark it read.</div>`;
    reader.querySelector('[data-reply]')?.addEventListener('click', () => { TabManager.createTab(msg.webmail, true); this._ui.close(); });
    reader.querySelectorAll('a[data-url]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); TabManager.createTab(a.dataset.url, true); }));
  },

  _drawAccounts(accounts) {
    const { head, body } = this._ui;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    head.querySelectorAll('[data-mailhead]').forEach(n => n.remove());
    body.innerHTML = `<div style="padding:14px;display:grid;gap:8px" data-accounts></div>`;
    const list = body.querySelector('[data-accounts]');
    for (const a of accounts) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text)';
      row.innerHTML = `<span style="flex:1">${esc(a.email)} <span style="color:var(--text-muted)">· ${esc(a.name)}</span></span><button data-remove type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Remove</button>`;
      row.querySelector('[data-remove]').addEventListener('click', async () => {
        const ok = await window.vexConfirm({ title: 'Remove ' + a.email + '?', message: 'Vex forgets this account and its app password. Nothing in the mailbox changes.', okLabel: 'Remove', danger: true });
        if (!ok) return;
        try { await this._call(window.vex.mail.remove(a.id)); }
        catch (err) { window.showToast?.(err.message, 'error'); return; }
        this.open();
      });
      list.appendChild(row);
    }
    list.insertAdjacentHTML('beforeend', `<div style="display:flex;gap:8px;margin-top:6px"><button data-add type="button" style="font:inherit;font-size:12.5px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add an account</button><button data-back type="button" style="font:inherit;font-size:12.5px;padding:6px 12px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);cursor:pointer">Back to the inbox</button></div>`);
    list.querySelector('[data-add]').addEventListener('click', () => this._drawSetup(true));
    list.querySelector('[data-back]').addEventListener('click', () => this.open());
  },
};

if (typeof window !== 'undefined') window.VexMail = VexMail;
if (typeof module !== 'undefined') module.exports = { VexMail };
