// === CUSA Workspace Panel ===

const CUSAPanel = {
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
          <div class="panel-section-title">My Bills / Drafts</div>
          <div class="panel-placeholder">
            <p>No drafts yet. Open BillForge to create one.</p>
            <button class="panel-btn" id="cusa-open-billforge">
              \u{1F528} Open BillForge
            </button>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Recent CUSA Activity</div>
          <div class="panel-placeholder">
            <p>Coming in Phase 3: live feed from CUSA Discord announcements</p>
          </div>
        </div>
      </div>
    `;

    // Render quick links
    const grid = panel.querySelector('#cusa-quick-links');
    this.quickLinks.forEach(link => {
      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <div class="panel-card-icon">${link.icon}</div>
        <div class="panel-card-label">${link.label}</div>
      `;
      card.addEventListener('click', () => {
        SidebarManager.hideActivePanel();
        link.action();
      });
      grid.appendChild(card);
    });

    // BillForge button
    panel.querySelector('#cusa-open-billforge').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      VexTools.openToolById('billforge');
    });
  }
};
