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
  // The same page, whatever its #fragment says.
  const pageOf = url => String(url || '').split('#')[0];

  /**
   * Runs in the page: mark each passage where it appears, the way the desktop's
   * highlights come back on a revisit. A passage is found in the page's text
   * with whitespace collapsed on both sides — a selection rarely keeps the
   * page's line breaks — and marked one text node at a time, because a
   * passage that crosses a link or a bold word crosses elements, and wrapping
   * the whole range in one element would break the page around it.
   */
  const MARK = passages => `(function(passages){
  if (!document.body) return 0;
  var old = document.querySelectorAll('mark.vex-kept');
  for (var o = 0; o < old.length; o++) {
    var parent = old[o].parentNode;
    while (old[o].firstChild) parent.insertBefore(old[o].firstChild, old[o]);
    parent.removeChild(old[o]);
    parent.normalize();
  }
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      var tag = node.parentNode && node.parentNode.nodeName;
      return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA'
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var flat = '', map = [], space = true, node;
  while ((node = walker.nextNode())) {
    var text = node.nodeValue;
    for (var i = 0; i < text.length; i++) {
      var blank = /\\s/.test(text[i]);
      if (blank && space) continue;
      // Lower-cased a character at a time, keeping the one-to-one map: a
      // character whose lower case is two (a dotted capital I) stays as it is.
      var lower = text[i].toLowerCase();
      flat += blank ? ' ' : (lower.length === 1 ? lower : text[i]);
      map.push([node, i]);
      space = blank;
    }
  }
  var marked = 0;
  for (var p = 0; p < passages.length; p++) {
    var wanted = String(passages[p]).replace(/\\s+/g, ' ').trim().toLowerCase();
    if (wanted.length < 3) continue;
    var at = flat.indexOf(wanted);
    if (at < 0) continue;
    var end = at + wanted.length - 1;
    // Each text node the passage touches, with the slice of it that is inside.
    var pieces = [];
    for (var k = at; k <= end; k++) {
      var spot = map[k];
      var last = pieces[pieces.length - 1];
      if (last && last.node === spot[0]) last.to = spot[1] + 1;
      else pieces.push({ node: spot[0], from: spot[1], to: spot[1] + 1 });
    }
    for (var q = pieces.length - 1; q >= 0; q--) {
      var piece = pieces[q];
      var range = document.createRange();
      range.setStart(piece.node, piece.from);
      range.setEnd(piece.node, piece.to);
      var mark = document.createElement('mark');
      mark.className = 'vex-kept';
      mark.style.cssText = 'background:rgba(255,214,10,.42);color:inherit;border-radius:2px;padding:0';
      try { range.surroundContents(mark); } catch (e) {}
    }
    marked++;
  }
  return marked;
})(${JSON.stringify(passages)})`;

  return {
    MARK,
    pageOf,

    /** Passages kept from this page, newest first. */
    async passagesFor(url) {
      const host = url ? VexSearch.prettyHost(url) : '';
      if (!host) return [];
      const page = pageOf(url);
      const rows = await VexDB.byIndex('notes', 'host', host, 200);
      return rows
        .filter(row => row.kind === 'quote' && pageOf(row.url) === page)
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, 30)
        .map(row => row.text);
    },

    /**
     * Mark what was kept from this page on the page. Quiet: a page that will
     * not run script, or whose text has changed since, is simply left as it is.
     */
    async markPage(tab) {
      if (!tab || !tab.url || tab.incognito || !/^https?:/.test(tab.url)) return 0;
      const passages = await this.passagesFor(tab.url);
      if (!passages.length) return 0;
      try {
        const { result } = await VexBridge.evaluate(tab.id, MARK(passages));
        return Number(String(result || '0').replace(/"/g, '')) || 0;
      } catch { return 0; }
    },

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

    // Undo: the same row under the same id, so its date and its place in the
    // list come back with it.
    restore(note) { return note && note.id != null ? VexDB.put('notes', note) : null; },

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
