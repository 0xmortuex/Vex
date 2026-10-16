// === Research board — quotes from several tabs, on one board ================
//
// Research Projects (research-projects.js) keeps everything about one topic
// for good. A board is the lighter thing you want while reading: pull a
// sentence out of this tab, then that one, then four more, put them in the
// order that makes the argument, and write the brief out as a note.
//
// Every quote keeps the page it came from. Nothing is read from a private,
// Tor or routed tab — not pulled, not stored — here as everywhere.
//
// "Pull from every tab" takes the text selected in each open tab, as the page
// has it right now (a selection that was cleared is gone and is not guessed).

const ResearchBoard = {
  KEY: 'vex.researchBoard',
  MAX: 200,
  MAX_QUOTE: 3000,
  items: [],

  init() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      this.items = Array.isArray(a) ? a.filter(q => q && typeof q.text === 'string' && q.text) : [];
    } catch { this.items = []; }
    this.registerCommands();
    this.injectSettings();
    return this;
  },

  save() {
    this.items = this.items.slice(0, this.MAX);
    try { localStorage.setItem(this.KEY, JSON.stringify(this.items)); } catch (err) {
      throw new Error('The board could not be saved: ' + err.message);
    }
  },

  list() { return this.items.slice(); },

  _id() { return window.vexId ? window.vexId('rb') : 'rb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); },

  // Adds a quote; the same text from the same page is kept once.
  add({ text, url, title }) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, this.MAX_QUOTE);
    if (!t) throw new Error('There is no text to add');
    const u = String(url || '');
    const dup = this.items.find(q => q.text === t && q.url === u);
    if (dup) return { item: dup, added: false };
    if (this.items.length >= this.MAX) throw new Error('The board is full (' + this.MAX + ' quotes) — export it and clear it first');
    const item = { id: this._id(), text: t, url: u, title: String(title || u).slice(0, 200), at: Date.now() };
    this.items.push(item);
    this.save();
    return { item, added: true };
  },

  remove(id) {
    const i = this.items.findIndex(q => q.id === id);
    if (i < 0) return null;
    const [gone] = this.items.splice(i, 1);
    this.save();
    return gone;
  },

  // dir: -1 up, +1 down. Returns the new index, or -1 if it could not move.
  move(id, dir) {
    const i = this.items.findIndex(q => q.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= this.items.length) return -1;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.save();
    return j;
  },

  clear() { this.items = []; this.save(); },

  // The markdown brief: quotes grouped by page, in board order — a page's
  // first appearance fixes its place, so reordering the board reorders the brief.
  toMarkdown(title) {
    const name = String(title || '').trim() || 'Research brief';
    const groups = [];
    const byKey = new Map();
    for (const q of this.items) {
      const key = q.url || q.title || q.id;
      let g = byKey.get(key);
      if (!g) { g = { url: q.url, title: q.title, quotes: [] }; byKey.set(key, g); groups.push(g); }
      g.quotes.push(q);
    }
    const lines = ['# ' + name, '', '_' + this.items.length + ' quote' + (this.items.length === 1 ? '' : 's') + ' from ' + groups.length + ' source' + (groups.length === 1 ? '' : 's') + '._', ''];
    for (const g of groups) {
      const label = String(g.title || g.url || 'Untitled').replace(/[\[\]]/g, '');
      lines.push('## ' + (g.url ? '[' + label + '](' + g.url + ')' : label), '');
      for (const q of g.quotes) lines.push(q.text.split('\n').map(l => '> ' + l).join('\n'), '');
    }
    lines.push('---', '', '## Sources', '');
    groups.forEach((g, i) => {
      const label = String(g.title || g.url || 'Untitled').replace(/[\[\]]/g, '');
      lines.push((i + 1) + '. ' + (g.url ? '[' + label + '](' + g.url + ')' : label));
    });
    return lines.join('\n').trimEnd() + '\n';
  },

  // Into a new note in the Notes panel (its own storage, same shape as a typed note).
  exportToNotes(title) {
    if (!this.items.length) throw new Error('The board is empty — add a quote first');
    if (typeof NotesPanel === 'undefined' || !Array.isArray(NotesPanel.notes)) throw new Error('Notes are not available');
    const now = new Date().toISOString();
    const note = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: String(title || '').trim() || 'Research brief',
      content: this.toMarkdown(title),
      pinned: false, tags: ['research'], sourceUrl: '', sourceTitle: '',
      createdAt: now, updatedAt: now,
    };
    NotesPanel.notes.unshift(note);
    NotesPanel.save();
    try { NotesPanel.renderList?.(); } catch { /* the panel may not be built yet */ }
    return note;
  },

  // --- reading the tabs ---------------------------------------------------
  _tabs() {
    return (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) ? TabManager.tabs : [];
  },

  async _selectionOf(tab, wv) {
    if (!tab || !wv || !/^https?:/i.test(tab.url || '')) return '';
    if (window.VexTabPolicy && (!window.VexTabPolicy.canReadWebview(wv) || (window.VexTabPolicy.canPersist && !window.VexTabPolicy.canPersist(tab)))) return '';
    try {
      const t = await window.vexGuestEval(wv, 'String(window.getSelection())', false, 4000);
      return typeof t === 'string' ? t.trim() : '';
    } catch { return ''; }
  },

  async addFromActive() {
    const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (!tab || !wv) throw new Error('There is no page open');
    const text = await this._selectionOf(tab, wv);
    if (!text) throw new Error('Select some text on the page first (private and Tor tabs are never read)');
    return this.add({ text, url: tab.url, title: tab.title });
  },

  async pullFromAllTabs() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) throw new Error('Tabs are not available');
    let added = 0, seen = 0;
    for (const tab of this._tabs()) {
      const wv = WebviewManager.webviews.get(tab.id);
      const text = await this._selectionOf(tab, wv);
      if (!text) continue;
      seen++;
      if (this.add({ text, url: tab.url, title: tab.title }).added) added++;
    }
    return { added, tabsWithSelection: seen };
  },

  // --- the board ----------------------------------------------------------
  open() {
    document.querySelector('.vex-board-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const ico = (n, s = 14) => (window.VexIcons ? VexIcons.svg(n, { size: s }) : '');
    const btn = 'display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer';
    const overlay = document.createElement('div');
    overlay.className = 'vex-board-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:7vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Research board" style="width:min(680px,94vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <strong style="flex:1;font-size:13.5px;color:var(--text);min-width:120px">Research board</strong>
          <button type="button" data-add style="${btn}">${ico('plus')}Add selection</button>
          <button type="button" data-pull style="${btn}" title="Take the text selected in every open tab">${ico('copy')}From every tab</button>
          ${typeof VexLibraryLinks !== 'undefined' && VexLibraryLinks.enabled() ? `<button type="button" data-related style="${btn}" title="What you kept that relates to these quotes">${ico('link')}Related from my library</button>` : ''}
          <button type="button" data-export style="${btn}">${ico('note')}Export to notes</button>
          <button type="button" data-clear style="${btn}">${ico('trash')}Clear</button>
        </div>
        <div data-list style="overflow-y:auto;padding:8px 10px;flex:1"></div>
        <div data-related-box hidden style="overflow-y:auto;max-height:30vh;padding:8px 14px;border-top:1px solid var(--border)"></div>
      </div>`;
    const listEl = overlay.querySelector('[data-list]');
    const draw = () => {
      listEl.textContent = '';
      if (!this.items.length) {
        listEl.innerHTML = '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing on the board yet. Select text on a page, then choose Add selection.</div>';
        return;
      }
      this.items.forEach((q, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px';
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(q.text)}</div>
            <a href="#" data-open style="font-size:11px;color:var(--primary,var(--accent));display:inline-block;margin-top:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.title || q.url)}</a>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <button type="button" data-up aria-label="Move up" ${i === 0 ? 'disabled' : ''} style="${btn};padding:2px 5px">${ico('chevron-up', 13)}</button>
            <button type="button" data-down aria-label="Move down" ${i === this.items.length - 1 ? 'disabled' : ''} style="${btn};padding:2px 5px">${ico('chevron-down', 13)}</button>
            <button type="button" data-del aria-label="Remove from the board" style="${btn};padding:2px 5px">${ico('trash', 13)}</button>
          </div>`;
        row.querySelector('[data-up]').addEventListener('click', () => { this.move(q.id, -1); draw(); });
        row.querySelector('[data-down]').addEventListener('click', () => { this.move(q.id, 1); draw(); });
        row.querySelector('[data-del]').addEventListener('click', () => { this.remove(q.id); draw(); });
        row.querySelector('[data-open]').addEventListener('click', (e) => {
          e.preventDefault();
          if (q.url && typeof TabManager !== 'undefined' && TabManager.createTab) TabManager.createTab(q.url, true);
        });
        listEl.appendChild(row);
      });
    };
    const fail = (err) => window.showToast?.(err.message || String(err), 'error');
    overlay.querySelector('[data-add]').addEventListener('click', async () => {
      try {
        // The overlay holds focus but not the page's selection, which stays put.
        const r = await this.addFromActive();
        window.showToast?.(r.added ? 'Added to the board' : 'That quote is already on the board');
        draw();
      } catch (err) { fail(err); }
    });
    overlay.querySelector('[data-pull]').addEventListener('click', async () => {
      try {
        const r = await this.pullFromAllTabs();
        window.showToast?.(r.tabsWithSelection ? r.added + ' added from ' + r.tabsWithSelection + ' tab' + (r.tabsWithSelection === 1 ? '' : 's') : 'No tab has text selected');
        draw();
      } catch (err) { fail(err); }
    });
    overlay.querySelector('[data-related]')?.addEventListener('click', async () => {
      const box = overlay.querySelector('[data-related-box]');
      try {
        if (!this.items.length) throw new Error('Add a quote to the board first');
        box.hidden = false;
        box.textContent = 'Looking through what you kept...';
        await VexLibraryLinks.renderRelated(box, VexLibraryLinks.boardPage(this.items));
      } catch (err) { box.hidden = true; fail(err); }
    });
    overlay.querySelector('[data-export]').addEventListener('click', async () => {
      try {
        const name = (typeof window.vexPrompt === 'function') ? await window.vexPrompt({ title: 'Export the board', label: 'Name for the note', value: 'Research brief' }) : 'Research brief';
        if (name === null || name === undefined) return;
        const note = this.exportToNotes(name);
        window.showToast?.('Saved to Notes as “' + note.title + '”', 'success');
      } catch (err) { fail(err); }
    });
    overlay.querySelector('[data-clear]').addEventListener('click', async () => {
      if (!this.items.length) return;
      const ok = await window.vexConfirm({ title: 'Clear the board?', message: 'This removes all ' + this.items.length + ' quotes from the board. Notes you exported are not touched.', okLabel: 'Clear', danger: true });
      if (!ok) return;
      this.clear();
      draw();
    });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    draw();
    return overlay;
  },

  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="research-board"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'research-board');
    g.innerHTML = `
      <label class="setting-label">Research board</label>
      <p class="setting-info muted" style="margin-bottom:8px">Collect quotes from several tabs on one board, put them in order, and export a markdown brief with its sources into Notes. Quotes from private, Tor and routed tabs are never taken.</p>
      <div style="display:flex;gap:10px;align-items:center">
        <button type="button" class="btn-secondary" data-board-open>Open the board</button>
        <span data-board-count style="font-size:11px;color:var(--text-muted)"></span>
      </div>`;
    const count = g.querySelector('[data-board-count]');
    const upd = () => { count.textContent = this.items.length + ' quote' + (this.items.length === 1 ? '' : 's') + ' on the board'; };
    upd();
    g.querySelector('[data-board-open]').addEventListener('click', () => { this.open(); });
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    const have = new Set(CommandBar.commands.map(c => c.id));
    const add = (c) => { if (!have.has(c.id)) CommandBar.commands.push(c); };
    add({ id: 'board-open', label: 'Open Research Board', hint: 'Quotes from several tabs, with sources', icon: 'list', action: () => this.open() });
    add({ id: 'board-add', label: 'Add Selection to Research Board', hint: 'Keep the selected text, with its page', icon: 'plus',
      action: async () => {
        try { const r = await this.addFromActive(); window.showToast?.(r.added ? 'Added to the research board' : 'Already on the board'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      } });
    add({ id: 'board-pull', label: 'Pull Selections From Every Tab', hint: 'Add the text selected in each open tab to the board', icon: 'plus',
      action: async () => {
        try { const r = await this.pullFromAllTabs(); window.showToast?.(r.tabsWithSelection ? r.added + ' added to the board' : 'No tab has text selected'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      } });
  },
};

if (typeof window !== 'undefined') {
  window.ResearchBoard = ResearchBoard;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ResearchBoard.init());
    else ResearchBoard.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ResearchBoard };
