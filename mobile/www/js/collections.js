// === Vex Mobile — the things you keep ===
//
// Bookmarks (in folders), the reading list, saved sessions, the quick-access
// tiles on the start page, and tab groups. They share a file because they
// share a shape — a small, ordered list of pages you named — and because three
// of them travel to the desktop, which means their records have to be exactly
// the shapes the desktop writes:
//
//   vex.bookmarks  { id, url, title, folder, at }        — folder is a name
//   vex.sessions   { id, name, createdAt, tabs[], groups[], activeTabIndex }
//   vex.readingList{ id, url, title, at, read }
//
// Tab groups and quick access are phone-only, so they live under their own
// keys and the desktop ignores them.

const VexCollections = (() => {
  function id(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function list(key) {
    const value = VexStore.get(key, []);
    return Array.isArray(value) ? value : [];
  }

  const bookmarks = {
    all() { return list('vex.bookmarks'); },

    folders() {
      const names = new Set();
      for (const entry of this.all()) if (entry.folder) names.add(entry.folder);
      for (const name of list('vex.bookmarkFolders')) names.add(name);
      return [...names].sort((a, b) => a.localeCompare(b));
    },

    has(url) { return this.all().some(entry => entry.url === url); },

    get(url) { return this.all().find(entry => entry.url === url) || null; },

    async add({ url, title, icon, folder }) {
      if (!url || url === 'about:blank') return null;
      const existing = this.get(url);
      if (existing) return existing;
      const entry = {
        id: id('bm_'), url, title: title || url,
        folder: (folder || '').trim(), at: Date.now(), icon: icon || ''
      };
      const next = [entry, ...this.all()];
      await VexStore.set('vex.bookmarks', next.slice(0, 5000));
      return entry;
    },

    async remove(url) {
      await VexStore.set('vex.bookmarks', this.all().filter(entry => entry.url !== url));
    },

    /**
     * Put back one that was removed, exactly as it was — its id, its folder, its
     * date — rather than adding a new one with today's. Undo has to be undo.
     */
    async restore(entry) {
      if (!entry || !entry.url || this.has(entry.url)) return null;
      await VexStore.set('vex.bookmarks', [entry, ...this.all()].slice(0, 5000));
      return entry;
    },

    async update(bookmarkId, patch) {
      const next = this.all().map(entry => (entry.id === bookmarkId ? Object.assign({}, entry, patch) : entry));
      await VexStore.set('vex.bookmarks', next);
    },

    async move(bookmarkId, folder) { return this.update(bookmarkId, { folder: (folder || '').trim() }); },

    async addFolder(name) {
      const clean = String(name || '').trim();
      if (!clean) return null;
      const folders = new Set(list('vex.bookmarkFolders'));
      folders.add(clean);
      await VexStore.set('vex.bookmarkFolders', [...folders]);
      return clean;
    },

    /** A folder is a name the bookmarks carry, so renaming it renames theirs. */
    async renameFolder(from, to) {
      const name = String(to || '').trim();
      if (!name || name === from) return null;
      await VexStore.set('vex.bookmarkFolders', [...new Set(list('vex.bookmarkFolders')
        .map(folder => (folder === from ? name : folder)).concat([name]))]);
      await VexStore.set('vex.bookmarks', this.all().map(entry =>
        entry.folder === from ? Object.assign({}, entry, { folder: name }) : entry));
      return name;
    },

    async removeFolder(name) {
      await VexStore.set('vex.bookmarkFolders', list('vex.bookmarkFolders').filter(folder => folder !== name));
      // The bookmarks survive the folder: they fall back to Unsorted rather
      // than disappearing with it.
      await VexStore.set('vex.bookmarks', this.all().map(entry =>
        entry.folder === name ? Object.assign({}, entry, { folder: '' }) : entry));
    },

    // Grouped for the panel: Unsorted first, then folders alphabetically.
    grouped(query = '') {
      const needle = query.trim().toLowerCase();
      const matching = this.all().filter(entry =>
        !needle || (entry.title + ' ' + entry.url + ' ' + (entry.folder || '')).toLowerCase().includes(needle));
      const groups = new Map();
      for (const entry of matching) {
        const name = entry.folder || '';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(entry);
      }
      return [...groups.entries()].sort((a, b) => {
        if (!a[0]) return -1;
        if (!b[0]) return 1;
        return a[0].localeCompare(b[0]);
      });
    },

    // Netscape bookmark file — what every browser imports.
    exportHtml() {
      const escape = text => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
      for (const [folder, entries] of this.grouped()) {
        if (folder) lines.push('  <DT><H3>' + escape(folder) + '</H3>', '  <DL><p>');
        for (const entry of entries) {
          lines.push('    <DT><A HREF="' + escape(entry.url) + '" ADD_DATE="'
            + Math.floor((entry.at || Date.now()) / 1000) + '">' + escape(entry.title) + '</A>');
        }
        if (folder) lines.push('  </DL><p>');
      }
      lines.push('</DL><p>');
      return lines.join('\n');
    },

    // Imports the same file, from any browser, folders included.
    async importHtml(html) {
      const found = [];
      let folder = '';
      const pattern = /<H3[^>]*>([^<]*)<\/H3>|<A[^>]+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
      let match;
      while ((match = pattern.exec(String(html || '')))) {
        if (match[1] != null) { folder = match[1].trim(); continue; }
        const url = match[2];
        if (!/^https?:/i.test(url)) continue;
        found.push({ url, title: (match[3] || url).trim(), folder });
      }
      const existing = new Set(this.all().map(entry => entry.url));
      const fresh = found
        .filter(entry => !existing.has(entry.url))
        .map(entry => ({ id: id('bm_'), url: entry.url, title: entry.title, folder: entry.folder, at: Date.now(), icon: '' }));
      if (fresh.length) await VexStore.set('vex.bookmarks', [...fresh, ...this.all()].slice(0, 5000));
      return fresh.length;
    }
  };

  const reading = {
    all() { return list('vex.readingList'); },

    has(url) { return this.all().some(entry => entry.url === url); },

    async add({ url, title, icon }) {
      if (!url || this.has(url)) return null;
      const entry = { id: id('rl_'), url, title: title || url, icon: icon || '', at: Date.now(), read: false };
      await VexStore.set('vex.readingList', [entry, ...this.all()].slice(0, 500));
      return entry;
    },

    async remove(url) {
      await VexStore.set('vex.readingList', this.all().filter(entry => entry.url !== url));
    },

    async restore(entry) {
      if (!entry || !entry.url || this.has(entry.url)) return null;
      await VexStore.set('vex.readingList', [entry, ...this.all()].slice(0, 500));
      return entry;
    },

    async markRead(url, read = true) {
      await VexStore.set('vex.readingList', this.all().map(entry =>
        entry.url === url ? Object.assign({}, entry, { read }) : entry));
    },

    unread() { return this.all().filter(entry => !entry.read); }
  };

  const sessions = {
    all() { return list('vex.sessions'); },

    // The desktop's shape, so a session saved on the phone opens on the PC.
    async save(name, tabs) {
      const snapshot = (tabs || []).filter(tab => !tab.incognito && tab.url && tab.url !== 'about:blank')
        .map(tab => ({ url: tab.url, title: tab.title || '', partition: 'persist:main' }));
      if (!snapshot.length) throw new Error('There is nothing to save — a private tab is never collected');
      const session = {
        id: id('sess_'),
        name: name || 'Session ' + new Date().toLocaleString(),
        createdAt: new Date().toISOString(),
        tabs: snapshot,
        groups: [],
        activeTabIndex: 0
      };
      await VexStore.set('vex.sessions', [session, ...this.all()].slice(0, 50));
      return session;
    },

    async remove(sessionId) {
      await VexStore.set('vex.sessions', this.all().filter(session => session.id !== sessionId));
    },

    async rename(sessionId, name) {
      await VexStore.set('vex.sessions', this.all().map(session =>
        session.id === sessionId ? Object.assign({}, session, { name }) : session));
    },

    async restore(session) {
      if (!session || !session.id || this.all().some(other => other.id === session.id)) return null;
      await VexStore.set('vex.sessions', [session, ...this.all()].slice(0, 50));
      return session;
    }
  };

  // The start page's tiles. Empty means "work it out from history"; once you
  // pin one, the grid is yours and stops rearranging itself under you.
  const quick = {
    all() { return list('vex.quickAccess'); },

    pinned() { return this.all().length > 0; },

    async add({ url, title, icon }) {
      if (!url) return null;
      if (this.all().some(entry => entry.url === url)) return null;
      const entry = { id: id('qa_'), url, title: title || VexSearch.prettyHost(url), icon: icon || '' };
      await VexStore.set('vex.quickAccess', [...this.all(), entry].slice(0, 24));
      return entry;
    },

    async remove(url) {
      await VexStore.set('vex.quickAccess', this.all().filter(entry => entry.url !== url));
    },

    async move(url, direction) {
      const entries = this.all();
      const index = entries.findIndex(entry => entry.url === url);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= entries.length) return;
      const [entry] = entries.splice(index, 1);
      entries.splice(target, 0, entry);
      await VexStore.set('vex.quickAccess', entries);
    }
  };

  // Tab groups are phone-local: they name a set of open tabs, and the ids
  // inside them mean nothing on another device.
  const groups = {
    all() { return list('vex.tabGroups'); },

    async create(name, tabIds) {
      const group = { id: id('grp_'), name: name || 'Group', color: pickColor(), tabIds: tabIds || [], at: Date.now() };
      await VexStore.set('vex.tabGroups', [...this.all(), group]);
      return group;
    },

    // A tab belongs to one group, and that is a property of the model rather
    // than something every caller has to remember: adding it here takes it out
    // of wherever it was.
    async addTab(groupId, tabId) {
      await VexStore.set('vex.tabGroups', this.all().map(group => {
        const without = group.tabIds.filter(other => other !== tabId);
        if (group.id !== groupId) return Object.assign({}, group, { tabIds: without });
        return Object.assign({}, group, { tabIds: [...without, tabId] });
      }));
    },

    // Taking a tab out does not delete the group here — but prune() runs every
    // time the switcher draws, so a group whose last tab you removed is gone by
    // the time you look at it. That is what Chrome does too, and it is the
    // reason the picker offers "New group…" rather than a list of empty ones.
    async removeTab(tabId) {
      await VexStore.set('vex.tabGroups', this.all()
        .map(group => Object.assign({}, group, { tabIds: group.tabIds.filter(other => other !== tabId) })));
    },

    // Drop groups with no open tabs left — called when the switcher draws, so
    // closing a group's last tab tidies up without anyone deciding to. It cannot
    // tell "you closed them" from "you moved the last one out"; both mean the
    // group is empty, and an empty group is not a group.
    async prune(openTabIds) {
      const open = new Set(openTabIds || []);
      const next = this.all()
        .map(group => Object.assign({}, group, { tabIds: group.tabIds.filter(id => open.has(id)) }))
        .filter(group => group.tabIds.length);
      if (JSON.stringify(next) !== JSON.stringify(this.all())) await VexStore.set('vex.tabGroups', next);
      return next;
    },

    async remove(groupId) {
      await VexStore.set('vex.tabGroups', this.all().filter(group => group.id !== groupId));
    },

    async rename(groupId, name) {
      await VexStore.set('vex.tabGroups', this.all().map(group =>
        group.id === groupId ? Object.assign({}, group, { name }) : group));
    },

    async recolour(groupId, color) {
      await VexStore.set('vex.tabGroups', this.all().map(group =>
        group.id === groupId ? Object.assign({}, group, { color }) : group));
    },

    COLORS: () => COLORS.slice(),

    of(tabId) { return this.all().find(group => group.tabIds.includes(tabId)) || null; }
  };

  const COLORS = ['#6366f1', '#2f6b3f', '#c2611a', '#9c2a1a', '#1e3a5f', '#8b5cf6', '#0ea5e9'];
  function pickColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

  return { bookmarks, reading, sessions, quick, groups, id };
})();

if (typeof window !== 'undefined') window.VexCollections = VexCollections;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCollections };
