// === Roblox Hub Panel ===

const RobloxPanel = {
  quickActions: [
    { icon: '\u{1F3E0}', label: 'Home', url: 'https://www.roblox.com/home' },
    { icon: '\u{1F3AE}', label: 'Games', url: 'https://www.roblox.com/discover' },
    { icon: '\u{1F465}', label: 'Friends', url: 'https://www.roblox.com/users/friends' },
    { icon: '\u{1F4B0}', label: 'Trade', url: 'https://www.roblox.com/trades' },
    { icon: '\u{1F6D2}', label: 'Catalog', url: 'https://www.roblox.com/catalog' },
    { icon: '\u{1F4CA}', label: 'Groups', url: 'https://www.roblox.com/communities' }
  ],

  init() {
    this.render();
  },

  render() {
    const panel = document.getElementById('panel-roblox');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="panel-content">
        <div class="roblox-header">
          <h2>\u{1F3AE} Roblox <span>Hub</span></h2>
        </div>

        <div class="roblox-btn-row">
          <button class="roblox-btn primary" id="roblox-open-home">\u{1F3E0} Open Roblox</button>
          <button class="roblox-btn secondary" id="roblox-open-studio">\u{1F528} Launch Studio</button>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Quick Actions</div>
          <div class="panel-grid cols-3" id="roblox-actions"></div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Trade Tracker</div>
          <div class="panel-placeholder">
            <p>Trade tracking coming soon</p>
          </div>
        </div>
      </div>
    `;

    // Quick actions
    const grid = panel.querySelector('#roblox-actions');
    this.quickActions.forEach(action => {
      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <div class="panel-card-icon">${action.icon}</div>
        <div class="panel-card-label">${action.label}</div>
      `;
      card.addEventListener('click', () => {
        SidebarManager.hideActivePanel();
        TabManager.createTab(action.url, true);
      });
      grid.appendChild(card);
    });

    // Buttons
    panel.querySelector('#roblox-open-home').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      TabManager.createTab('https://www.roblox.com/home', true);
    });
    panel.querySelector('#roblox-open-studio').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      TabManager.createTab('https://www.roblox.com/create', true);
    });
  }
};
