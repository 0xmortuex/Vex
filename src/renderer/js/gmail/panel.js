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

  async renderConnected(container) {
    const { email } = await window.vexGmail.getEmail();
    container.innerHTML = `
      <div class="gmail-root">
        <div class="gmail-card">
          <div class="gmail-card-header">
            <div class="gmail-card-icon">\u{2709}</div>
            <div>
              <h2>Gmail</h2>
              <p>Signed in as <strong>${this.esc(email || '')}</strong></p>
            </div>
          </div>
          <div class="gmail-placeholder">
            <div class="gmail-placeholder-title">Inbox coming in Phase 2</div>
            <div class="gmail-placeholder-sub">
              IMAP foundation is wired. Message list, read, compose, and reply are next.
            </div>
          </div>
          <div class="gmail-actions">
            <button class="gmail-btn-danger" id="gmail-disconnect-btn">Disconnect</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#gmail-disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect Gmail? This removes your stored app password.')) return;
      await window.vexGmail.clearCredentials();
      if (typeof window.showToast === 'function') window.showToast('Gmail disconnected');
      this.render(container);
    });
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
