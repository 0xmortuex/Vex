// === FlashMind bridge ========================================================
//
// FlashMind (github.com/0xmortuex/FlashMind) is the study tool the owner
// already has: notes, FSRS flashcards and exams, running in a browser tab. Vex
// does not grow a second one. This file is only the glue.
//
// What FlashMind actually accepts (read from its source, js/app.js, js/parser.js
// and js/export.js, not guessed):
//
//   * NO deep link or URL parameter imports anything. The only one it reads is
//     ?s=<share code>, which fetches a shared set from its worker.
//   * Text pasted into its "Paste" input becomes a study set (it generates notes
//     and cards from it).
//   * A .csv / .tsv file of  front,back,difficulty,category  becomes a
//     flashcards-only deck (the same file its own export and Anki write).
//   * A .json file with { title, notes, flashcards[], quiz[] } is loaded as a
//     deck as it is (its "Everything as JSON" export).
//   * A .json file { flashmindBackup: 1, exportedAt, decks, stats } is its
//     whole-library backup; each card's schedule is decks.decks[id].srs[cardId]
//     = { stab, diff, reps, lapses, due (ms), last }.
//
// So "Send to FlashMind" cannot open a pre-filled import. It prepares what
// FlashMind takes (text to paste, a CSV, a JSON deck) and puts it on the
// clipboard or in a file; the person pastes or drops it in FlashMind, which is
// open in a sidebar panel. Nothing here talks to FlashMind's worker or any
// other server: the only network use is the panel showing FlashMind's own page.
//
// "Cards due today" for the morning brief reads a FlashMind backup file the
// person chooses. Only the due times and deck titles are kept, never the cards.
//
// The top half is pure and unit-tested (tests/renderer/flashmindBridge.test.js).

const FlashMindBridge = {
  DEFAULT_URL: 'https://0xmortuex.github.io/FlashMind/',
  PANEL_ID: 'flashmind',
  KEY_URL: 'vex.flashmind.url',
  KEY_DUE: 'vex.flashmind.due',
  MAX_TEXT: 60000,
  MAX_CARDS: 500,
  MAX_DUES: 20000,
  STALE_DAYS: 7,

  // ---- the address -------------------------------------------------------
  cleanUrl(raw) {
    const t = String(raw == null ? '' : raw).trim();
    let u;
    try { u = new URL(t); } catch { throw new Error('That is not a web address'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('The address must start with http:// or https://');
    return u.href;
  },

  url() {
    try {
      const v = localStorage.getItem(this.KEY_URL);
      return v ? this.cleanUrl(v) : this.DEFAULT_URL;
    } catch { return this.DEFAULT_URL; }
  },

  setUrl(raw) {
    const href = raw && String(raw).trim() ? this.cleanUrl(raw) : '';
    try {
      if (href) localStorage.setItem(this.KEY_URL, href); else localStorage.removeItem(this.KEY_URL);
    } catch (err) { throw new Error('The address could not be saved: ' + err.message); }
    // A panel that is already there points at the new address.
    if (this.panelPinned()) { this.removePanel(); this.ensurePanel(); }
    return href || this.DEFAULT_URL;
  },

  // ---- what FlashMind imports --------------------------------------------
  // A CSV field the way FlashMind's own export writes it, and its parser reads.
  csvField(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; },

  _diff(d) { return ['easy', 'medium', 'hard'].includes(String(d).toLowerCase()) ? String(d).toLowerCase() : 'medium'; },

  // [{ front, back, difficulty?, category? }] -> the CSV FlashMind imports.
  cardsToCsv(cards) {
    const rows = ['front,back,difficulty,category'];
    for (const c of (Array.isArray(cards) ? cards : [])) {
      const front = String(c && c.front || '').trim();
      const back = String(c && c.back || '').trim();
      if (!front || !back) continue;
      rows.push([this.csvField(front), this.csvField(back), this.csvField(this._diff(c.difficulty)), this.csvField(String(c.category || 'Vex').trim() || 'Vex')].join(','));
    }
    return rows.join('\n') + '\n';
  },

  _plain(s) { return String(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim(); },

  // Cards that are already written in a note, and only those; nothing is
  // invented. Three shapes:
  //   Q: question          term :: definition        - **term**: definition
  //   A: answer
  parseCards(markdown) {
    const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
    const cards = [];
    const seen = new Set();
    const add = (front, back, category) => {
      const f = this._plain(front), b = this._plain(back);
      if (!f || !b || f.length > 400 || b.length > 1200) return;
      const key = f.toLowerCase();
      if (seen.has(key) || cards.length >= this.MAX_CARDS) return;
      seen.add(key);
      cards.push({ front: f, back: b, difficulty: 'medium', category: category || 'Vex' });
    };
    let category = '';
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const h = /^#{1,6}\s+(.+)$/.exec(raw);
      if (h) { category = this._plain(h[1]).slice(0, 60); continue; }
      const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      const q = /^(?:Q|Question|Soru)\s*[:.]\s*(.+)$/i.exec(line);
      if (q) {
        const answer = [];
        let j = i + 1;
        const a0 = /^\s*(?:[-*+]\s+)?(?:A|Answer|Cevap)\s*[:.]\s*(.*)$/i.exec(lines[j] || '');
        if (a0) {
          answer.push(a0[1]);
          for (j = j + 1; j < lines.length && lines[j].trim() && !/^\s*(?:[-*+]\s+)?(?:Q|Question|Soru)\s*[:.]/i.test(lines[j]) && !/^#{1,6}\s/.test(lines[j]); j++) answer.push(lines[j].trim());
          add(q[1], answer.join(' '), category);
          i = j - 1;
          continue;
        }
      }
      const dc = /^(.{2,200}?)\s::\s(.+)$/.exec(line);
      if (dc) { add(dc[1], dc[2], category); continue; }
      const bold = /^\*\*([^*]{2,120})\*\*\s*[:–—-]\s*(.+)$/.exec(line);
      if (bold) { add(bold[1], bold[2], category); continue; }
      const inner = /^\*\*([^*]{2,120}?)\s*:\*\*\s*(.+)$/.exec(line);
      if (inner) add(inner[1], inner[2], category);
    }
    return cards;
  },

  // Markdown -> FlashMind notes sections: one per heading, its "- **term**: def"
  // lines kept as key terms.
  sectionsOf(markdown) {
    const out = [];
    let cur = { title: 'Notes', body: [], terms: [] };
    const push = () => {
      const content = cur.body.join('\n').trim();
      if (content || cur.terms.length) out.push({ title: cur.title, content, bulletPoints: [], keyTerms: cur.terms });
    };
    for (const raw of String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n')) {
      const h = /^#{1,6}\s+(.+)$/.exec(raw);
      if (h) { push(); cur = { title: this._plain(h[1]).slice(0, 120) || 'Notes', body: [], terms: [] }; continue; }
      const t = /^\s*(?:[-*+]\s+)?\*\*([^*]{2,120})\*\*\s*[:–—-]\s*(.+)$/.exec(raw);
      if (t) { cur.terms.push({ term: this._plain(t[1]), definition: this._plain(t[2]) }); continue; }
      cur.body.push(raw);
    }
    push();
    return out;
  },

  // The text to paste into FlashMind: title, where it came from, the body.
  studyText({ title, url, body }) {
    const head = [String(title || '').trim(), url ? 'Source: ' + url : ''].filter(Boolean).join('\n');
    let text = (head ? head + '\n\n' : '') + String(body == null ? '' : body).trim();
    if (text.length > this.MAX_TEXT) text = text.slice(0, this.MAX_TEXT).replace(/\s+\S*$/, '') + '\n\n[Shortened to fit.]';
    return text;
  },

  // A study set FlashMind loads as it is (it needs a title and flashcards[] or
  // quiz[]; its parser fills in the rest).
  deckJson({ title, body, cards }) {
    const sections = this.sectionsOf(body);
    return {
      title: String(title || '').trim() || 'From Vex',
      notes: { summary: '', sections, importantDates: [], commonMistakes: [], diagrams: [] },
      flashcards: (cards || []).map((c, i) => ({ id: i + 1, front: c.front, back: c.back, difficulty: this._diff(c.difficulty), category: c.category || 'Vex' })),
      quiz: [],
    };
  },

  // Everything the dialog can hand over for one item.
  payloads({ title, url, body }) {
    if (!String(body == null ? '' : body).trim()) throw new Error('There is nothing to send');
    const text = this.studyText({ title, url, body });
    const cards = this.parseCards(body);
    const out = {
      text: { label: 'Study text to paste into FlashMind', mime: 'text/plain', ext: '.txt', content: text },
      cards: cards.length ? { label: 'Flashcards file (' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + ')', mime: 'text/csv', ext: '.csv', content: this.cardsToCsv(cards), count: cards.length } : null,
      deck: { label: 'Study set file', mime: 'application/json', ext: '.json', content: JSON.stringify(this.deckJson({ title, body, cards }), null, 2), count: cards.length },
    };
    return out;
  },

  // Several clips -> one body, in order, each with its page.
  clipsBody(clips) {
    return (Array.isArray(clips) ? clips : [])
      .filter(c => c && typeof c.text === 'string' && c.text.trim())
      .map(c => {
        const from = [c.title, c.host].filter(Boolean).join(' - ');
        return (from ? '## ' + from.replace(/\s+/g, ' ').slice(0, 120) + '\n\n' : '') + c.text.trim();
      }).join('\n\n');
  },

  // ---- due cards, from a backup file the person chose --------------------
  parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch { throw new Error('That file is not JSON. Choose the backup FlashMind saved (flashmind_backup_...json).'); }
    if (!o || typeof o !== 'object' || o.flashmindBackup !== 1) {
      throw new Error('That is not a FlashMind backup. In FlashMind, use Backup in the library, then choose that file.');
    }
    const store = o.decks && typeof o.decks === 'object' ? o.decks : null;
    const decks = store && store.decks && typeof store.decks === 'object' ? store.decks : null;
    if (!decks) throw new Error('The backup has no decks in it');
    return { exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '', decks };
  },

  // Keeps only deck titles and due times: { importedAt, exportedAt, decks:
  // [{ title, cards, dues: [ms] }] }. A card is due when its schedule exists and
  // its `due` is not later than now: FlashMind's own Today rule.
  dueData(backup, now = Date.now()) {
    const decks = [];
    let kept = 0;
    for (const deck of Object.values(backup.decks)) {
      if (!deck || typeof deck !== 'object' || !deck.data || typeof deck.data !== 'object') continue;
      const cards = Array.isArray(deck.data.flashcards) ? deck.data.flashcards : [];
      const srs = deck.srs && typeof deck.srs === 'object' ? deck.srs : {};
      const dues = [];
      for (const c of cards) {
        if (!c) continue;
        const s = srs[c.id];
        if (!s || typeof s !== 'object' || !Number.isFinite(s.due)) continue;
        if (kept >= this.MAX_DUES) break;
        dues.push(Math.round(s.due)); kept++;
      }
      decks.push({ title: String(deck.data.title || 'Untitled deck').slice(0, 120), cards: cards.length, dues });
    }
    return { importedAt: now, exportedAt: backup.exportedAt || '', decks };
  },

  endOfDay(now) { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.getTime(); },

  // Counts from the kept data at `now`.
  dueSummary(data, now = Date.now()) {
    const eod = this.endOfDay(now);
    const decks = [];
    let dueNow = 0, dueToday = 0, cards = 0;
    for (const d of (data && Array.isArray(data.decks) ? data.decks : [])) {
      const n = d.dues.filter(t => t <= now).length;
      const t = d.dues.filter(x => x <= eod).length;
      dueNow += n; dueToday += t; cards += d.cards;
      if (t > 0) decks.push({ title: d.title, due: n, today: t });
    }
    decks.sort((a, b) => b.today - a.today);
    const exported = data && data.exportedAt ? Date.parse(data.exportedAt) : NaN;
    const ageDays = Number.isFinite(exported) ? Math.max(0, Math.floor((now - exported) / 86400000)) : null;
    return { dueNow, dueToday, cards, decks, exportedAt: data ? data.exportedAt : '', ageDays, stale: ageDays != null && ageDays >= this.STALE_DAYS };
  },

  // The brief card's lines ({ text, detail, url?, actions }), in the shape the
  // other brief modules answer (see js/brief-integration.js in the brief
  // work): build() -> { lines }.
  briefLines(data, now = Date.now()) {
    if (!data || !Array.isArray(data.decks)) return [];
    const s = this.dueSummary(data, now);
    const lines = [];
    const word = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    if (s.dueToday > 0) {
      lines.push({
        text: word(s.dueToday, 'FlashMind card', 'FlashMind cards') + ' due today',
        detail: s.decks.slice(0, 3).map(d => d.title + ' (' + d.today + ')').join(', ') + (s.decks.length > 3 ? ' and ' + (s.decks.length - 3) + ' more' : ''),
      });
    } else {
      lines.push({ text: 'No FlashMind cards due today', detail: word(s.cards, 'card', 'cards') + ' in ' + word(data.decks.length, 'deck', 'decks') });
    }
    if (s.stale) lines.push({ text: 'This count is from a backup ' + s.ageDays + ' days old', detail: 'Save a fresh backup in FlashMind and choose it in Settings for a true count' });
    return lines;
  },

  // ---- stored due data ---------------------------------------------------
  dueStored() {
    try {
      const o = JSON.parse(localStorage.getItem(this.KEY_DUE) || 'null');
      return o && Array.isArray(o.decks) ? o : null;
    } catch { return null; }
  },
  importDueText(text, now = Date.now()) {
    const data = this.dueData(this.parseBackup(text), now);
    try { localStorage.setItem(this.KEY_DUE, JSON.stringify(data)); }
    catch (err) { throw new Error('The due cards could not be saved: ' + err.message); }
    return this.dueSummary(data, now);
  },
  forgetDue() { try { localStorage.removeItem(this.KEY_DUE); } catch { /* nothing kept */ } },

  // ---- the sidebar panel -------------------------------------------------
  // FlashMind as a pinned site panel, through Vex's own pinned-site mechanism
  // (SidebarManager, vex.sitePanels): the same webview, icon and menu.
  panelPinned() {
    if (typeof SidebarManager === 'undefined' || typeof SidebarManager._sitePanels !== 'function') return false;
    return SidebarManager._sitePanels().some(p => p.id === this.PANEL_ID);
  },

  ensurePanel() {
    if (typeof SidebarManager === 'undefined' || typeof SidebarManager._mountSitePanel !== 'function') {
      throw new Error('The sidebar is not available');
    }
    const url = this.url();
    const list = SidebarManager._sitePanels();
    let p = list.find(x => x.id === this.PANEL_ID);
    if (!p) {
      p = { id: this.PANEL_ID, name: 'FlashMind', url };
      list.push(p);
      SidebarManager._saveSitePanels(list);
      SidebarManager._mountSitePanel(p);
    } else if (!document.getElementById('panel-' + this.PANEL_ID)) {
      SidebarManager._mountSitePanel(p);
    }
    return p;
  },

  removePanel() {
    if (typeof SidebarManager === 'undefined' || typeof SidebarManager.unpinSite !== 'function') return false;
    if (!this.panelPinned()) return false;
    SidebarManager.unpinSite(this.PANEL_ID);
    return true;
  },

  openPanel() {
    this.ensurePanel();
    if (typeof SidebarManager.showPanel === 'function') SidebarManager.showPanel(this.PANEL_ID);
    else SidebarManager.togglePanel(this.PANEL_ID);
  },

  // ---- getting the material ----------------------------------------------
  _active() {
    const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (!tab || !wv) throw new Error('Open a page first');
    const pol = window.VexTabPolicy;
    if (pol && (!pol.canReadWebview(wv) || (pol.canShareTab && !pol.canShareTab(tab)))) throw new Error('Private, Tor and routed tabs are never read');
    if (!/^https?:/i.test(tab.url || '')) throw new Error('Only web pages can be sent');
    return { tab, wv };
  },

  async fromSelection() {
    const { tab, wv } = this._active();
    const text = await window.vexGuestEval(wv, 'String(window.getSelection())', false, 4000);
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) throw new Error('Select some text on the page first');
    return { title: tab.title || tab.url, url: tab.url, body: t };
  },

  async fromPage() {
    const { tab, wv } = this._active();
    let body = '';
    if (typeof ReadingMode !== 'undefined' && typeof ReadingMode._extractScript === 'function' && typeof ListenReader !== 'undefined') {
      try {
        const article = await wv.executeJavaScript(ReadingMode._extractScript());
        const { sections } = ListenReader.blocksToSections(article && article.blocks, article && article.title);
        body = sections.map(s => '## ' + s.title + '\n\n' + s.paras.join('\n\n')).join('\n\n');
      } catch { body = ''; }
    }
    if (!body.trim()) {
      const code = "(function(){try{var el=document.querySelector('article,main,[role=main]')||document.body;return String(el.innerText||'').slice(0,200000);}catch(e){return '';}})()";
      const t = await window.vexGuestEval(wv, code, false, 8000);
      body = typeof t === 'string' ? t.trim() : '';
    }
    if (!body.trim()) throw new Error('There is no readable text on this page');
    return { title: tab.title || tab.url, url: tab.url, body };
  },

  notes() {
    if (typeof NotesPanel === 'undefined' || !Array.isArray(NotesPanel.notes)) return [];
    return NotesPanel.notes.map(n => NotesPanel.normalize(n)).filter(n => n.id && n.content.trim());
  },

  fromNote(id) {
    const n = this.notes().find(x => x.id === id);
    if (!n) throw new Error('Choose a note');
    return { title: n.title || 'Note', url: n.sourceUrl, body: n.content };
  },

  clips(which) {
    if (typeof ClipboardHistory === 'undefined') return [];
    return which === 'pinned' ? (ClipboardHistory.pinned || []) : (ClipboardHistory.recent || []);
  },

  fromClips(which) {
    const body = this.clipsBody(this.clips(which));
    if (!body) throw new Error(which === 'pinned' ? 'You have not pinned any clips' : 'No clips were copied this session');
    return { title: 'Clips from Vex', url: '', body };
  },

  // ---- delivering --------------------------------------------------------
  async copy(text) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(text);
  },

  // The blob's address is let go of only after the download had time to start.
  saveFile(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  fileName(title, ext) {
    const base = String(title || 'vex').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'vex';
    return base + '_flashmind' + ext;
  },

  // ---- the dialog --------------------------------------------------------
  async openSend({ source } = {}) {
    document.querySelector('.vex-flashmind-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const btn = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer';
    const overlay = document.createElement('div');
    overlay.className = 'vex-flashmind-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:7vh';
    const notes = this.notes();
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Send to FlashMind" style="width:min(620px,94vw);max-height:84vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <strong style="flex:1;font-size:13.5px;color:var(--text);min-width:120px">Send to FlashMind</strong>
          <select data-source class="set-input" aria-label="What to send">
            <option value="selection">The selected text</option>
            <option value="page">This page</option>
            <option value="note">A note</option>
            <option value="pinned">My pinned clips</option>
            <option value="recent">Clips from this session</option>
          </select>
          <select data-note class="set-input" aria-label="Which note" hidden>${notes.map(n => '<option value="' + esc(n.id) + '">' + esc(n.title || NotesPanel.previewText(n.content, 40)) + '</option>').join('')}</select>
        </div>
        <div style="padding:8px 14px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border)">
          <label style="font-size:12px;color:var(--text-muted)">Send as
            <select data-format class="set-input" style="margin-left:6px"></select></label>
        </div>
        <textarea data-preview readonly aria-label="What will be sent" style="flex:1;min-height:180px;margin:10px 14px;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12px;resize:none"></textarea>
        <div data-status role="status" style="padding:0 14px 8px;font-size:12px;color:var(--text-muted)">FlashMind cannot be opened with something already in it, so this goes to your clipboard or a file, and you paste or drop it there.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--border)">
          <button type="button" data-open style="${btn}">Open FlashMind</button>
          <button type="button" data-save style="${btn}">Save as file</button>
          <button type="button" data-copy class="btn-primary">Copy</button>
          <button type="button" data-close style="${btn}">Close</button>
        </div>
      </div>`;
    const q = (s) => overlay.querySelector(s);
    const status = q('[data-status]');
    const say = (t) => { status.textContent = t; };
    let current = null;   // { title, payloads }
    const formatSel = q('[data-format]');
    const preview = q('[data-preview]');
    const showFormat = () => {
      if (!current) { preview.value = ''; return; }
      const p = current.payloads[formatSel.value];
      preview.value = p ? p.content : '';
    };
    const load = async () => {
      current = null; formatSel.innerHTML = ''; preview.value = '';
      const src = q('[data-source]').value;
      q('[data-note]').hidden = src !== 'note';
      try {
        let item;
        if (src === 'selection') item = await this.fromSelection();
        else if (src === 'page') item = await this.fromPage();
        else if (src === 'note') item = this.fromNote(q('[data-note]').value);
        else item = this.fromClips(src);
        const payloads = this.payloads(item);
        current = { title: item.title, payloads };
        for (const [key, p] of Object.entries(payloads)) {
          if (!p) continue;
          const o = document.createElement('option');
          o.value = key; o.textContent = p.label;
          formatSel.appendChild(o);
        }
        // Cards written in the note go as a file by default; anything else as text.
        formatSel.value = payloads.cards ? 'cards' : 'text';
        showFormat();
        say('Ready. Copy it, then paste it in FlashMind' + (payloads.cards ? ', or save the cards file and drop it on FlashMind.' : '.'));
      } catch (err) { say((err && err.message) || String(err)); }
    };
    q('[data-source]').value = source || 'selection';
    q('[data-source]').addEventListener('change', load);
    q('[data-note]').addEventListener('change', load);
    formatSel.addEventListener('change', showFormat);
    q('[data-copy]').addEventListener('click', async () => {
      try {
        if (!current) throw new Error('There is nothing to copy');
        await this.copy(current.payloads[formatSel.value].content);
        say('Copied. In FlashMind, choose Paste and paste it.' + (formatSel.value !== 'text' ? ' (This format is meant for a file: use Save as file.)' : ''));
      } catch (err) { say(err.message); }
    });
    q('[data-save]').addEventListener('click', () => {
      try {
        if (!current) throw new Error('There is nothing to save');
        const p = current.payloads[formatSel.value];
        this.saveFile(this.fileName(current.title, p.ext), p.content, p.mime);
        say('Saved to your downloads. Drop the file on FlashMind\'s upload area.');
      } catch (err) { say(err.message); }
    });
    q('[data-open]').addEventListener('click', () => {
      try { this.openPanel(); close(); } catch (err) { say(err.message); }
    });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    q('[data-close]').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    await load();
    return overlay;
  },

  // ---- Settings and the command bar -------------------------------------
  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="flashmind"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'flashmind');
    g.innerHTML = `
      <label class="setting-label">FlashMind</label>
      <p class="setting-info muted" style="margin-bottom:8px">Your study tool, in a sidebar panel, with a way to send it notes, pages, selections and clips. Vex never contacts FlashMind itself: the panel only shows its page.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="url" class="set-input" data-fm-url aria-label="FlashMind address" style="flex:1;min-width:200px">
        <button type="button" class="btn-secondary" data-fm-save>Save address</button>
        <button type="button" class="btn-secondary" data-fm-reset>Use the default</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" data-fm-panel></button>
        <button type="button" class="btn-secondary" data-fm-send>Send to FlashMind</button>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:12px;color:var(--text)">Cards due today in the morning brief</div>
        <p class="setting-info muted" style="margin:4px 0 8px">FlashMind keeps its schedules in your browser. Save a backup in FlashMind (Backup in the library) and choose that file here; only deck names and due dates are kept, never the cards.</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="file" accept=".json,application/json" data-fm-file aria-label="FlashMind backup file">
          <button type="button" class="btn-secondary" data-fm-forget>Forget it</button>
          <span data-fm-due style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </div>`;
    const q = (s) => g.querySelector(s);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const urlIn = q('[data-fm-url]');
    const panelBtn = q('[data-fm-panel]');
    const dueEl = q('[data-fm-due]');
    const redraw = () => {
      urlIn.value = this.url();
      panelBtn.textContent = this.panelPinned() ? 'Remove from the sidebar' : 'Add to the sidebar';
      const d = this.dueStored();
      if (d) { const s = this.dueSummary(d); dueEl.textContent = s.dueToday + ' due today, from a backup of ' + (d.exportedAt ? d.exportedAt.slice(0, 10) : 'unknown date'); }
      else dueEl.textContent = 'No backup chosen';
    };
    q('[data-fm-save]').addEventListener('click', () => { try { this.setUrl(urlIn.value); window.showToast?.('FlashMind address saved'); } catch (err) { fail(err); } redraw(); });
    q('[data-fm-reset]').addEventListener('click', () => { try { this.setUrl(''); } catch (err) { fail(err); } redraw(); });
    panelBtn.addEventListener('click', () => {
      try { if (this.panelPinned()) this.removePanel(); else this.ensurePanel(); } catch (err) { fail(err); }
      redraw();
    });
    q('[data-fm-send]').addEventListener('click', () => { this.openSend().catch(fail); });
    q('[data-fm-file]').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const s = this.importDueText(await f.text());
        window.showToast?.(s.dueToday + ' FlashMind card' + (s.dueToday === 1 ? '' : 's') + ' due today');
      } catch (err) { fail(err); }
      e.target.value = '';
      redraw();
    });
    q('[data-fm-forget]').addEventListener('click', () => { this.forgetDue(); redraw(); });
    redraw();
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    const have = new Set(CommandBar.commands.map(c => c.id));
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const add = (c) => { if (!have.has(c.id)) CommandBar.commands.push(c); };
    add({ id: 'flashmind-open', label: 'Open FlashMind', hint: 'Your study tool, in a sidebar panel', icon: 'graduation', action: () => { try { this.openPanel(); } catch (err) { fail(err); } } });
    add({ id: 'flashmind-send', label: 'Send to FlashMind', hint: 'The selection, this page, a note or your clips, as text to paste or a file to drop', icon: 'graduation', action: () => { this.openSend().catch(fail); } });
    add({ id: 'flashmind-send-selection', label: 'Send Selection to FlashMind', hint: 'The text selected on this page', icon: 'graduation', action: () => { this.openSend({ source: 'selection' }).catch(fail); } });
  },

  init() {
    if (this._wired) return this;
    this._wired = true;
    this.registerCommands();
    this.injectSettings();
    return this;
  },
};

// A morning-brief extra: { id, title, icon, build(), isEnabled() }. Nothing is
// shown until a backup file has been chosen.
const VexBriefFlashMind = {
  id: 'flashmind-due',
  title: 'FlashMind',
  icon: 'graduation',
  isEnabled() { return !!FlashMindBridge.dueStored(); },
  build() {
    const data = FlashMindBridge.dueStored();
    if (!data) return { lines: [] };
    const lines = FlashMindBridge.briefLines(data).map((l, i) => (i === 0
      ? { ...l, actions: [{ label: 'Open FlashMind', run: () => FlashMindBridge.openPanel() }] }
      : l));
    return { lines };
  },
};

if (typeof window !== 'undefined') {
  window.FlashMindBridge = FlashMindBridge;
  window.VexBriefFlashMind = VexBriefFlashMind;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => FlashMindBridge.init());
    else FlashMindBridge.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { FlashMindBridge, VexBriefFlashMind };
