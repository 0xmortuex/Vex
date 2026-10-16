// === Cheat sheet from tagged highlights (T3-044) ==================================
//
// Highlights you tagged "formula" (or "definition", "date", anything) come together, per
// subject, into one note and one printable page.
//
// A highlight (js/annotations.js) already has a note. A tag is a word with a hash in that
// note ("#formula"), and a subject is a word with an at-sign ("@calculus"); a highlight with
// no subject is filed under the title of its page. So tagging is typing "#formula @calculus"
// in the highlight's note box, which already exists: no new place to tag in, nothing to
// migrate. Several tags and subjects on one highlight are fine.
//
//   VexCheatSheet.parseTags(note)            pure: { tags:[], subjects:[] } (folded, lower case)
//   VexCheatSheet.collect(store, {tag, subject})   pure: [{subject, items:[{text, note, url, title}]}]
//   VexCheatSheet.markdown(groups, tag)      pure
//   VexCheatSheet.html(groups, tag)          pure: a printable page
//   VexCheatSheet.tags(store)                the tags in use, with counts
//
// Nothing is changed in your highlights; the sheet is built from a copy. Local only.
const VexCheatSheet = {
  PREF: 'vex.cheatSheet.enabled',
  MAX_ITEMS: 400,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  parseTags(note) {
    const s = String(note == null ? '' : note);
    const grab = (re) => [...s.matchAll(re)].map(m => VexStudyKit.fold(m[1]));
    return { tags: grab(/(?:^|\s)#([\p{L}\p{N}_-]{2,30})/gu), subjects: grab(/(?:^|\s)@([\p{L}\p{N}_-]{2,30})/gu) };
  },

  _store() {
    if (typeof Annotations !== 'undefined' && Annotations.store && typeof Annotations.store === 'object') return Annotations.store;
    return VexStudyKit.store('vex.annotations', {}).get();
  },

  tags(store) {
    const counts = new Map();
    for (const list of Object.values(store || {})) {
      for (const h of Array.isArray(list) ? list : []) for (const t of this.parseTags(h && h.note).tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  },

  collect(store, { tag, subject } = {}) {
    const wantTag = VexStudyKit.fold(String(tag || '').replace(/^#/, ''));
    const wantSub = VexStudyKit.fold(String(subject || '').replace(/^@/, ''));
    if (!wantTag) throw new Error('Choose a tag first');
    const groups = new Map();
    let total = 0;
    for (const [url, list] of Object.entries(store || {})) {
      for (const h of Array.isArray(list) ? list : []) {
        if (!h || typeof h.text !== 'string' || !h.text.trim()) continue;
        const p = this.parseTags(h.note);
        if (!p.tags.includes(wantTag)) continue;
        if (wantSub && !p.subjects.includes(wantSub)) continue;
        if (total >= this.MAX_ITEMS) break;
        total++;
        const name = p.subjects[0] || String(h.title || '').trim() || (function () { try { return new URL(h.url || url).hostname; } catch { return 'Other'; } })();
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({
          text: h.text.trim().replace(/\s+/g, ' '),
          note: String(h.note || '').replace(/(?:^|\s)[#@][\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim(),
          url: String(h.url || url || ''), title: String(h.title || ''), at: h.at || 0,
        });
      }
    }
    return [...groups.entries()].map(([subject, items]) => ({ subject, items: items.sort((a, b) => a.at - b.at) })).sort((a, b) => a.subject.localeCompare(b.subject));
  },

  markdown(groups, tag) {
    const out = ['# Cheat sheet: ' + tag, ''];
    for (const g of groups) {
      out.push('## ' + g.subject, '');
      for (const i of g.items) out.push('- ' + i.text + (i.note ? ' (' + i.note + ')' : '') + (/^https?:/i.test(i.url) ? ' [source](' + i.url + ')' : ''));
      out.push('');
    }
    return out.join('\n');
  },

  html(groups, tag) {
    const e = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let body = '';
    for (const g of groups) {
      body += '<h2>' + e(g.subject) + '</h2><ul>';
      for (const i of g.items) body += '<li>' + e(i.text) + (i.note ? ' <em>(' + e(i.note) + ')</em>' : '') + (/^https?:/i.test(i.url) ? ' <a href="' + e(i.url) + '">source</a>' : '') + '</li>';
      body += '</ul>';
    }
    return '<!doctype html><html><head><meta charset="utf-8"><title>Cheat sheet: ' + e(tag) + '</title><style>' +
      'body{font:12pt/1.4 system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#111;background:#fff}h1{font-size:18pt}h2{font-size:13pt;border-bottom:1px solid #999;margin-top:1.2em}ul{padding-left:1.2em}li{margin:.25em 0;break-inside:avoid}a{color:#333}' +
      '@media print{body{margin:0;max-width:none;font-size:10pt}a{text-decoration:none}}</style></head><body><h1>Cheat sheet: ' + e(tag) + '</h1>' + body + '</body></html>';
  },

  build(tag, subject) {
    const groups = this.collect(this._store(), { tag, subject });
    if (!groups.length) throw new Error('No highlight carries #' + String(tag).replace(/^#/, '') + (subject ? ' and @' + String(subject).replace(/^@/, '') : '') + ' yet. Add it to the note of a highlight.');
    return groups;
  },
  saveNote(tag, subject) {
    const groups = this.build(tag, subject);
    return VexStudyKit.saveNote('Cheat sheet: ' + tag + (subject ? ' (' + subject + ')' : ''), this.markdown(groups, tag));
  },
  openPrintable(tag, subject) {
    const groups = this.build(tag, subject);
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available here');
    TabManager.createTab('data:text/html;charset=utf-8,' + encodeURIComponent(this.html(groups, tag)), true);
    window.showToast?.('Opened. Press Ctrl+P to print it or save it as a PDF.');
  },

  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('cheat-sheet');
    const K = VexStudyKit, G = VexSettingsGroups;
    const tags = this.tags(this._store());
    const { body } = G.dialog({ id: 'vex-cheat', title: 'Cheat sheet', sub: 'Put #tag (and @subject) in the note of a highlight. Highlights with the tag you pick are gathered here.' });
    if (!tags.length) { body.appendChild(G.note('No highlight has a tag yet. Highlight text on a page, add a note such as "#formula @calculus", then come back.')); return; }
    const sel = K.el('select', { 'aria-label': 'Tag' }, tags.map(t => K.el('option', { value: t.tag, text: '#' + t.tag + ' (' + t.n + ')' })));
    const sub = K.el('input', { type: 'text', placeholder: 'Only subject (optional), e.g. calculus', 'aria-label': 'Subject', style: 'margin-left:8px' });
    const prev = K.el('pre', { style: 'white-space:pre-wrap;max-height:50vh;overflow:auto;margin-top:10px' });
    const show = () => { try { prev.textContent = this.markdown(this.build(sel.value, sub.value.trim()), sel.value); } catch (err) { prev.textContent = err.message; } };
    sel.addEventListener('change', show); sub.addEventListener('input', show);
    body.append(K.el('div', {}, sel, sub),
      K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' },
        G.button('Save as a note', K.guard(() => { this.saveNote(sel.value, sub.value.trim()); window.showToast?.('Saved as a note'); }), { primary: true }),
        G.button('Copy', K.guard(async () => { await K.copy(prev.textContent); window.showToast?.('Copied'); })),
        G.button('Open a printable page', K.guard(() => this.openPrintable(sel.value, sub.value.trim())))),
      prev);
    show();
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Gathers the highlights tagged with a word such as #formula into one note or printable page. Tag a highlight by writing #formula @subject in its note.'));
    el.appendChild(G.button('Build a cheat sheet', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') window.VexCheatSheet = VexCheatSheet;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCheatSheet };
