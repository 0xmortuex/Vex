// === PDF highlights that remember their page ====================================
//
// T3-064. Vex shows a PDF with Chromium's own viewer, a sealed plug-in: the page
// is not a web page, so the highlighter that marks text in a web page (js/annotations.js)
// cannot reach into it. What a citation needs from a PDF is not the yellow mark but the
// words and the page: "p. 14". This keeps exactly that.
//
//   1. In the PDF, select the passage and press Ctrl+C (the viewer's own copy).
//   2. Ctrl+K › Save a PDF highlight. The box opens with the copied text (a button pastes it,
//      because Vex never reads the clipboard in the background) and the page number it could
//      find: from the viewer's page box when Vex can see it, else from a #page=N in the
//      address, else empty for you to type.
//   3. It is kept with the document's address, its title and the page. It can be copied as a
//      quote with "p. 14" and a link that opens the PDF at that page (#page=14), written into a
//      "PDF highlights" note as a backlink, and listed per document.
//
// Honest limit: the passage is not marked inside the PDF itself, and the page is only as sure
// as the number the viewer showed or you typed. Nothing is sent anywhere; the list stays on this
// computer (vex.pdfHighlights) and is not synced. Never from a private or Tor tab, or from a
// banking, mail or sign-in site.

const VexPdfHighlights = {
  PREF: 'vex.pdfHighlights.prefs',         // { enabled, toNotes }
  KEY: 'vex.pdfHighlights',
  FEATURE: 'pdf-highlights',
  NOTE_TITLE: 'PDF highlights',
  MAX: 1000,
  MAX_TEXT: 2000,
  // Reads the viewer's page box if its frame can be reached. Fixed; it returns a number or null and changes nothing.
  DETECT_SCRIPT: '(() => { const seen = new Set(); const queue = [document]; let steps = 0;'
    + ' while (queue.length && steps++ < 400) { const root = queue.shift(); if (seen.has(root)) continue; seen.add(root);'
    + '  const el = root.querySelector ? root.querySelector("#pageSelector") : null; if (el && el.value) { const n = Number(el.value); return Number.isInteger(n) && n > 0 ? n : null; }'
    + '  for (const node of (root.querySelectorAll ? root.querySelectorAll("*") : [])) if (node.shadowRoot) queue.push(node.shadowRoot); }'
    + ' return null; })()',

  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); }
    catch (err) { throw new Error('The PDF highlight settings could not be read: ' + err.message, { cause: err }); }
    return { enabled: !raw || raw.enabled !== false, toNotes: !raw || raw.toNotes !== false };
  },
  enabled() { try { return this.prefs().enabled; } catch (err) { console.error('[PdfHighlights]', err.message); return false; } },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!next.enabled, toNotes: !!next.toNotes })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return this.prefs();
  },
  setEnabled(on) { return this.setPrefs({ enabled: !!on }).enabled; },

  // ---- pure ---------------------------------------------------------------------------
  docKey(url) { return String(url || '').replace(/#.*$/, ''); },
  // The page named in a PDF address: ...pdf#page=14 or #page=14&zoom=100 -> 14, else null.
  pageFromUrl(url) {
    const hash = String(url || '').split('#').slice(1).join('#');
    const m = /(?:^|&)page=(\d{1,5})(?:&|$)/i.exec(hash);
    const n = m ? Number(m[1]) : 0;
    return n > 0 ? n : null;
  },
  // The address that opens the document at a page.
  linkAt(url, page) { return this.docKey(url) + '#page=' + page; },
  normalizePage(value) {
    const n = Number(String(value == null ? '' : value).trim());
    if (!Number.isInteger(n) || n < 1 || n > 99999) throw new Error('Page numbers start at 1');
    return n;
  },
  _label(s) { return String(s == null ? '' : s).replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim(); },
  quoteMarkdown(h) {
    const body = String(h.text).split('\n').map(l => '> ' + l).join('\n');
    return body + '\n\n— [' + this._label(h.title || h.url) + ', p. ' + h.page + '](' + this.linkAt(h.url, h.page) + ')' + (h.note ? '\n\nNote: ' + h.note : '');
  },
  citation(h) { return this._label(h.title || h.url) + ', p. ' + h.page; },

  // ---- storage --------------------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The PDF highlights could not be read: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(h => h && typeof h.id === 'string' && typeof h.text === 'string' && Number.isInteger(h.page)) : [];
  },
  _save(list) {
    const kept = list.slice().sort((a, b) => b.at - a.at).slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(kept));
    return kept;
  },
  add({ text, page, url, title, note = '', now = Date.now() }) {
    const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim().slice(0, this.MAX_TEXT);
    if (!t) throw new Error('There is no passage to save. Copy it in the PDF first');
    if (!/^(https?|file):\/\//i.test(String(url || ''))) throw new Error('This is not a PDF address Vex can keep');
    const h = {
      id: 'pdfhl_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      url: this.docKey(url).slice(0, 2048), title: String(title || url).slice(0, 200), page: this.normalizePage(page), text: t, note: String(note || '').trim().slice(0, 500), at: now,
    };
    const list = this.list();
    const dup = list.find(x => x.url === h.url && x.page === h.page && x.text === h.text);
    if (dup) return { highlight: dup, created: false };
    this._save([h, ...list]);
    return { highlight: h, created: true };
  },
  remove(id) {
    const list = this.list();
    const h = list.find(x => x.id === id);
    if (!h) return null;
    this._save(list.filter(x => x.id !== id));
    return h;
  },
  restore(h) { const list = this.list(); if (!list.some(x => x.id === h.id)) this._save([h, ...list]); return h; },
  forDoc(url) { const k = this.docKey(url); return this.list().filter(h => h.url === k).sort((a, b) => a.page - b.page || a.at - b.at); },

  // ---- the PDF in front ------------------------------------------------------------------------
  _front() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('PDF highlights are off in private and Tor tabs');
    let url = tab.url, title = tab.title;
    try { url = wv.getURL() || url; title = wv.getTitle() || title; } catch (err) { window.VexProblems?.note('PDF highlights', 'Could not ask the page for its address; using the tab record', err); }
    if (!/^(https?|file):\/\//i.test(String(url || ''))) throw new Error('Open a PDF first');
    const why = /^https?:/i.test(url) && typeof VexPageSensitivity !== 'undefined' ? VexPageSensitivity.reason(url) : null;
    if (why) throw new Error(why);
    return { wv, tab, url, title };
  },

  // The page the viewer shows, if its frame can be read. null is "could not tell", never a guess.
  async detectPage(wv) {
    const wc = (() => { try { return wv.getWebContentsId(); } catch (err) { window.VexProblems?.note('PDF highlights', 'The PDF has not finished opening', err); return null; } })();
    if (wc == null || !window.vex || typeof window.vex.evalAllFrames !== 'function') return null;
    const r = await window.vex.evalAllFrames(wc, this.DETECT_SCRIPT, false);
    if (!r || !r.ok) return null;
    const hit = r.results.find(x => x && x.ok && Number.isInteger(x.value) && x.value > 0);
    return hit ? hit.value : null;
  },

  // ---- notes ---------------------------------------------------------------------------------------
  // Appends the quote with its backlink to the "PDF highlights" note (made on first use).
  toNotes(h) {
    if (typeof VexStudyNotes === 'undefined') throw new Error('Notes are not available here');
    let notes;
    try { notes = JSON.parse(localStorage.getItem('vex.notes') || '[]'); } catch (err) { throw new Error('Your notes could not be read: ' + err.message, { cause: err }); }
    if (!Array.isArray(notes)) throw new Error('Your notes are damaged');
    if (typeof NotesPanel !== 'undefined' && typeof NotesPanel.flush === 'function') NotesPanel.flush();
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) notes = NotesPanel.notes;
    const entry = this.quoteMarkdown(h) + '\n\n---\n\n';
    let note = notes.find(n => n && n.title === this.NOTE_TITLE);
    if (!note) { VexStudyNotes.addNote({ title: this.NOTE_TITLE, content: entry, tags: ['pdf', 'highlights'] }); return true; }
    note.content = entry + (note.content || '');
    note.updatedAt = new Date().toISOString();
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) { NotesPanel.notes = notes; NotesPanel.renderList?.(); }
    return true;
  },

  openAt(h) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    TabManager.createTab(this.linkAt(h.url, h.page), true);
  },

  // ---- the box -------------------------------------------------------------------------------------
  async capture() {
    if (!this.enabled()) { window.showToast?.('PDF highlights are switched off in Settings', 'info'); return null; }
    const front = this._front();
    let page = this.pageFromUrl(front.url);
    let detected = null;
    try { detected = await this.detectPage(front.wv); }
    catch (err) { window.VexProblems?.note('PDF highlights', 'Could not read the page number from the viewer', err); }
    if (detected) page = detected;
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-pdf-highlight', title: 'Save a PDF highlight', sub: (front.title || front.url).slice(0, 90) });
    const text = document.createElement('textarea');
    text.className = 'vexsr-input';
    text.rows = 5;
    text.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical';
    text.setAttribute('aria-label', 'The passage you copied from the PDF');
    text.placeholder = 'Select the passage in the PDF, press Ctrl+C, then press Paste what I copied';
    const pageIn = document.createElement('input');
    pageIn.type = 'number'; pageIn.min = '1'; pageIn.className = 'vexsr-input';
    pageIn.setAttribute('aria-label', 'Page number');
    pageIn.value = page ? String(page) : '';
    pageIn.style.width = '7em';
    const hint = VexSettingsGroups.note(page ? (detected ? 'Page ' + page + ' as the viewer shows it. Change it if it is not the page of the passage.' : 'Page ' + page + ' from the address.') : 'Vex could not tell which page you are on. Type it.');
    const noteIn = document.createElement('input');
    noteIn.type = 'text'; noteIn.className = 'vexsr-input';
    noteIn.setAttribute('aria-label', 'A note about it, optional');
    noteIn.placeholder = 'A note (optional)';
    noteIn.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px';
    const paste = VexSettingsGroups.button('Paste what I copied', async () => {
      try { text.value = await navigator.clipboard.readText(); } catch (err) { window.showToast?.('Could not read the clipboard: ' + err.message + '. Paste into the box with Ctrl+V.', 'error', 6000); }
    });
    const save = VexSettingsGroups.button('Save', async () => {
      try {
        const { highlight, created } = this.add({ text: text.value, page: pageIn.value, url: front.url, title: front.title, note: noteIn.value });
        let notedNote = false;
        if (this.prefs().toNotes && created) { this.toNotes(highlight); notedNote = true; }
        if (created && typeof VexSources !== 'undefined') VexSources.keepPassage({ text: highlight.text + ' (p. ' + highlight.page + ')', kind: 'highlight' });
        if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
        close();
        window.showToast?.(created ? 'Saved with p. ' + highlight.page + (notedNote ? ' and written to Notes' : '') : 'Already saved', 'info', 4000);
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true });
    const label = document.createElement('label');
    label.style.cssText = 'display:block;margin:8px 0 4px;font-size:11.5px;color:var(--text-muted)';
    label.append('Page ', pageIn);
    body.append(paste, text, label, hint, noteIn, save);
    text.focus();
    return body;
  },

  // ---- the list ------------------------------------------------------------------------------------
  open() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-pdf-highlights', title: 'PDF highlights', sub: 'Passages from PDFs, with their page. Open one and the PDF opens at that page.' });
    const draw = () => {
      body.textContent = '';
      let list;
      try { list = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!list.length) body.appendChild(VexSettingsGroups.note('Nothing saved. In a PDF, copy a passage and use Ctrl+K › Save a PDF highlight.'));
      const docs = new Map();
      for (const h of list) { if (!docs.has(h.url)) docs.set(h.url, []); docs.get(h.url).push(h); }
      for (const [url, items] of docs) {
        const head = document.createElement('div');
        head.className = 'vexsr-sub';
        head.style.margin = '10px 0 4px';
        head.textContent = items[0].title || url;
        body.appendChild(head);
        for (const h of items.sort((a, b) => a.page - b.page || a.at - b.at)) {
          const row = document.createElement('div');
          row.className = 'vexsr-rule';
          row.style.flexWrap = 'wrap';
          const text = document.createElement('span');
          text.className = 'vexsr-host';
          text.style.wordBreak = 'normal';
          text.textContent = 'p. ' + h.page + '  ' + h.text.slice(0, 160) + (h.note ? '  (' + h.note.slice(0, 60) + ')' : '');
          row.appendChild(text);
          row.appendChild(VexSettingsGroups.button('Open at page', () => { try { this.openAt(h); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: 'Open the PDF at page ' + h.page }));
          row.appendChild(VexSettingsGroups.button('Copy quote', async () => { try { await navigator.clipboard.writeText(this.quoteMarkdown(h)); window.showToast?.('Copied with p. ' + h.page, 'info', 2500); } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); } }, { label: 'Copy this passage as a quote with its page' }));
          row.appendChild(VexSettingsGroups.button('To a note', () => { try { this.toNotes(h); window.showToast?.('Written to the PDF highlights note', 'info', 3000); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: 'Write this passage to the PDF highlights note' }));
          row.appendChild(VexSettingsGroups.button('Remove', () => {
            const gone = this.remove(h.id);
            draw();
            if (gone) window.VexUndo.offer({ message: 'Removed a PDF highlight', undo: () => { this.restore(gone); if (body.isConnected) draw(); } });
          }, { danger: true, label: 'Remove this PDF highlight' }));
          body.appendChild(row);
        }
      }
    };
    draw();
    return body;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Keeps a passage you copied from a PDF with its page number, so it can be cited as "p. 14" and opened at that page. Vex cannot mark text inside its PDF viewer, so this saves the words and the page, not a yellow mark. Ctrl+K › Save a PDF highlight.'));
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('aria-label', 'Also write each PDF highlight to the PDF highlights note');
    let on = true;
    try { on = this.prefs().toNotes; } catch (err) { window.VexProblems?.note('PDF highlights', 'The settings could not be read', err); }
    box.checked = on;
    box.addEventListener('change', () => { try { this.setPrefs({ toNotes: box.checked }); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
    label.append(box, document.createTextNode('Also write each one to the "PDF highlights" note, with a link to its page'));
    el.appendChild(label);
    el.appendChild(VexSettingsGroups.button('Save a PDF highlight', async () => { try { await this.capture(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    el.appendChild(VexSettingsGroups.button('See PDF highlights', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexPdfHighlights = VexPdfHighlights;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'pdf-highlights', title: 'PDF highlights', keywords: 'pdf highlight page number citation quote backlink notes p. page anchor', before: 'about', build: (el) => VexPdfHighlights.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'pdf-highlight-save', label: 'Save a PDF highlight', hint: 'The passage you copied from a PDF, with its page', icon: 'marker', action: async () => { try { await VexPdfHighlights.capture(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    VexExtras.registerCommand({ id: 'pdf-highlights', label: 'PDF highlights', hint: 'Passages from PDFs with their page; open at that page', icon: 'marker', action: () => VexPdfHighlights.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPdfHighlights };
