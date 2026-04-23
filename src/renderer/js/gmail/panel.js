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
    readingEl.querySelector('#gmail-action-star').addEventListener('click', () => this.toggleStar(m.uid));
    readingEl.querySelector('#gmail-action-archive').addEventListener('click', () => this.archiveMessage(m.uid));
    readingEl.querySelector('#gmail-action-trash').addEventListener('click', () => this.trashMessage(m.uid));
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
