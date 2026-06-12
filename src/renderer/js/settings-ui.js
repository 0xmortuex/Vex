// === Vex Settings UI enhancer ===
// Turns the flat list of .setting-group blocks into vivid, color-coded category
// cards and builds a sticky chip-nav to jump between them. Pure presentation —
// it never touches the existing inputs/ids, so all settings handlers keep working.
// Called by SidebarManager.showPanel whenever Settings opens (idempotent).

const SettingsUI = {
  CATS: [
    { name: 'General',     emoji: '🔍', color: '#6366f1', match: ['general', 'search engine'] },
    { name: 'Browser',     emoji: '🌐', color: '#0ea5e9', match: ['default browser'] },
    { name: 'Appearance',  emoji: '🎨', color: '#a855f7', match: ['appearance', 'theme'] },
    { name: 'Privacy',     emoji: '🛡️', color: '#22c55e', match: ['privacy', 'security'] },
    { name: 'Performance', emoji: '⚡', color: '#f97316', match: ['performance', 'sleep'] },
    { name: 'Sessions',    emoji: '💾', color: '#f59e0b', match: ['session'] },
    { name: 'Workspaces',  emoji: '🗂️', color: '#14b8a6', match: ['workspace'] },
    { name: 'Location',    emoji: '📍', color: '#ef4444', match: ['location'] },
    { name: 'Sync',        emoji: '🔄', color: '#06b6d4', match: ['sync'] },
    { name: 'AI',          emoji: '✦', color: '#d4a574', match: ['ai backend', 'ai b', 'assistant'] },
    { name: 'Personas',    emoji: '🎭', color: '#8b5cf6', match: ['persona'] },
    { name: 'AI Memory',   emoji: '🧠', color: '#c084fc', match: ['ai memory'] },
    { name: 'Skills',      emoji: '⚡', color: '#fbbf24', match: ['skill'] },
    { name: 'Boosts',      emoji: '🎨', color: '#f472b6', match: ['boost'] },
    { name: 'Passwords',   emoji: '🔑', color: '#34d399', match: ['password'] },
    { name: 'Focus',       emoji: '🎯', color: '#fb7185', match: ['focus'] },
    { name: 'Library',     emoji: '📚', color: '#38bdf8', match: ['library'] },
    { name: 'Reading',     emoji: '📖', color: '#818cf8', match: ['reading', 'accessibility'] },
    { name: 'Recall',      emoji: '🔎', color: '#2dd4bf', match: ['recall'] },
    { name: 'Chains',      emoji: '⛓', color: '#a3a3a3', match: ['chain'] },
    { name: 'Extras',      emoji: '🖱', color: '#60a5fa', match: ['browsing extras', 'gesture'] },
    { name: 'Extensions',  emoji: '🧩', color: '#10b981', match: ['extension'] },
    { name: 'Permissions', emoji: '🔐', color: '#eab308', match: ['permission'] },
    { name: 'Data',        emoji: '📦', color: '#ec4899', match: ['data', 'reset', 'export'] },
    { name: 'About',       emoji: 'ℹ️', color: '#64748b', match: ['about', 'version', 'update'] },
  ],

  _matchCat(text) {
    for (const c of this.CATS) {
      if (c.match.some(m => text.includes(m))) return c;
    }
    return { name: 'Other', emoji: '⚙️', color: 'var(--primary)' };
  },

  enhance() {
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return;
    const groups = Array.from(root.children).filter(el => el.classList && el.classList.contains('setting-group'));
    if (!groups.length) return;

    // (Re)build the sticky chip nav right under the <h2>.
    let nav = root.querySelector('.set-nav');
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'set-nav';
      const h2 = root.querySelector('h2');
      if (h2) h2.insertAdjacentElement('afterend', nav);
      else root.insertBefore(nav, root.firstChild);
    }
    nav.innerHTML = '';
    const seen = new Set();

    groups.forEach((g, i) => {
      const labelEl = g.querySelector('.setting-label');
      const text = (labelEl ? labelEl.textContent : '').toLowerCase();
      const cat = this._matchCat(text);
      g.style.setProperty('--cat-color', cat.color);
      if (!g.id) g.id = 'setcat-' + i;

      if (labelEl && !labelEl.querySelector('.set-emoji')) {
        const chip = document.createElement('span');
        chip.className = 'set-emoji';
        chip.textContent = cat.emoji;
        labelEl.insertBefore(chip, labelEl.firstChild);
      }

      if (!seen.has(cat.name)) {
        seen.add(cat.name);
        const navChip = document.createElement('button');
        navChip.className = 'set-nav-chip';
        navChip.style.setProperty('--chip-color', cat.color);
        navChip.innerHTML = '<span>' + cat.emoji + '</span><span>' + cat.name + '</span>';
        navChip.addEventListener('click', () => g.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        nav.appendChild(navChip);
      }
    });
  },
};

if (typeof window !== 'undefined') window.SettingsUI = SettingsUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsUI };
