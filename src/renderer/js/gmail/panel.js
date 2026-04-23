// === Gmail Panel (Phase 1: onboarding + connected placeholder) ===
// Phase 2 will replace the placeholder with a real inbox view.

const GmailPanel = {
  mounted: false,

  async init() {
    const panel = document.getElementById('panel-gmail');
    if (!panel) return;
    // Re-render on every open so state (connected / not) stays fresh.
    panel.innerHTML = '';
    panel.dataset.rendered = 'true';
    await this.render(panel);
  },

  async render(container) {
    const state = await window.vexGmail.hasCredentials();
    if (state.configured) {
      await this.renderConnected(container);
    } else {
      this.renderOnboarding(container);
    }
  },

  renderOnboarding(container) {
    container.innerHTML = `
      <div class="gmail-root">
        <div class="gmail-card">
          <div class="gmail-card-header">
            <div class="gmail-card-icon">\u{2709}</div>
            <div>
              <h2>Connect your Gmail</h2>
              <p>Native IMAP &amp; SMTP — no more Google webview blocks.</p>
            </div>
          </div>
          <form class="gmail-form" id="gmail-onboarding-form" autocomplete="off">
            <label class="gmail-label">Email address</label>
            <input type="email" class="gmail-input" id="gmail-email" placeholder="you@gmail.com" spellcheck="false" autocomplete="off" required>

            <label class="gmail-label">App password</label>
            <div class="gmail-note">
              Requires 2FA enabled on your Google account. If you don't have it yet, enable at
              <a class="gmail-link-inline" id="gmail-2fa-help" href="#">myaccount.google.com/security</a>
              first.
            </div>
            <input type="password" class="gmail-input" id="gmail-apppass" placeholder="16-character app password" spellcheck="false" autocomplete="new-password" required>

            <a class="gmail-link" id="gmail-apppass-help" href="#">&rarr; How to get an app password</a>

            <button type="submit" class="gmail-btn-primary" id="gmail-connect-btn">Connect</button>

            <div class="gmail-status" id="gmail-status"></div>

            <p class="gmail-footnote">
              We only use these credentials to talk to Gmail via IMAP (read) and SMTP (send).
              Stored encrypted locally with OS-level encryption &mdash; never leaves your machine.
            </p>
          </form>
        </div>
      </div>
    `;

    const form = container.querySelector('#gmail-onboarding-form');
    const emailEl = container.querySelector('#gmail-email');
    const passEl = container.querySelector('#gmail-apppass');
    const btn = container.querySelector('#gmail-connect-btn');
    const status = container.querySelector('#gmail-status');
    const help = container.querySelector('#gmail-apppass-help');

    help.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof TabManager !== 'undefined' && TabManager.createTab) {
        TabManager.createTab('https://myaccount.google.com/apppasswords', true);
        SidebarManager.hideActivePanel();
      }
    });

    const twoFa = container.querySelector('#gmail-2fa-help');
    if (twoFa) {
      twoFa.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof TabManager !== 'undefined' && TabManager.createTab) {
          TabManager.createTab('https://myaccount.google.com/security', true);
          SidebarManager.hideActivePanel();
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailEl.value.trim();
      const appPassword = passEl.value.trim().replace(/\s+/g, '');
      if (!email || !appPassword) return;

      btn.disabled = true;
      btn.textContent = 'Connecting…';
      status.textContent = 'Testing IMAP connection…';
      status.className = 'gmail-status pending';

      const result = await window.vexGmail.saveCredentials(email, appPassword);

      if (result.success) {
        status.textContent = `Connected. Inbox contains ${result.inboxCount} messages.`;
        status.className = 'gmail-status success';
        if (typeof window.showToast === 'function') window.showToast('Gmail connected');
        // Re-render into connected state after a short beat so the user sees the success line.
        setTimeout(() => this.render(container), 700);
      } else {
        status.textContent = `Connection failed: ${result.error}`;
        status.className = 'gmail-status error';
        if (typeof window.showToast === 'function') window.showToast('Gmail: ' + result.error);
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    });
  },

  // State for the inbox view
  _inboxState: null,

  async renderConnected(container) {
    const { email } = await window.vexGmail.getEmail();
    this._inboxState = {
      email: email || '',
      messages: [],
      nextBefore: null,
      totalCount: 0,
      loading: false,
      view: 'list',         // 'list' | 'reading'
      openMessage: null,    // parsed message when view === 'reading'
      container,
    };
    this.renderInboxShell(container);
    await this.loadInbox({ initial: true });
  },

  renderInboxShell(container) {
    const { email } = this._inboxState;
    container.innerHTML = `
      <div class="gmail-inbox">
        <header class="gmail-topbar">
          <div class="gmail-topbar-left">
            <span class="gmail-topbar-email">${this.esc(email)}</span>
          </div>
          <div class="gmail-topbar-right">
            <button class="gmail-btn-compose" id="gmail-compose" title="New message">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Compose</span>
            </button>
            <button class="gmail-icon-btn" id="gmail-refresh" title="Refresh">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
            </button>
            <button class="gmail-icon-btn" id="gmail-panel-disconnect" title="Disconnect">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </header>
        <div class="gmail-list" id="gmail-list"></div>
        <div class="gmail-reading" id="gmail-reading" hidden></div>
      </div>
    `;

    container.querySelector('#gmail-compose').addEventListener('click', () => this.openCompose({ mode: 'new' }));
    container.querySelector('#gmail-refresh').addEventListener('click', () => this.loadInbox({ initial: true }));
    container.querySelector('#gmail-panel-disconnect').addEventListener('click', async () => {
      if (!confirm('Disconnect Gmail? This removes your stored app password.')) return;
      await window.vexGmail.clearCredentials();
      if (typeof window.showToast === 'function') window.showToast('Gmail disconnected');
      this.render(container);
    });
  },

  async loadInbox({ initial }) {
    const s = this._inboxState;
    if (s.loading) return;
    s.loading = true;

    const listEl = s.container.querySelector('#gmail-list');
    if (initial) {
      listEl.innerHTML = '<div class="gmail-list-status">Loading inbox…</div>';
    } else {
      const more = listEl.querySelector('.gmail-load-more');
      if (more) more.textContent = 'Loading…';
    }

    const opts = initial ? { limit: 50 } : { limit: 50, before: s.nextBefore };
    const result = await window.vexGmail.listInbox(opts);

    if (!result.success) {
      listEl.innerHTML = `<div class="gmail-list-status error">Failed to load inbox: ${this.esc(result.error || 'unknown error')}</div>`;
      s.loading = false;
      return;
    }

    if (initial) {
      s.messages = result.messages;
    } else {
      s.messages = s.messages.concat(result.messages);
    }
    s.totalCount = result.totalCount;
    s.nextBefore = result.nextBefore;
    s.loading = false;
    this.renderMessageList();
  },

  renderMessageList() {
    const s = this._inboxState;
    const listEl = s.container.querySelector('#gmail-list');
    if (!s.messages.length) {
      listEl.innerHTML = '<div class="gmail-list-status">Inbox is empty.</div>';
      return;
    }

    const rows = s.messages.map(m => this.messageRowHtml(m)).join('');
    const loadMore = s.nextBefore
      ? '<button class="gmail-load-more">Load more</button>'
      : '';
    listEl.innerHTML = rows + loadMore;

    listEl.querySelectorAll('.gmail-row').forEach(row => {
      const uid = parseInt(row.dataset.uid, 10);
      row.addEventListener('click', () => this.openMessage(uid));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showRowContextMenu(e, uid);
      });
    });
    const lm = listEl.querySelector('.gmail-load-more');
    if (lm) lm.addEventListener('click', () => this.loadInbox({ initial: false }));
  },

  messageRowHtml(m) {
    const read = m.flags.includes('\\Seen');
    const starred = m.flags.includes('\\Flagged');
    const fromName = m.from?.name || m.from?.address || '(unknown sender)';
    const when = this.formatDate(m.date);
    const cls = ['gmail-row'];
    if (!read) cls.push('unread');
    if (starred) cls.push('starred');
    return `
      <div class="${cls.join(' ')}" data-uid="${m.uid}">
        <div class="gmail-row-indicator">
          ${starred ? '<span class="gmail-star">\u{2605}</span>' : (read ? '<span class="gmail-dot-read"></span>' : '<span class="gmail-dot-unread"></span>')}
        </div>
        <div class="gmail-row-main">
          <div class="gmail-row-top">
            <span class="gmail-row-from">${this.esc(fromName)}</span>
            <span class="gmail-row-date">${this.esc(when)}</span>
          </div>
          <div class="gmail-row-subject">${this.esc(m.subject)}</div>
          <div class="gmail-row-preview">${this.esc(m.preview || '')}</div>
        </div>
      </div>
    `;
  },

  formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isYesterday) return 'Yesterday';
    if (now - date < 7 * 86400000) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  },

  async openMessage(uid) {
    const s = this._inboxState;
    const readingEl = s.container.querySelector('#gmail-reading');
    const listEl = s.container.querySelector('#gmail-list');
    readingEl.hidden = false;
    listEl.hidden = true;
    readingEl.innerHTML = '<div class="gmail-reading-status">Loading message…</div>';

    const result = await window.vexGmail.getMessage(uid);
    if (!result.success || !result.message) {
      readingEl.innerHTML = `<div class="gmail-reading-status error">Failed to load message: ${this.esc(result.error || 'not found')}</div>`;
      return;
    }

    s.openMessage = result.message;
    s.view = 'reading';
    this.renderReadingPane();

    // Mark read optimistically if not already
    const entry = s.messages.find(m => m.uid === uid);
    if (entry && !entry.flags.includes('\\Seen')) {
      entry.flags.push('\\Seen');
      this.renderMessageList();
      window.vexGmail.markRead(uid, true).catch(() => {});
    }
  },

  renderReadingPane() {
    const s = this._inboxState;
    const m = s.openMessage;
    const readingEl = s.container.querySelector('#gmail-reading');
    const fromStr = (m.from || []).map(a => `${a.name || ''} &lt;${a.address || ''}&gt;`).join(', ');
    const toStr = (m.to || []).map(a => `${a.name || ''} &lt;${a.address || ''}&gt;`).join(', ');
    const starred = m.flags.includes('\\Flagged');

    readingEl.innerHTML = `
      <div class="gmail-reading-inner">
        <header class="gmail-reading-bar">
          <button class="gmail-icon-btn" id="gmail-back" title="Back to inbox">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <button class="gmail-icon-btn" id="gmail-action-reply" title="Reply">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          </button>
          <button class="gmail-icon-btn" id="gmail-action-reply-all" title="Reply all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 17 2 12 7 7"/><polyline points="12 17 7 12 12 7"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/></svg>
          </button>
          <button class="gmail-icon-btn" id="gmail-action-forward" title="Forward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
          </button>
          <div class="gmail-reading-bar-spacer"></div>
          <button class="gmail-icon-btn${starred ? ' active' : ''}" id="gmail-action-star" title="Toggle star">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="gmail-icon-btn" id="gmail-action-archive" title="Archive">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          </button>
          <button class="gmail-icon-btn danger" id="gmail-action-trash" title="Trash">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </header>
        <section class="gmail-reading-headers">
          <div class="gmail-reading-subject">${this.esc(m.subject)}</div>
          <div class="gmail-reading-meta"><span class="gmail-reading-meta-label">From</span> ${fromStr}</div>
          <div class="gmail-reading-meta"><span class="gmail-reading-meta-label">To</span> ${toStr}</div>
          <div class="gmail-reading-meta"><span class="gmail-reading-meta-label">Date</span> ${this.esc(new Date(m.date).toLocaleString())}</div>
        </section>
        <div class="gmail-reading-body" id="gmail-reading-body"></div>
      </div>
    `;

    this.mountMessageBody(m);

    readingEl.querySelector('#gmail-back').addEventListener('click', () => this.closeMessage());
    readingEl.querySelector('#gmail-action-reply').addEventListener('click', () => this.openCompose({ mode: 'reply', originalMessage: m }));
    readingEl.querySelector('#gmail-action-reply-all').addEventListener('click', () => this.openCompose({ mode: 'replyAll', originalMessage: m }));
    readingEl.querySelector('#gmail-action-forward').addEventListener('click', () => this.openCompose({ mode: 'forward', originalMessage: m }));
    readingEl.querySelector('#gmail-action-star').addEventListener('click', () => this.toggleStar(m.uid));
    readingEl.querySelector('#gmail-action-archive').addEventListener('click', () => this.archiveMessage(m.uid));
    readingEl.querySelector('#gmail-action-trash').addEventListener('click', () => this.trashMessage(m.uid));
  },

  // === Phase 3: Compose / Reply / Forward ===================================

  _composeState: null,

  openCompose({ mode = 'new', originalMessage = null } = {}) {
    const state = this.buildComposeState(mode, originalMessage);
    this._composeState = state;

    // Mount the modal inside the main body so it overlays everything.
    let modal = document.getElementById('gmail-compose-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'gmail-compose-modal';
    modal.className = 'gmail-compose-modal';
    modal.innerHTML = this.composeModalHtml(state);
    document.body.appendChild(modal);
    this.wireComposeModal(modal, state);
  },

  buildComposeState(mode, orig) {
    const state = {
      mode,
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      bodyHtml: '',
      attachments: [],
      inReplyTo: null,
      references: null,
      showCcBcc: false,
    };
    const myEmail = (this._inboxState?.email || '').toLowerCase();

    if (mode === 'reply' && orig) {
      state.to = orig.from?.[0]?.address ? [orig.from[0].address] : [];
      state.subject = orig.subject?.startsWith('Re: ') ? orig.subject : `Re: ${orig.subject || ''}`;
      state.inReplyTo = orig.messageId || null;
      state.references = this.joinReferences(orig.references, orig.messageId);
      state.bodyHtml = this.quoteOriginal(orig);
    } else if (mode === 'replyAll' && orig) {
      const fromAddr = orig.from?.[0]?.address;
      state.to = fromAddr ? [fromAddr] : [];
      const cc = [];
      for (const a of (orig.to || [])) {
        if (a.address && a.address.toLowerCase() !== myEmail && a.address !== fromAddr) cc.push(a.address);
      }
      for (const a of (orig.cc || [])) {
        if (a.address && a.address.toLowerCase() !== myEmail && a.address !== fromAddr) cc.push(a.address);
      }
      state.cc = cc;
      state.showCcBcc = cc.length > 0;
      state.subject = orig.subject?.startsWith('Re: ') ? orig.subject : `Re: ${orig.subject || ''}`;
      state.inReplyTo = orig.messageId || null;
      state.references = this.joinReferences(orig.references, orig.messageId);
      state.bodyHtml = this.quoteOriginal(orig);
    } else if (mode === 'forward' && orig) {
      state.subject = orig.subject?.startsWith('Fwd: ') ? orig.subject : `Fwd: ${orig.subject || ''}`;
      state.bodyHtml = this.quoteOriginal(orig);
    }
    return state;
  },

  joinReferences(prev, msgId) {
    const refs = [];
    if (prev) refs.push(prev);
    if (msgId) refs.push(msgId);
    return refs.length ? refs.join(' ') : null;
  },

  quoteOriginal(orig) {
    const fromName = orig.from?.[0]?.name || orig.from?.[0]?.address || '(sender)';
    const when = orig.date ? new Date(orig.date).toLocaleString() : '';
    // Use main-process-sanitized HTML when available; fall back to escaped text.
    const quoted = orig.htmlSanitized || this.esc(orig.text || '').replace(/\n/g, '<br>');
    return `<br><br><blockquote style="border-left: 3px solid #dadce0; margin: 0; padding-left: 12px; color: #5f6368;"><p>On ${this.esc(when)}, ${this.esc(fromName)} wrote:</p>${quoted}</blockquote>`;
  },

  composeModalHtml(state) {
    const title = state.mode === 'new' ? 'New message'
      : state.mode === 'reply' ? 'Reply'
      : state.mode === 'replyAll' ? 'Reply all'
      : 'Forward';
    return `
      <div class="gmail-compose-backdrop"></div>
      <div class="gmail-compose-card">
        <header class="gmail-compose-header">
          <span>${title}</span>
          <button class="gmail-icon-btn" id="gmail-compose-close" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="gmail-compose-fields">
          <div class="gmail-compose-row">
            <label>To</label>
            <input type="text" id="gmail-to" value="${this.esc(state.to.join(', '))}" placeholder="recipient@example.com" autocomplete="off" spellcheck="false">
            <button type="button" class="gmail-compose-toggle" id="gmail-toggle-cc">${state.showCcBcc ? 'Hide' : 'Cc Bcc'}</button>
          </div>
          <div class="gmail-compose-row gmail-cc-row" ${state.showCcBcc ? '' : 'hidden'}>
            <label>Cc</label>
            <input type="text" id="gmail-cc" value="${this.esc(state.cc.join(', '))}" placeholder="" autocomplete="off" spellcheck="false">
          </div>
          <div class="gmail-compose-row gmail-bcc-row" ${state.showCcBcc ? '' : 'hidden'}>
            <label>Bcc</label>
            <input type="text" id="gmail-bcc" value="${this.esc(state.bcc.join(', '))}" placeholder="" autocomplete="off" spellcheck="false">
          </div>
          <div class="gmail-compose-row">
            <label>Subject</label>
            <input type="text" id="gmail-subject" value="${this.esc(state.subject)}" placeholder="Subject" autocomplete="off" spellcheck="false">
          </div>
        </div>
        <div class="gmail-compose-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
          <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">&#8226;</button>
          <button type="button" data-cmd="insertOrderedList" title="Numbered list">1.</button>
          <button type="button" id="gmail-cmd-link" title="Insert link">&#128279;</button>
        </div>
        <div class="gmail-compose-body" id="gmail-compose-body" contenteditable="true">${state.bodyHtml}</div>
        <div class="gmail-compose-attachments" id="gmail-compose-attachments"></div>
        <footer class="gmail-compose-footer">
          <button type="button" class="gmail-btn-secondary" id="gmail-compose-attach">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            Attach
          </button>
          <div class="gmail-compose-footer-spacer"></div>
          <button type="button" class="gmail-btn-secondary" id="gmail-compose-cancel">Cancel</button>
          <button type="button" class="gmail-btn-primary" id="gmail-compose-send" disabled>Send</button>
        </footer>
        <div class="gmail-compose-status" id="gmail-compose-status"></div>
      </div>
    `;
  },

  wireComposeModal(modal, state) {
    const $ = (sel) => modal.querySelector(sel);

    const toInput = $('#gmail-to');
    const ccInput = $('#gmail-cc');
    const bccInput = $('#gmail-bcc');
    const subjInput = $('#gmail-subject');
    const bodyEl = $('#gmail-compose-body');
    const sendBtn = $('#gmail-compose-send');
    const statusEl = $('#gmail-compose-status');
    const attachEl = $('#gmail-compose-attachments');

    const validate = () => {
      const hasTo = this.parseAndValidateAddrs(toInput).length > 0;
      this.parseAndValidateAddrs(ccInput);
      this.parseAndValidateAddrs(bccInput);
      const hasSubject = subjInput.value.trim().length > 0;
      sendBtn.disabled = !(hasTo && hasSubject);
    };

    [toInput, ccInput, bccInput, subjInput].forEach(el => el.addEventListener('input', validate));
    validate();

    // Focus: new message → To; reply/forward → body top
    setTimeout(() => {
      if (state.mode === 'new') toInput.focus();
      else {
        bodyEl.focus();
        // Place cursor at the very start (user types above the quoted block)
        const range = document.createRange();
        range.setStart(bodyEl, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 0);

    // Close / Cancel / backdrop
    const close = () => { modal.remove(); this._composeState = null; };
    $('#gmail-compose-close').addEventListener('click', close);
    $('#gmail-compose-cancel').addEventListener('click', close);
    modal.querySelector('.gmail-compose-backdrop').addEventListener('click', close);

    // Cc/Bcc toggle
    $('#gmail-toggle-cc').addEventListener('click', (e) => {
      state.showCcBcc = !state.showCcBcc;
      modal.querySelector('.gmail-cc-row').hidden = !state.showCcBcc;
      modal.querySelector('.gmail-bcc-row').hidden = !state.showCcBcc;
      e.currentTarget.textContent = state.showCcBcc ? 'Hide' : 'Cc Bcc';
    });

    // Toolbar
    modal.querySelectorAll('.gmail-compose-toolbar button[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor selection
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        bodyEl.focus();
      });
    });
    $('#gmail-cmd-link').addEventListener('mousedown', (e) => e.preventDefault());
    $('#gmail-cmd-link').addEventListener('click', () => {
      const url = prompt('Link URL:');
      if (!url) return;
      const safe = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      document.execCommand('createLink', false, safe);
      bodyEl.focus();
    });

    // Attachments
    const renderAttachments = () => {
      attachEl.innerHTML = state.attachments.map((a, i) => `
        <div class="gmail-attach-chip">
          <span class="gmail-attach-name">${this.esc(a.filename)}</span>
          <span class="gmail-attach-size">${this.formatSize(a.size)}</span>
          <button type="button" class="gmail-attach-remove" data-i="${i}" title="Remove">&times;</button>
        </div>
      `).join('');
      attachEl.querySelectorAll('.gmail-attach-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          state.attachments.splice(parseInt(btn.dataset.i, 10), 1);
          renderAttachments();
        });
      });
    };
    $('#gmail-compose-attach').addEventListener('click', async () => {
      const result = await window.vexGmail.pickAttachments();
      const picked = result.files || [];
      if (!picked.length) return;
      // Pre-check 25 MB combined cap in the UI for early feedback.
      const total = state.attachments.concat(picked).reduce((s, a) => s + (a.size || 0), 0);
      if (total > 25 * 1024 * 1024) {
        if (typeof window.showToast === 'function') window.showToast('Gmail limit is 25MB total');
        return;
      }
      state.attachments = state.attachments.concat(picked);
      renderAttachments();
    });
    renderAttachments();

    // Send
    sendBtn.addEventListener('click', async () => {
      const to = this.parseAndValidateAddrs(toInput);
      const cc = this.parseAndValidateAddrs(ccInput);
      const bcc = this.parseAndValidateAddrs(bccInput);
      if (!to.length) { statusEl.textContent = 'At least one recipient required'; statusEl.className = 'gmail-compose-status error'; return; }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      statusEl.textContent = 'Sending via SMTP…';
      statusEl.className = 'gmail-compose-status pending';

      // Sanitize user HTML with the same pipeline as incoming email —
      // contenteditable output can contain surprising junk (pasted styles, empty divs).
      const rawHtml = bodyEl.innerHTML;

      const result = await window.vexGmail.send({
        to, cc, bcc,
        subject: subjInput.value.trim(),
        html: rawHtml,
        text: bodyEl.innerText,
        attachments: state.attachments,
        inReplyTo: state.inReplyTo,
        references: state.references,
      });

      if (result.success) {
        if (typeof window.showToast === 'function') window.showToast('Message sent');
        close();
        // Refresh inbox in case the send also landed in INBOX.
        this.loadInbox({ initial: true });
      } else {
        statusEl.textContent = 'Send failed: ' + (result.error || 'unknown error');
        statusEl.className = 'gmail-compose-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    });
  },

  parseAndValidateAddrs(inputEl) {
    const raw = inputEl.value.trim();
    if (!raw) { inputEl.classList.remove('invalid'); return []; }
    const parts = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid = [];
    let anyInvalid = false;
    for (const p of parts) {
      // Accept "Name <email@x>" form — extract email part
      const m = p.match(/<([^>]+)>\s*$/);
      const addr = (m ? m[1] : p).trim();
      if (re.test(addr)) valid.push(addr);
      else anyInvalid = true;
    }
    inputEl.classList.toggle('invalid', anyInvalid);
    return valid;
  },

  formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  },

  mountMessageBody(m) {
    const bodyEl = this._inboxState.container.querySelector('#gmail-reading-body');
    // Main process already sanitized the HTML via DOMPurify+jsdom and attached
    // it as `htmlSanitized`. Fall back to plain text if the email had no HTML body.
    const sanitized = m.htmlSanitized;
    const text = m.text || '';

    if (sanitized) {
      const frame = document.createElement('iframe');
      frame.className = 'gmail-reading-frame';
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      // Gmail-like default template: white bg, system font, readable line-height.
      // CSP blocks script/font fetches but allows https/data/cid images and inline styles.
      frame.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:;">
<style>
  html, body { margin: 0; padding: 16px; background: #ffffff; color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote { border-left: 3px solid #dadce0; margin: 8px 0; padding-left: 12px; color: #5f6368; }
  pre { overflow-x: auto; background: #f1f3f4; padding: 8px; border-radius: 4px; font-family: 'Consolas', monospace; }
  table { max-width: 100%; }
</style>
</head>
<body>${sanitized}</body>
</html>`;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(frame);
    } else {
      bodyEl.innerHTML = `<pre class="gmail-reading-text">${this.esc(text)}</pre>`;
    }
  },

  closeMessage() {
    const s = this._inboxState;
    s.view = 'list';
    s.openMessage = null;
    const readingEl = s.container.querySelector('#gmail-reading');
    const listEl = s.container.querySelector('#gmail-list');
    readingEl.hidden = true;
    listEl.hidden = false;
    readingEl.innerHTML = '';
  },

  async toggleStar(uid) {
    const s = this._inboxState;
    const entry = s.messages.find(m => m.uid === uid);
    const current = entry?.flags.includes('\\Flagged') || s.openMessage?.flags.includes('\\Flagged');
    const next = !current;
    const r = await window.vexGmail.star(uid, next);
    if (!r.success) {
      if (typeof window.showToast === 'function') window.showToast('Star failed: ' + r.error);
      return;
    }
    if (entry) {
      if (next) entry.flags = [...new Set([...entry.flags, '\\Flagged'])];
      else entry.flags = entry.flags.filter(f => f !== '\\Flagged');
    }
    if (s.openMessage) {
      if (next) s.openMessage.flags = [...new Set([...s.openMessage.flags, '\\Flagged'])];
      else s.openMessage.flags = s.openMessage.flags.filter(f => f !== '\\Flagged');
      this.renderReadingPane();
    }
    this.renderMessageList();
  },

  async archiveMessage(uid) {
    const r = await window.vexGmail.archive(uid);
    if (!r.success) {
      if (typeof window.showToast === 'function') window.showToast('Archive failed: ' + r.error);
      return;
    }
    this._inboxState.messages = this._inboxState.messages.filter(m => m.uid !== uid);
    if (typeof window.showToast === 'function') window.showToast('Archived');
    this.closeMessage();
    this.renderMessageList();
  },

  async trashMessage(uid) {
    const r = await window.vexGmail.trash(uid);
    if (!r.success) {
      if (typeof window.showToast === 'function') window.showToast('Trash failed: ' + r.error);
      return;
    }
    this._inboxState.messages = this._inboxState.messages.filter(m => m.uid !== uid);
    if (typeof window.showToast === 'function') window.showToast('Moved to trash');
    this.closeMessage();
    this.renderMessageList();
  },

  async toggleReadFlag(uid) {
    const s = this._inboxState;
    const entry = s.messages.find(m => m.uid === uid);
    if (!entry) return;
    const currentlyRead = entry.flags.includes('\\Seen');
    const next = !currentlyRead;
    const r = await window.vexGmail.markRead(uid, next);
    if (!r.success) return;
    if (next) entry.flags = [...new Set([...entry.flags, '\\Seen'])];
    else entry.flags = entry.flags.filter(f => f !== '\\Seen');
    this.renderMessageList();
  },

  showRowContextMenu(e, uid) {
    document.querySelectorAll('.gmail-ctx-menu').forEach(m => m.remove());
    const entry = this._inboxState.messages.find(m => m.uid === uid);
    if (!entry) return;
    const read = entry.flags.includes('\\Seen');
    const starred = entry.flags.includes('\\Flagged');

    const menu = document.createElement('div');
    menu.className = 'gmail-ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: read ? 'Mark as unread' : 'Mark as read', action: () => this.toggleReadFlag(uid) },
      { label: starred ? 'Unstar' : 'Star', action: () => this.toggleStar(uid) },
      { label: 'Archive', action: () => this.archiveMessage(uid) },
      { label: 'Trash', action: () => this.trashMessage(uid), danger: true },
    ];
    items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'gmail-ctx-item' + (it.danger ? ' danger' : '');
      el.textContent = it.label;
      el.addEventListener('click', () => { it.action(); menu.remove(); });
      menu.appendChild(el);
    });
    document.body.appendChild(menu);
    setTimeout(() => {
      const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },

  // Settings-panel Email section — called whenever Settings opens.
  async renderSettingsSection() {
    const statusEl = document.getElementById('setting-gmail-status');
    const configureBtn = document.getElementById('setting-gmail-configure');
    const disconnectBtn = document.getElementById('setting-gmail-disconnect');
    if (!statusEl || !configureBtn || !disconnectBtn) return;

    const { configured } = await window.vexGmail.hasCredentials();
    if (configured) {
      const { email } = await window.vexGmail.getEmail();
      statusEl.textContent = `Connected as ${email || '(unknown)'}`;
      statusEl.style.color = 'var(--vex-success)';
      configureBtn.textContent = 'Reconfigure';
      disconnectBtn.hidden = false;
    } else {
      statusEl.textContent = 'Not configured';
      statusEl.style.color = 'var(--vex-text-muted)';
      configureBtn.textContent = 'Configure';
      disconnectBtn.hidden = true;
    }

    configureBtn.onclick = () => SidebarManager.openPanel('gmail');
    disconnectBtn.onclick = async () => {
      if (!confirm('Disconnect Gmail? This removes your stored app password.')) return;
      await window.vexGmail.clearCredentials();
      if (typeof window.showToast === 'function') window.showToast('Gmail disconnected');
      this.renderSettingsSection();
    };
  },
};
