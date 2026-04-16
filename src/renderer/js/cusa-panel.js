// === CUSA Workspace Panel ===

const CUSAPanel = {
  DISCORD_SERVER_ID: '', // Set in settings if widget is enabled

  quickLinks: [
    { icon: '\u{1F3DB}', label: 'CUSA Discord', action: () => TabManager.createTab('https://discord.com', true) },
    { icon: '\u{1F4DC}', label: 'Constitution', action: () => TabManager.createTab('https://docs.google.com/document/d/CUSA_Constitution', true) },
    { icon: '\u{2696}', label: 'Code of Justice', action: () => TabManager.createTab('https://docs.google.com/document/d/CUSA_CoJ', true) },
    { icon: '\u{1F528}', label: 'BillForge', action: () => VexTools.openToolById('billforge') },
    { icon: '\u{1F5FA}', label: 'LoopholeMap', action: () => VexTools.openToolById('loopholemap') }
  ],

  init() {
    this.render();
  },

  render() {
    const panel = document.getElementById('panel-cusa');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    // Load saved server ID
    this.DISCORD_SERVER_ID = localStorage.getItem('vex.cusa.discordServerId') || '';

    panel.innerHTML = `
      <div class="panel-content">
        <div class="panel-header">
          <h2>\u{2696}\uFE0F CUSA Workspace</h2>
          <p>Clockwork's United States of America — your legislative tools and documents</p>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Quick Links</div>
          <div class="panel-grid" id="cusa-quick-links"></div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Latest Announcements</div>
          <div id="cusa-announcements"></div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">My Bills / Drafts</div>
          <div class="panel-placeholder">
            <p>No drafts yet. Open BillForge to create one.</p>
            <button class="panel-btn" id="cusa-open-billforge">\u{1F528} Open BillForge</button>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Discord Server ID</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="cusa-discord-id" value="${this._esc(this.DISCORD_SERVER_ID)}" placeholder="Enter Discord server ID for widget..."
              style="flex:1;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'JetBrains Mono',monospace">
            <button id="cusa-discord-save" class="panel-btn" style="padding:8px 14px">Save</button>
          </div>
        </div>
      </div>
    `;

    // Render quick links
    const grid = panel.querySelector('#cusa-quick-links');
    this.quickLinks.forEach(link => {
      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `<div class="panel-card-icon">${link.icon}</div><div class="panel-card-label">${link.label}</div>`;
      card.addEventListener('click', () => { SidebarManager.hideActivePanel(); link.action(); });
      grid.appendChild(card);
    });

    // Render announcements
    this.renderAnnouncements();

    // BillForge button
    panel.querySelector('#cusa-open-billforge').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      VexTools.openToolById('billforge');
    });

    // Discord ID save
    panel.querySelector('#cusa-discord-save').addEventListener('click', () => {
      const id = panel.querySelector('#cusa-discord-id').value.trim();
      this.DISCORD_SERVER_ID = id;
      localStorage.setItem('vex.cusa.discordServerId', id);
      this.renderAnnouncements();
      window.showToast?.('Discord server ID saved');
    });
  },

  renderAnnouncements() {
    const container = document.getElementById('cusa-announcements');
    if (!container) return;

    if (this.DISCORD_SERVER_ID) {
      container.innerHTML = `
        <div style="border-radius:12px;overflow:hidden;border:1px solid var(--border)">
          <iframe src="https://discord.com/widget?id=${this._esc(this.DISCORD_SERVER_ID)}&theme=dark"
            width="100%" height="300" allowtransparency="true" frameborder="0"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            style="border:none;background:var(--surface);border-radius:12px"></iframe>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="panel-placeholder">
          <p>Configure your CUSA Discord Server ID below to see live announcements here.</p>
        </div>
      `;
    }
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
