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

    /**
     * Everything you have kept, as Markdown. Markdown because a note is text
     * with a link attached and that is exactly what a Markdown list is: it opens
     * in anything, it is still readable if nothing opens it, and a quote kept
     * from a page comes back as a block quote.
     */
    async exportMarkdown() {
      const rows = await this.all(5000);
      const lines = ['# Notes from Vex', '',
        rows.length + (rows.length === 1 ? ' note' : ' notes') + ', exported '
          + new Date().toISOString().slice(0, 10), ''];
      let lastDay = '';
      for (const note of rows) {
        const day = new Date(note.at || 0).toISOString().slice(0, 10);
        if (day !== lastDay) { lastDay = day; lines.push('', '## ' + day, ''); }
        const where = note.url ? '[' + (note.title || note.host || note.url) + '](' + note.url + ')' : '';
        if (note.kind === 'quote') {
          for (const line of String(note.text).split('\n')) lines.push('> ' + line);
          if (where) lines.push('', '— ' + where);
        } else {
          lines.push('- ' + String(note.text).replace(/\n+/g, ' ') + (where ? ' · ' + where : ''));
        }
        lines.push('');
      }
      return lines.join('\n');
    },

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
