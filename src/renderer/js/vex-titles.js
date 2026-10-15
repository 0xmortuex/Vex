// === Titles under the name =================================================
//
// A short line under the profile name that says something true about how the
// person uses Vex: "Tab Whisperer", "Inbox Zero Monk", "Night Owl". Each is
// unlocked by a medal (js/vex-medals.js) or a level (js/vex-unlock.js), so it
// is earned from real use, never from time on screen.
//
//   VexTitles.list()          [{ id, name, desc, unlock, owned, equipped, how }]
//   VexTitles.owned()         ids, in catalog order
//   VexTitles.current()       { id, name } or null (nothing equipped)
//   VexTitles.equip(id)       throws if not owned; equip(null) clears it
//   VexTitles.line()          the text to print under the name ('' when none)
//
// Event `vex:title-changed` {id}. Storage: localStorage `vex.title`.
// Titles are never taken away and never ranked against anyone.
const VexTitles = {
  KEY: 'vex.title',

  CATALOG: [
    { id: 'newcomer', name: 'Newcomer', desc: 'Everyone starts here.', unlock: { free: true } },
    { id: 'tab-whisperer', name: 'Tab Whisperer', desc: 'Keeps a big pile of tabs in order.', unlock: { medal: 'tab-whisperer' } },
    { id: 'inbox-zero-monk', name: 'Inbox Zero Monk', desc: 'Has cleared the inbox.', unlock: { medal: 'inbox-zero' } },
    { id: 'night-owl', name: 'Night Owl', desc: 'Does good work after dark.', unlock: { medal: 'night-owl' } },
    { id: 'early-bird', name: 'Early Bird', desc: 'Starts the day before most.', unlock: { medal: 'early-bird' } },
    { id: 'focus-keeper', name: 'Focus Keeper', desc: 'Finished a focus session.', unlock: { medal: 'first-focus' } },
    { id: 'deep-diver', name: 'Deep Diver', desc: 'Stayed with one thing for a long stretch.', unlock: { medal: 'deep-focus' } },
    { id: 'queue-clearer', name: 'Queue Clearer', desc: 'Read the whole reading queue.', unlock: { medal: 'queue-cleared' } },
    { id: 'shortcut-sage', name: 'Shortcut Sage', desc: 'Moves around Vex by keyboard.', unlock: { medal: 'keyboard-master' } },
    { id: 'command-captain', name: 'Command Captain', desc: 'Lives in the command bar.', unlock: { medal: 'command-bar-pro' } },
    { id: 'privacy-guardian', name: 'Privacy Guardian', desc: 'Set up the privacy protections.', unlock: { medal: 'privacy-first' } },
    { id: 'tracker-tamer', name: 'Tracker Tamer', desc: 'Has had a lot of trackers blocked.', unlock: { medal: 'trackers-blocked' } },
    { id: 'bookmark-curator', name: 'Bookmark Curator', desc: 'Keeps a tidy set of bookmarks.', unlock: { medal: 'bookmark-curator' } },
    { id: 'archive-keeper', name: 'Archive Keeper', desc: 'Saves pages worth keeping.', unlock: { medal: 'archivist' } },
    { id: 'theme-tinkerer', name: 'Theme Tinkerer', desc: 'Made Vex look the way they like.', unlock: { medal: 'theme-maker' } },
    { id: 'wayfinder', name: 'Wayfinder', desc: 'Tried a good number of Vex features.', unlock: { medal: 'explorer' } },
    { id: 'note-taker', name: 'Note Taker', desc: 'Writes things down.', unlock: { medal: 'note-taker' } },
    { id: 'password-hygienist', name: 'Password Hygienist', desc: 'Keeps passwords healthy.', unlock: { medal: 'password-health' } },
    { id: 'backup-believer', name: 'Backup Believer', desc: 'Backed everything up.', unlock: { medal: 'first-backup' } },
    { id: 'steady-hand', name: 'Steady Hand', desc: 'Comes back, day after day.', unlock: { medal: 'week-streak' } },
    { id: 'speed-reader', name: 'Speed Reader', desc: 'Cleared a list against the clock.', unlock: { medal: 'speed-run-first' } },
    { id: 'key-tapper', name: 'Key Tapper', desc: 'Practised the keyboard commands.', unlock: { medal: 'shortcut-trainer' } },
    { id: 'jingle-maker', name: 'Jingle Maker', desc: 'Composed a little tune for Vex.', unlock: { medal: 'jingle-composed' } },
    { id: 'quiet-mind', name: 'Quiet Mind', desc: 'Keeps the noise down.', unlock: { medal: 'quiet-mode' } },
    { id: 'level-headed', name: 'Level Headed', desc: 'Keeps Vex calm while gaming.', unlock: { medal: 'game-mode-first' } },
    { id: 'guided', name: 'Tour Guide', desc: 'Finished the tour.', unlock: { medal: 'tour-complete' } },
    { id: 'regular', name: 'Regular', desc: 'Reached level 5.', unlock: { level: 5 } },
    { id: 'veteran', name: 'Veteran', desc: 'Reached level 10.', unlock: { level: 10 } },
    { id: 'old-hand', name: 'Old Hand', desc: 'Reached level 20.', unlock: { level: 20 } },
  ],

  _unlock() {
    if (typeof VexUnlock === 'undefined') throw new Error('The unlock rules are not loaded');
    return VexUnlock;
  },

  _find(id) { return this.CATALOG.find(t => t.id === id) || null; },

  owned() {
    const ids = new Set(this._unlock().settle('title', this.CATALOG));
    return this.CATALOG.filter(t => ids.has(t.id)).map(t => t.id);
  },

  _stored() {
    try { return localStorage.getItem(this.KEY) || ''; }
    catch (err) { throw new Error('Could not read the title: ' + err.message, { cause: err }); }
  },

  current() {
    const id = this._stored();
    const t = id ? this._find(id) : null;
    if (!t || !this.owned().includes(id)) return null;
    return { id: t.id, name: t.name };
  },

  line() {
    const c = this.current();
    return c ? c.name : '';
  },

  list() {
    const own = new Set(this.owned());
    const cur = this.current();
    return this.CATALOG.map(t => ({
      id: t.id, name: t.name, desc: t.desc, unlock: t.unlock,
      owned: own.has(t.id), equipped: !!cur && cur.id === t.id,
      how: own.has(t.id) ? '' : this._unlock().describe(t.unlock),
    }));
  },

  equip(id) {
    if (id !== null && id !== '') {
      if (!this._find(id)) throw new Error('No title called ' + id);
      if (!this.owned().includes(id)) throw new Error('That title is not unlocked yet');
    }
    try {
      if (id) localStorage.setItem(this.KEY, id); else localStorage.removeItem(this.KEY);
    } catch (err) { throw new Error('Could not save the title: ' + err.message, { cause: err }); }
    try { document.dispatchEvent(new CustomEvent('vex:title-changed', { detail: { id: id || null } })); } catch { /* no document */ }
    return true;
  },

  referencedMedals() { return this._unlock().referenced(this.CATALOG.map(t => t.unlock)); },
};

if (typeof window !== 'undefined') window.VexTitles = VexTitles;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTitles };
