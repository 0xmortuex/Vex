// === Vex Mobile — the desktop's notes ===
//
// The desktop's Notes panel keeps freeform documents (localStorage
// 'vex.notes'): a title, Markdown content, pinned, tags, where it was clipped
// from, and two ISO times. Vex Sync carries them item by item, and this is the
// phone's copy of that list (VexStore 'vex.syncNotes'), kept in the desktop's
// exact shape — js/sync.js sends an unchanged note back as the very object it
// received, fields this version has never heard of included.
//
// They are not the phone's own notes (js/notes.js), which are passages pinned
// to a page and stay on the phone.

const VexSyncedNotes = (() => {
  const SOURCE = 'preference:vex.notes';

  function list() {
    const stored = VexStore.get('vex.syncNotes', []);
    return Array.isArray(stored) ? stored.filter(note => note && typeof note === 'object') : [];
  }

  // The desktop reads notes through a normaliser (notes-panel.js normalize),
  // so these are the fields and types it expects.
  const text = value => (typeof value === 'string' ? value : '');

  function newId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  async function save(next) {
    await VexStore.set('vex.syncNotes', next);
    if (typeof VexSync !== 'undefined') VexSync.schedulePush();
  }

  return {
    SOURCE,
    list,

    /** Pinned first, then the most recently edited — the desktop's order. */
    sorted(query = '') {
      const needle = String(query || '').trim().toLowerCase();
      const time = value => Date.parse(value || '') || 0;
      return list()
        .filter(note => !needle || (text(note.title) + '\n' + text(note.content)).toLowerCase().includes(needle))
        .sort((a, b) => (!!b.pinned - !!a.pinned) || time(b.updatedAt) - time(a.updatedAt));
    },

    get(id) { return list().find(note => note.id === id) || null; },

    async create({ title = '', content = '' } = {}) {
      const now = new Date().toISOString();
      const note = {
        id: newId(), title: text(title), content: text(content), pinned: false, tags: [],
        sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now
      };
      await save([...list(), note]);
      return note;
    },

    /** Change a note, keeping every other field it has, in its order. */
    async update(id, patch) {
      let changed = null;
      const next = list().map(note => {
        if (note.id !== id) return note;
        const fields = {};
        if ('title' in patch) fields.title = text(patch.title);
        if ('content' in patch) fields.content = text(patch.content);
        if ('pinned' in patch) fields.pinned = !!patch.pinned;
        const same = Object.keys(fields).every(key => note[key] === fields[key]);
        if (same) { changed = note; return note; }
        changed = { ...note, ...fields, updatedAt: new Date().toISOString() };
        return changed;
      });
      if (changed) await save(next);
      return changed;
    },

    async remove(id) {
      const note = this.get(id);
      if (!note) return null;
      await VexStore.set('vex.syncNotes', list().filter(other => other.id !== id));
      if (typeof VexSync !== 'undefined') {
        await VexSync.noteDeleted(SOURCE, [id]);
        VexSync.schedulePush();
      }
      return note;
    },

    /** Undo a delete that may not have been sent yet. */
    async restore(note) {
      if (!note || !note.id || this.get(note.id)) return;
      await VexStore.set('vex.syncNotes', [...list(), note]);
      if (typeof VexSync !== 'undefined') {
        await VexSync.noteRestored(SOURCE, [note.id]);
        VexSync.schedulePush();
      }
    },

    /** A line for the list: the title, or the first words of the note. */
    label(note) {
      const title = text(note.title).trim();
      if (title) return title;
      const first = text(note.content).replace(/[#>*_`\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      return first.slice(0, 80) || 'Untitled';
    }
  };
})();

if (typeof window !== 'undefined') window.VexSyncedNotes = VexSyncedNotes;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSyncedNotes };
