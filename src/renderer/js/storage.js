// === Vex Storage Layer ===
// Persists tabs, groups, settings, and history via IPC to main process

const VexStorage = {
  async save(key, data) {
    return await window.vex.saveData(key, data);
  },

  async load(key) {
    return await window.vex.loadData(key);
  },

  async saveTabs(tabs) {
    const serialized = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      pinned: t.pinned || false,
      groupId: t.groupId || null
    }));
    return this.save('tabs', serialized);
  },

  async loadTabs() {
    return (await this.load('tabs')) || [];
  },

  async saveGroups(groups) {
    return this.save('groups', groups);
  },

  async loadGroups() {
    return (await this.load('groups')) || [];
  },

  async saveSettings(settings) {
    return this.save('settings', settings);
  },

  async loadSettings() {
    return (await this.load('settings')) || {
      searchEngine: 'google',
      adBlocker: true,
      tabsVisible: true
    };
  },

  async addHistory(entry) {
    const history = await this.loadHistory();
    history.unshift({
      url: entry.url,
      title: entry.title,
      time: Date.now()
    });
    // Keep last 500
    if (history.length > 500) history.length = 500;
    return this.save('history', history);
  },

  async loadHistory() {
    return (await this.load('history')) || [];
  },

  async saveShortcuts(shortcuts) {
    return this.save('shortcuts', shortcuts);
  },

  async loadShortcuts() {
    return await this.load('shortcuts');
  }
};
