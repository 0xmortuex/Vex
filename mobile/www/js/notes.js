// === Vex Mobile — notes ===
//
// A note is attached to a page. The desktop keeps a notes panel; on a phone
// the useful version is smaller: select something and keep it, or write a line
// about the page you are on, and find it again from the page or from the list.
//
// Notes live in IndexedDB beside history because they can be long, and they
// are not synced: a note is usually about something you were doing on this
// device, and the sync blob is small.

const VexNotes = (() => {
  return {
    async add({ url, title, text, kind = 'note' }) {
      const clean = String(text || '').trim();
      if (!clean) return null;
      const record = {
        url: url || '',
        host: url ? VexSearch.prettyHost(url) : '',
        title: title || '',
        text: clean.slice(0, 20000),
        kind,                      // 'note' or 'quote' (kept from a selection)
        at: Date.now()
      };
      record.id = await VexDB.add('notes', record);
      return record;
    },

    all(limit = 300) { return VexDB.scan('notes', { limit }); },

    forHost(host, limit = 50) {
      return VexDB.scan('notes', { limit, match: row => row.host === host });
    },

    async count(host) {
      const rows = await this.forHost(host, 100);
      return rows.length;
    },

    remove(id) { return VexDB.delete('notes', id); },

    clear() { return VexDB.clear('notes'); },

    async search(query, limit = 200) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return this.all(limit);
      return VexDB.scan('notes', {
        limit,
        match: row => (row.text + ' ' + (row.title || '') + ' ' + (row.host || '')).toLowerCase().includes(needle)
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexNotes = VexNotes;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNotes };
